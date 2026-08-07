import test from 'node:test';
import assert from 'node:assert/strict';
import { normalize } from '../../js/data/normalize.js';
import { miniRaw } from '../fixtures/mini-data.js';
import { producibleClosure } from '../../js/engine/requirements.js';

const ds = normalize(miniRaw);
const ALL = new Set(ds.recipes.map((r) => r.id)); // Recipe_IngotIron_C, Recipe_Plastic_C

test('producibleClosure: ore seed makes iron ingot, not plastic', () => {
  const { producible, firedRecipeIds } = producibleClosure(ds, ALL, ['Desc_OreIron_C']);
  assert.ok(producible.has('Desc_IronIngot_C'));
  assert.ok(!producible.has('Desc_Plastic_C'));
  assert.ok(firedRecipeIds.has('Recipe_IngotIron_C'));
  assert.ok(!firedRecipeIds.has('Recipe_Plastic_C'));
});

test('producibleClosure: oil seed makes plastic + heavy oil residue, not iron', () => {
  const { producible } = producibleClosure(ds, ALL, ['Desc_LiquidOil_C']);
  assert.ok(producible.has('Desc_Plastic_C'));
  assert.ok(producible.has('Desc_HeavyOilResidue_C'));
  assert.ok(!producible.has('Desc_IronIngot_C'));
});

test('producibleClosure: a disabled recipe never fires', () => {
  const onlyPlastic = new Set(['Recipe_Plastic_C']);
  const { producible } = producibleClosure(ds, onlyPlastic, ['Desc_OreIron_C']);
  assert.ok(!producible.has('Desc_IronIngot_C')); // iron recipe disabled
});

test('producibleClosure: seeds are always producible; terminates on a cycle', () => {
  // Inline dataset with an A<->B cycle that can only start from a seed.
  const cyc = {
    rawResourceIds: new Set(['seed']),
    recipes: [
      { id: 'ra', inputs: [{ itemId: 'b', perMin: 1 }], outputs: [{ itemId: 'a', perMin: 1 }] },
      { id: 'rb', inputs: [{ itemId: 'a', perMin: 1 }], outputs: [{ itemId: 'b', perMin: 1 }] },
      { id: 'seedA', inputs: [{ itemId: 'seed', perMin: 1 }], outputs: [{ itemId: 'a', perMin: 1 }] },
    ],
  };
  const { producible } = producibleClosure(cyc, new Set(['ra', 'rb', 'seedA']), ['seed']);
  assert.ok(producible.has('seed') && producible.has('a') && producible.has('b'));
  // Without the seed, the pure A<->B loop must NOT bootstrap itself.
  const none = producibleClosure(cyc, new Set(['ra', 'rb']), []);
  assert.ok(!none.producible.has('a') && !none.producible.has('b'));
});

import { analyzeRequirements } from '../../js/engine/requirements.js';

const one = (out, avail, userAdded, targets) =>
  analyzeRequirements(ds, ALL, new Set(avail), new Set(userAdded), targets).perTarget.find((p) => p.itemId === out);

test('analyzeRequirements: buildable target is ok', () => {
  const p = one('Desc_IronIngot_C', ['Desc_OreIron_C'], ['Desc_OreIron_C'], ['Desc_IronIngot_C']);
  assert.equal(p.status, 'ok');
});

test('analyzeRequirements: wrong resource added -> impossible (crude oil -> iron ingot)', () => {
  const p = one('Desc_IronIngot_C', ['Desc_LiquidOil_C'], ['Desc_LiquidOil_C'], ['Desc_IronIngot_C']);
  assert.equal(p.status, 'impossible');
  assert.equal(p.reason, 'wrong-resources');
  assert.deepEqual(p.deps, [{ itemId: 'Desc_OreIron_C', added: false }]);
});

test('analyzeRequirements: nothing added yet -> missing (no-resources)', () => {
  const p = one('Desc_IronIngot_C', [], [], ['Desc_IronIngot_C']);
  assert.equal(p.status, 'missing');
  assert.equal(p.reason, 'no-resources');
  assert.deepEqual(p.deps, [{ itemId: 'Desc_OreIron_C', added: false }]);
});

test('analyzeRequirements: target that is itself a raw', () => {
  const added = one('Desc_OreIron_C', ['Desc_OreIron_C'], ['Desc_OreIron_C'], ['Desc_OreIron_C']);
  assert.equal(added.status, 'ok');
  const notAdded = one('Desc_OreIron_C', [], [], ['Desc_OreIron_C']);
  assert.equal(notAdded.status, 'missing');
});

test('analyzeRequirements: no enabled recipe produces the target -> impossible (no-recipe)', () => {
  // Iron ingot with the iron recipe disabled: no path from any raw.
  const res = analyzeRequirements(ds, new Set(['Recipe_Plastic_C']),
    new Set(['Desc_OreIron_C']), new Set(['Desc_OreIron_C']), ['Desc_IronIngot_C']);
  const p = res.perTarget[0];
  assert.equal(p.status, 'impossible');
  assert.equal(p.reason, 'no-recipe');
  assert.equal(p.deps.length, 0);
});

test('analyzeRequirements: partial deps (have one, missing another)', () => {
  // Inline dataset: gadget needs raw X (added) + raw Y (missing).
  const gadgetDs = {
    rawResourceIds: new Set(['x', 'y']),
    recipes: [{ id: 'mk', inputs: [{ itemId: 'x', perMin: 1 }, { itemId: 'y', perMin: 1 }], outputs: [{ itemId: 'gadget', perMin: 1 }] }],
  };
  const res = analyzeRequirements(gadgetDs, new Set(['mk']), new Set(['x']), new Set(['x']), ['gadget']);
  const p = res.perTarget[0];
  assert.equal(p.status, 'missing');
  assert.equal(p.reason, 'partial');
  assert.deepEqual(p.deps, [{ itemId: 'x', added: true }, { itemId: 'y', added: false }]);
});

test('analyzeRequirements: alternate recipe toggles buildability', () => {
  // widget is ONLY producible via an alternate recipe from raw z.
  const altDs = {
    rawResourceIds: new Set(['z']),
    recipes: [{ id: 'altW', alternate: true, inputs: [{ itemId: 'z', perMin: 1 }], outputs: [{ itemId: 'widget', perMin: 1 }] }],
  };
  const off = analyzeRequirements(altDs, new Set(), new Set(['z']), new Set(['z']), ['widget']).perTarget[0];
  assert.equal(off.status, 'impossible');
  assert.equal(off.reason, 'no-recipe');
  const on = analyzeRequirements(altDs, new Set(['altW']), new Set(['z']), new Set(['z']), ['widget']).perTarget[0];
  assert.equal(on.status, 'ok');
});

test('analyzeRequirements: anyImpossible / anyMissing summary flags', () => {
  const res = analyzeRequirements(ds, ALL, new Set(['Desc_LiquidOil_C']), new Set(['Desc_LiquidOil_C']),
    ['Desc_IronIngot_C', 'Desc_Plastic_C']);
  assert.equal(res.anyImpossible, true);  // iron ingot
  assert.equal(res.anyMissing, false);
  assert.equal(res.perTarget.find((p) => p.itemId === 'Desc_Plastic_C').status, 'ok');
});

test('analyzeRequirements: available raw not in user-added (auto-water case) shows added:true', () => {
  // gadget needs raw x + raw y; x is AVAILABLE (e.g. auto-unlimited water) but
  // NOT user-added, y is neither. Guards that deps.added uses availableRawIds
  // while severity uses userAddedRawIds -> missing/no-resources (not partial),
  // and x shows added:true despite being absent from userAddedRawIds.
  const gadgetDs = {
    rawResourceIds: new Set(['x', 'y']),
    recipes: [{ id: 'mk', inputs: [{ itemId: 'x', perMin: 1 }, { itemId: 'y', perMin: 1 }], outputs: [{ itemId: 'gadget', perMin: 1 }] }],
  };
  const p = analyzeRequirements(gadgetDs, new Set(['mk']), new Set(['x']), new Set([]), ['gadget']).perTarget[0];
  assert.equal(p.status, 'missing');
  assert.equal(p.reason, 'no-resources');
  assert.deepEqual(p.deps, [{ itemId: 'x', added: true }, { itemId: 'y', added: false }]);
});

// --- blockedItems: WHERE the chain is severed ------------------------------
// Shaped after the real Packaged Turbofuel chain, which is what made the old
// "Try enabling the alternate recipe it needs" message wrong. The target's own
// producer (`packTF`) is a BASE recipe and is already enabled; the break is two
// steps upstream at `ccoal`, which needs an alternate of its own. Verified
// against the pinned dataset: Packaged Turbofuel is unreachable from all raws
// with base + Turbofuel and with base + Turbo Heavy Fuel, and reachable only
// with base + Turbo Blend Fuel — so "the alternate recipe", singular, is a lie.
//
// `gizmoItem` is the other shape: its only recipe eats `wood`, which is neither
// raw nor produced (foraged items normalize that way), so NO recipe set makes it.
const fuelChain = {
  rawResourceIds: new Set(['coal', 'oil']),
  recipes: [
    { id: 'fuel', inputs: [{ itemId: 'oil', perMin: 1 }], outputs: [{ itemId: 'fuelItem', perMin: 1 }] },
    { id: 'packTF', inputs: [{ itemId: 'turbofuel', perMin: 1 }], outputs: [{ itemId: 'packagedTF', perMin: 1 }] },
    { id: 'altTF', alternate: true, inputs: [{ itemId: 'fuelItem', perMin: 1 }, { itemId: 'ccoal', perMin: 1 }], outputs: [{ itemId: 'turbofuel', perMin: 1 }] },
    { id: 'altBlend', alternate: true, inputs: [{ itemId: 'fuelItem', perMin: 1 }], outputs: [{ itemId: 'turbofuel', perMin: 1 }] },
    { id: 'altCC', alternate: true, inputs: [{ itemId: 'coal', perMin: 1 }], outputs: [{ itemId: 'ccoal', perMin: 1 }] },
    { id: 'mystery', inputs: [{ itemId: 'wood', perMin: 1 }], outputs: [{ itemId: 'gizmoItem', perMin: 1 }] },
  ],
};
const FUEL_RAWS = new Set(['coal', 'oil']);
// Every base recipe plus ONE Turbofuel alternate — exactly the state the user
// reported: they enabled a Turbofuel alternate and the message did not change.
const BASE_PLUS_ONE_ALT = new Set(['fuel', 'packTF', 'mystery', 'altTF']);

test('analyzeRequirements: no-recipe names every severed link, not just the target', () => {
  const p = analyzeRequirements(fuelChain, BASE_PLUS_ONE_ALT, FUEL_RAWS, FUEL_RAWS, ['packagedTF']).perTarget[0];
  assert.equal(p.status, 'impossible');
  assert.equal(p.reason, 'no-recipe');
  // Both are one recipe away from being makeable, and BOTH have to be closed:
  // altTF is already on, so unblocking ccoal alone finishes the chain, and so
  // does altBlend on its own. The target itself is NOT listed — its own recipe
  // is enabled and fine, which is precisely why the singular wording misled.
  assert.deepEqual(p.blockedItems, ['ccoal', 'turbofuel']);
});

test('analyzeRequirements: no-recipe on the target itself lists only the target', () => {
  // Nothing enabled makes ccoal, but altCC would, straight from a raw — so this
  // is the one shape where a single alternate is PROVABLY enough, and the
  // renderer is allowed to say so in the singular. The list has to be exactly
  // [target] for that: one entry that is some upstream item instead (real
  // dataset: Gas Filter blocked only on Fabric) carries no such guarantee,
  // because closing that break can expose another behind it.
  const p = analyzeRequirements(fuelChain, new Set(['fuel', 'packTF', 'mystery']), FUEL_RAWS, FUEL_RAWS, ['ccoal']).perTarget[0];
  assert.equal(p.reason, 'no-recipe');
  assert.deepEqual(p.blockedItems, ['ccoal']);
});

test('analyzeRequirements: no-recipe lists a break on every route, not just the shortest', () => {
  // With no alternates at all, turbofuel is reachable two ways — directly via
  // altBlend, or via ccoal + altTF — and both are severed. Naming only one
  // would hide a route the player may well prefer.
  const p = analyzeRequirements(fuelChain, new Set(['fuel', 'packTF', 'mystery']), FUEL_RAWS, FUEL_RAWS, ['turbofuel']).perTarget[0];
  assert.deepEqual(p.blockedItems, ['ccoal', 'turbofuel']);
});

test('analyzeRequirements: blockedItems is empty when no recipe set can make the target', () => {
  // Enabling alternates cannot help gizmoItem, so there is nothing to name.
  const every = new Set(fuelChain.recipes.map((r) => r.id));
  const p = analyzeRequirements(fuelChain, every, FUEL_RAWS, FUEL_RAWS, ['gizmoItem']).perTarget[0];
  assert.equal(p.reason, 'no-recipe');
  assert.deepEqual(p.blockedItems, []);
});

test('analyzeRequirements: extra seeds are producible without any recipe path', () => {
  // Expansion declares blocks and bus supply that no recipe chain has to reach.
  // Seeding ccoal makes the same chain buildable with the same recipes.
  const seeded = analyzeRequirements(fuelChain, BASE_PLUS_ONE_ALT, FUEL_RAWS, FUEL_RAWS, ['packagedTF'], ['ccoal']).perTarget[0];
  assert.equal(seeded.status, 'ok');
  // ...and a seed that doesn't help leaves the verdict alone.
  const unrelated = analyzeRequirements(fuelChain, BASE_PLUS_ONE_ALT, FUEL_RAWS, FUEL_RAWS, ['packagedTF'], ['fuelItem']).perTarget[0];
  assert.equal(unrelated.status, 'impossible');
  assert.deepEqual(unrelated.blockedItems, ['ccoal', 'turbofuel']);
});
