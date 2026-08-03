import test from 'node:test';
import assert from 'node:assert/strict';
import { pinnedBalance, splitDemand, computeNetOutput, planExpansion } from '../../js/engine/expansion.js';
import { ironChain, ALL_IRON_RECIPES } from '../fixtures/iron-chain.js';

const r6 = (x) => Math.round(x * 1e6) / 1e6;
const rateOf = (m, id) => r6(m.get(id) || 0);
const machinesOf = (plan, recipeId) => plan.buildRows.find((b) => b.recipeId === recipeId)?.machines ?? 0;
const rawFor = (p, itemId) => p.rawNeeded.find((r) => r.itemId === itemId);

const plan = (rows, extra = {}) => planExpansion({
  dataset: ironChain, rows, enabledRecipeIds: ALL_IRON_RECIPES, ...extra,
});

// Important 3 fixture: a block that PRODUCES a raw needs a recipe with no
// inputs. iron-chain.js has none and must not be touched (other tests depend
// on its exact shape), so this is a throwaway dataset built in this file only,
// reusing ironChain's items/buildings/rawResourceIds by reference and adding
// one synthetic recipe on top of a *copy* of its recipe list.
const oreMakerDataset = {
  ...ironChain,
  recipes: [...ironChain.recipes, { id: 'oreMaker', name: 'oreMaker', buildingId: 'b', alternate: false, inputs: [], outputs: [{ itemId: 'ore', perMin: 5 }] }],
};
const planOre = (rows) => planExpansion({
  dataset: oreMakerDataset, rows, enabledRecipeIds: new Set([...ALL_IRON_RECIPES, 'oreMaker']),
});

test('pinnedBalance: nets a block at its machine count', () => {
  // rip: 30 plate + 60 screw -> 5 rip, per machine
  const net = pinnedBalance(ironChain, [{ kind: 'block', recipeId: 'rip', machines: 2, clock: 1 }]);
  assert.equal(rateOf(net, 'plate'), -60);
  assert.equal(rateOf(net, 'screw'), -120);
  assert.equal(rateOf(net, 'rip'), 10);
});

test('pinnedBalance: clock scales the load — 4 @150% equals 6 @100%', () => {
  const fast = pinnedBalance(ironChain, [{ kind: 'block', recipeId: 'rip', machines: 4, clock: 1.5 }]);
  const many = pinnedBalance(ironChain, [{ kind: 'block', recipeId: 'rip', machines: 6, clock: 1 }]);
  assert.deepEqual([...fast].sort(), [...many].sort());
  assert.equal(rateOf(fast, 'plate'), -180);
});

test('pinnedBalance: an unknown recipeId is ignored, not thrown', () => {
  const net = pinnedBalance(ironChain, [
    { kind: 'block', recipeId: 'no_such_recipe', machines: 3, clock: 1 },
    { kind: 'block', recipeId: 'rip', machines: 2, clock: 1 },
  ]);
  assert.equal(rateOf(net, 'plate'), -60, 'the surviving block still counts');
});

test('splitDemand: negative non-raw becomes a target, positive becomes pinned supply', () => {
  const net = pinnedBalance(ironChain, [{ kind: 'block', recipeId: 'rip', machines: 2, clock: 1 }]);
  const { targets, supplies, rawDemand } = splitDemand(ironChain, net, [], []);
  assert.equal(rateOf(targets, 'plate'), 60);
  assert.equal(rateOf(targets, 'screw'), 120);
  assert.deepEqual(supplies, [{ itemId: 'rip', rate: 10, kind: 'pinned' }]);
  assert.equal(rawDemand.size, 0);
});

// A block eating ore has no upstream to build. Routed through the LP it would be
// silently absorbed by the ore constraint and vanish from the raw footer.
test('splitDemand: a block consuming a raw goes to rawDemand, not to the LP', () => {
  const net = pinnedBalance(ironChain, [{ kind: 'block', recipeId: 'ingot', machines: 1, clock: 1 }]);
  const { targets, supplies, rawDemand } = splitDemand(ironChain, net, [], []);
  assert.equal(targets.size, 0);
  assert.equal(rateOf(rawDemand, 'ore'), 30);
  assert.deepEqual(supplies, [{ itemId: 'ingot', rate: 30, kind: 'pinned' }]);
});

// Important 3: before the fix, a positive-raw netPinned entry was pushed into
// `supplies` as a raw 'pinned' row — but lp-builder.js's addSupplies
// unconditionally skips every raw supply, so that entry was permanently dead
// and the credit vanished. It must go to `rawCredit` instead.
test('splitDemand: a block netting a raw surplus becomes rawCredit, not a dead pinned supply', () => {
  const { supplies, rawCredit } = splitDemand(ironChain, new Map([['ore', 20]]), [], []);
  assert.equal(supplies.length, 0, 'a raw cannot be an LP supply, so it must not be offered as one');
  assert.equal(rateOf(rawCredit, 'ore'), 20);
});

test('splitDemand: want rows add targets; a raw want becomes raw demand', () => {
  const { targets, rawDemand } = splitDemand(ironChain, new Map(), [
    { kind: 'want', itemId: 'rod', rate: 45 },
    { kind: 'want', itemId: 'ore', rate: 120 },
  ], []);
  assert.equal(rateOf(targets, 'rod'), 45);
  assert.equal(rateOf(rawDemand, 'ore'), 120);
});

test('splitDemand: have rows become have supply; a raw have becomes rawSupplied', () => {
  const { supplies, rawSupplied } = splitDemand(ironChain, new Map(), [], [
    { kind: 'have', itemId: 'screw', rate: 300 },
    { kind: 'have', itemId: 'ore', rate: 480 },
  ]);
  assert.deepEqual(supplies, [{ itemId: 'screw', rate: 300, kind: 'have' }]);
  assert.equal(rateOf(rawSupplied, 'ore'), 480);
});

// Two rows naming the same item is an ordinary thing to type ("300 from plant A,
// 200 from plant B"). Unmerged, they'd collide downstream: lp-builder.js's
// addSupplies keys the LP variable and its cap constraint on (itemId, kind), so
// two 'have' entries for the same itemId silently overwrite each other's cap.
test('splitDemand: two non-raw HAVE rows for the same item merge into one supply entry', () => {
  const { supplies } = splitDemand(ironChain, new Map(), [], [
    { kind: 'have', itemId: 'screw', rate: 50 },
    { kind: 'have', itemId: 'screw', rate: 40 },
  ]);
  assert.deepEqual(supplies, [{ itemId: 'screw', rate: 90, kind: 'have' }],
    'one pooled entry, not two competing ones');
});

test('splitDemand: two raw HAVE rows for the same item still sum into rawSupplied', () => {
  const { rawSupplied } = splitDemand(ironChain, new Map(), [], [
    { kind: 'have', itemId: 'ore', rate: 300 },
    { kind: 'have', itemId: 'ore', rate: 180 },
  ]);
  assert.equal(rateOf(rawSupplied, 'ore'), 480, 'the branch we did not touch keeps aggregating');
});

test('planExpansion: one block explodes to whole upstream machines', () => {
  const p = plan([{ kind: 'block', recipeId: 'rip', machines: 2, clock: 1 }]);
  assert.equal(p.feasible, true);
  assert.equal(machinesOf(p, 'plate'), 3);
  assert.equal(machinesOf(p, 'screw'), 3);
  assert.equal(machinesOf(p, 'rod'), 2);
  assert.equal(machinesOf(p, 'ingot'), 4);
  assert.equal(p.tiles.machines, 12);
});

test('planExpansion: a block feeding another needs no upstream for the intermediate', () => {
  const p = plan([
    { kind: 'block', recipeId: 'rip', machines: 2, clock: 1 },
    { kind: 'block', recipeId: 'plate', machines: 3, clock: 1 },  // exactly the 60 plate/min rip wants
  ]);
  assert.equal(machinesOf(p, 'plate'), 0, 'plate nets to zero, so nothing upstream builds it');
  assert.equal(machinesOf(p, 'ingot'), 4, 'but the plate block itself now needs ingot');
  assert.equal(p.tiles.machines, 9);
});

test('planExpansion: a block partly feeding another covers only the deficit', () => {
  const p = plan([
    { kind: 'block', recipeId: 'rip', machines: 2, clock: 1 },
    { kind: 'block', recipeId: 'plate', machines: 2, clock: 1 },  // 40 of the 60 plate/min
  ]);
  assert.equal(machinesOf(p, 'plate'), 1, 'one more plate machine covers the missing 20/min');
  assert.equal(p.tiles.machines, 10);
});

// Important 1: the raw footer combines a block's own direct raw draw with
// whatever the LP separately needs for its own targets. Before this test,
// nothing exercised rawUsage with both sources active at once.
test('planExpansion: rawUsage combines a direct block draw with a separate LP residual draw', () => {
  const p = plan([
    { kind: 'block', recipeId: 'ingot', machines: 1, clock: 1 },  // 30 ore/min, direct
    { kind: 'want', itemId: 'plate', rate: 40 },                   // needs 60 ingot/min total
  ]);
  // The block's 30 ingot/min covers half of the want; the LP builds its own
  // ingot machine for the other 30 ingot/min (1 machine, not a duplicate of
  // the block's own machine, which is pinned and never enters buildRows).
  assert.equal(rawFor(p, 'ore').needed, 60, '30 from the block plus 30 from the LP residual');
  assert.equal(machinesOf(p, 'ingot'), 1, 'only the LP residual ingot machine, not the pinned block');
});

// Important 3: a block netting a raw surplus must reduce rawUsage instead of
// vanishing. Before the fix, the +50 credit was pushed into a dead 'pinned'
// supply entry and rawUsage stayed at the full 80.
test('planExpansion: a block netting a raw surplus credits rawUsage instead of vanishing', () => {
  const p = planOre([
    { kind: 'block', recipeId: 'oreMaker', machines: 10, clock: 1 },  // +50 ore/min
    { kind: 'want', itemId: 'ore', rate: 80 },
  ]);
  assert.equal(rawFor(p, 'ore').needed, 30, '80 wanted minus the 50 the block already makes');
});

test('planExpansion: rawUsage never goes negative when a raw credit exceeds demand', () => {
  const p = planOre([
    { kind: 'block', recipeId: 'oreMaker', machines: 20, clock: 1 },  // +100 ore/min
    { kind: 'want', itemId: 'ore', rate: 30 },
  ]);
  assert.equal(rateOf(p.rawUsage, 'ore'), 0, 'a surplus bigger than demand is not a negative need');
});

test('planExpansion: a have row covering demand removes that whole subtree', () => {
  const p = plan([
    { kind: 'block', recipeId: 'rip', machines: 2, clock: 1 },
    { kind: 'have', itemId: 'screw', rate: 120 },
  ]);
  assert.equal(machinesOf(p, 'screw'), 0);
  assert.equal(machinesOf(p, 'rod'), 0, 'and the rod that fed it');
  assert.deepEqual(p.supplyUsage, [{ itemId: 'screw', kind: 'have', rate: 120, used: 120, capped: false }],
    'exhausted but nothing was built for it, so not flagged');
});

test('planExpansion: a have row partly covering demand flags the overflow', () => {
  const p = plan([
    { kind: 'block', recipeId: 'rip', machines: 2, clock: 1 },
    { kind: 'have', itemId: 'screw', rate: 60 },
  ]);
  assert.equal(machinesOf(p, 'screw'), 2, 'ceil(1.5) whole machines');
  assert.deepEqual(p.supplyUsage, [{ itemId: 'screw', kind: 'have', rate: 60, used: 60, capped: true }]);
});

test('planExpansion: a have row larger than demand is not flagged', () => {
  const p = plan([
    { kind: 'block', recipeId: 'rip', machines: 2, clock: 1 },
    { kind: 'have', itemId: 'screw', rate: 300 },
  ]);
  assert.deepEqual(p.supplyUsage, [{ itemId: 'screw', kind: 'have', rate: 300, used: 120, capped: false }]);
});

// The anchor: this is the assertion that would have caught the duplicate-HAVE-row
// collision. Before the fix, splitting the same 120/min across two rows (60+60)
// instead of one silently changed the plan — 2 screw machines instead of 0, and
// supplyUsage reporting {rate:60, used:60, capped:true} twice while claiming 120
// consumed. One pooled supply must plan identically regardless of how many rows
// the player used to declare it.
test('planExpansion: one HAVE row and two HAVE rows summing to the same total plan identically', () => {
  const one = plan([
    { kind: 'block', recipeId: 'rip', machines: 2, clock: 1 },
    { kind: 'have', itemId: 'screw', rate: 120 },
  ]);
  const two = plan([
    { kind: 'block', recipeId: 'rip', machines: 2, clock: 1 },
    { kind: 'have', itemId: 'screw', rate: 60 },
    { kind: 'have', itemId: 'screw', rate: 60 },
  ]);
  assert.equal(machinesOf(two, 'screw'), machinesOf(one, 'screw'));
  assert.deepEqual(two.supplyUsage, one.supplyUsage);
  assert.deepEqual(two.supplyUsage, [{ itemId: 'screw', kind: 'have', rate: 120, used: 120, capped: false }]);
});

test('computeNetOutput: an unconsumed block output leaves at its full rate', () => {
  const p = plan([{ kind: 'block', recipeId: 'rip', machines: 2, clock: 1 }]);
  assert.equal(rateOf(p.netOutput, 'rip'), 10);
  assert.equal(rateOf(p.netOutput, 'plate'), 0, 'plate is fully consumed internally');
});

// The double-count guard: the upstream's consumption of the surplus is already a
// negative term in netFromLPRecipes, so subtracting the drawn supply too gives 70.
test('computeNetOutput: a block surplus partly eaten upstream reports the remainder', () => {
  const p = plan([
    { kind: 'block', recipeId: 'rip', machines: 2, clock: 1 },   // wants 120 screw
    { kind: 'block', recipeId: 'rod', machines: 10, clock: 1 },  // makes 150 rod
  ]);
  // screw machines (3) consume 30 rod; 150 - 30 = 120 rod leaves.
  assert.equal(rateOf(p.netOutput, 'rod'), 120);
  assert.equal(machinesOf(p, 'rod'), 0, 'the block already covers all rod demand');
});

test('computeNetOutput: a block surplus counts toward a larger want rather than against it', () => {
  const p = plan([
    { kind: 'block', recipeId: 'screw', machines: 2, clock: 1 },  // makes 80 screw, eats 20 rod
    { kind: 'want', itemId: 'screw', rate: 200 },
  ]);
  assert.equal(rateOf(p.netOutput, 'screw'), 200, 'not 120 — the 80 surplus is part of the 200');
});

// Important 2: computeNetOutput's `drawn['have']` term only becomes visible in
// the public netOutput map when the target is NOT already satisfied purely by
// the same item's own pinned surplus. In every have-row test above, the
// have-item's target is exactly that item's own netPinned deficit satisfied
// with no slack, so netOutput[item] collapses to netPinned[item] + target[item]
// = 0 whether or not the have-credit term fires — and the `r > EPS` filter
// reports both 0 and a negative value identically as absent. Deleting the term
// and rerunning confirms none of those tests notice. This scenario breaks the
// cancellation by layering an independent `want` on top of the block's own
// surplus, so the have-credit's contribution is the only way to reach 100.
test('computeNetOutput: the have-credit term is visible when a want exceeds the surplus it sits on top of', () => {
  const p = plan([
    { kind: 'block', recipeId: 'screw', machines: 2, clock: 1 },  // +80 screw surplus
    { kind: 'want', itemId: 'screw', rate: 100 },                   // 20 short of the want
    { kind: 'have', itemId: 'screw', rate: 50 },                    // covers the 20 gap, with room to spare
  ]);
  assert.equal(rateOf(p.netOutput, 'screw'), 100, 'without the have-credit term this reads 80');
});

test('planExpansion: an unreachable target reports a shortfall instead of throwing', () => {
  // Only the ingot recipe is enabled, so plate can never be made.
  const p = planExpansion({
    dataset: ironChain,
    rows: [{ kind: 'want', itemId: 'plate', rate: 20 }],
    enabledRecipeIds: new Set(['ingot']),
  });
  assert.equal(p.feasible, false);
  assert.deepEqual(p.shortfalls.map((s) => s.itemId), ['plate']);
});

// Confirmed gap: the spec's ExpansionPlan field table and step 5's "no recipe
// path" diagnostic callout both call for a `requirements` field, reusing
// analyzeRequirements the same way view-model.js's computePlan already does.
// Same scenario as the shortfall test above: only 'ingot' is enabled, so
// nothing can ever produce plate — a genuine no-recipe-path impossibility,
// not a resource-scarcity one (Expansion Mode has no such concept).
test('planExpansion: an unreachable target surfaces in requirements as an impossible, no-recipe target', () => {
  const p = planExpansion({
    dataset: ironChain,
    rows: [{ kind: 'want', itemId: 'plate', rate: 20 }],
    enabledRecipeIds: new Set(['ingot']),
  });
  assert.equal(p.requirements.hasIssues, true);
  assert.deepEqual(
    p.requirements.impossible.map((t) => ({ itemId: t.itemId, reason: t.reason })),
    [{ itemId: 'plate', reason: 'no-recipe' }],
  );
  assert.deepEqual(p.requirements.missing, []);
});

test('planExpansion: no rows yields an empty, feasible plan', () => {
  const p = plan([]);
  assert.equal(p.tiles.machines, 0);
  assert.deepEqual(p.buildRows, []);
  assert.equal(p.hasPlan, false);
});

test('rawNeeded: reports the rate and whole miners for a solid', () => {
  // 2x rip -> 120 ore/min (verified in the one-block test above).
  const p = plan([{ kind: 'block', recipeId: 'rip', machines: 2, clock: 1 }]);
  const ore = rawFor(p, 'ore');
  assert.equal(ore.needed, 120);
  assert.equal(ore.supplied, 0);
  assert.equal(ore.newRate, 120);
  // Mk.1 normal = 60 -> 2; Mk.2 normal = 120 -> 1; Mk.1 pure = 120 -> 1
  assert.equal(ore.options.find((o) => o.label === 'Miner Mk.1 · normal').count, 2);
  assert.equal(ore.options.find((o) => o.label === 'Miner Mk.2 · normal').count, 1);
  assert.equal(ore.options.find((o) => o.label === 'Miner Mk.1 · pure').count, 1);
});

// Every rate above (120, 60, 240, 480) happens to divide its extractor rate
// exactly, so Math.ceil and Math.floor agree and neither is actually pinned.
// 150/min does not divide evenly by any miner tier: 150/60 = 2.5, which must
// round UP to 3 whole miners (a fraction of a miner cannot be built), not down
// to 2. This is the one assertion in the suite that discriminates ceil from
// floor — confirmed by temporarily swapping extractorOptions's Math.ceil for
// Math.floor and rerunning, which fails only this test (see task-4-report.md).
test('rawNeeded: a rate that does not divide evenly still rounds up to a whole extractor', () => {
  // 5x ingot -> 150 ore/min, direct block draw (no LP recipes involved).
  const p = plan([{ kind: 'block', recipeId: 'ingot', machines: 5, clock: 1 }]);
  const ore = rawFor(p, 'ore');
  assert.equal(ore.needed, 150);
  assert.equal(ore.options.find((o) => o.label === 'Miner Mk.1 · normal').count, 3,
    'ceil(150 / 60) = 3, not floor(150 / 60) = 2');
});

test('rawNeeded: a raw have row is netted off, not shown as supply usage', () => {
  const p = plan([
    { kind: 'block', recipeId: 'rip', machines: 2, clock: 1 },
    { kind: 'have', itemId: 'ore', rate: 60 },
  ]);
  const ore = rawFor(p, 'ore');
  assert.equal(ore.needed, 120);
  assert.equal(ore.supplied, 60);
  assert.equal(ore.newRate, 60);
  assert.equal(ore.options.find((o) => o.label === 'Miner Mk.1 · normal').count, 1);
  assert.deepEqual(p.supplyUsage, [], 'raw supply never appears in supplyUsage');
});

test('rawNeeded: a raw have row covering everything needs no new extraction', () => {
  const p = plan([
    { kind: 'block', recipeId: 'rip', machines: 2, clock: 1 },
    { kind: 'have', itemId: 'ore', rate: 500 },
  ]);
  const ore = rawFor(p, 'ore');
  assert.equal(ore.newRate, 0);
  assert.deepEqual(ore.options, [], 'nothing to build');
});

test('rawNeeded: a block eating ore directly still reaches the footer', () => {
  const p = plan([{ kind: 'block', recipeId: 'ingot', machines: 3, clock: 1 }]);
  assert.equal(p.tiles.machines, 0, 'nothing upstream to build');
  assert.equal(rawFor(p, 'ore').needed, 90);
});

test('rawNeeded: water, oil, and nitrogen use their own extractors', () => {
  const io = (itemId, perMin) => ({ itemId, perMin });
  const fluids = {
    items: new Map([
      ['Desc_Water_C', { id: 'Desc_Water_C', name: 'Water', slug: 'water', liquid: true }],
      ['Desc_LiquidOil_C', { id: 'Desc_LiquidOil_C', name: 'Crude Oil', slug: 'crude-oil', liquid: true }],
      ['Desc_NitrogenGas_C', { id: 'Desc_NitrogenGas_C', name: 'Nitrogen Gas', slug: 'nitrogen-gas', liquid: true }],
      ['blend', { id: 'blend', name: 'Blend', slug: 'blend', liquid: false }],
    ]),
    buildings: new Map([['b', { id: 'b', name: 'Blender', slug: 'blender', basePowerMW: 75, powerExponent: 1.321928 }]]),
    rawResourceIds: new Set(['Desc_Water_C', 'Desc_LiquidOil_C', 'Desc_NitrogenGas_C']),
    recipes: [{ id: 'mix', name: 'Mix', buildingId: 'b', alternate: false, timeSec: 60,
      inputs: [io('Desc_Water_C', 240), io('Desc_LiquidOil_C', 120), io('Desc_NitrogenGas_C', 60)],
      outputs: [io('blend', 60)] }],
  };
  const p = planExpansion({ dataset: fluids, rows: [{ kind: 'want', itemId: 'blend', rate: 60 }], enabledRecipeIds: new Set(['mix']) });
  const find = (id) => p.rawNeeded.find((r) => r.itemId === id);
  assert.equal(find('Desc_Water_C').options.find((o) => o.label === 'Water Extractor').count, 2);      // 240/120
  assert.equal(find('Desc_LiquidOil_C').options.find((o) => o.label === 'Oil Extractor · normal').count, 1); // 120/120
  assert.equal(find('Desc_NitrogenGas_C').options.find((o) => o.label === 'Well Satellite · normal').count, 1); // 60/60
});
