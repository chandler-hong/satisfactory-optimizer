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
