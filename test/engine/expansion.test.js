import test from 'node:test';
import assert from 'node:assert/strict';
import { pinnedBalance, splitDemand, computeNetOutput, planExpansion } from '../../js/engine/expansion.js';
import { ironChain, ALL_IRON_RECIPES } from '../fixtures/iron-chain.js';

const r6 = (x) => Math.round(x * 1e6) / 1e6;
const rateOf = (m, id) => r6(m.get(id) || 0);
const machinesOf = (plan, recipeId) => plan.buildRows.find((b) => b.recipeId === recipeId)?.machines ?? 0;

const plan = (rows, extra = {}) => planExpansion({
  dataset: ironChain, rows, enabledRecipeIds: ALL_IRON_RECIPES, ...extra,
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

test('planExpansion: no rows yields an empty, feasible plan', () => {
  const p = plan([]);
  assert.equal(p.tiles.machines, 0);
  assert.deepEqual(p.buildRows, []);
  assert.equal(p.hasPlan, false);
});
