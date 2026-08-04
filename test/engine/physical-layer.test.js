import test from 'node:test';
import assert from 'node:assert/strict';
import { shardsToReach, recipeOptions, allocateShards, realize } from '../../js/engine/physical-layer.js';

const approx = (a, b, e = 1e-4) => Math.abs(a - b) <= e;

test('shardsToReach: clock thresholds', () => {
  assert.equal(shardsToReach(0.9375), 0);
  assert.equal(shardsToReach(1.0), 0);
  assert.equal(shardsToReach(1.25), 1);
  assert.equal(shardsToReach(1.5), 1);
  assert.equal(shardsToReach(2.0), 2);
  assert.equal(shardsToReach(2.5), 3);
  assert.equal(shardsToReach(2.6), Infinity);
});

test('recipeOptions(7.5): frontier includes no-shard, 150%, and max overclock', () => {
  const o = recipeOptions(7.5);
  assert.deepEqual(o.find((x) => x.machines === 8), { machines: 8, clock: 7.5 / 8, shards: 0 });
  assert.deepEqual(o.find((x) => x.machines === 5), { machines: 5, clock: 1.5, shards: 5 });
  assert.deepEqual(o.find((x) => x.machines === 3), { machines: 3, clock: 2.5, shards: 9 });
});

/**
 * The load comes from user input (a want rate, or a block's machine count), so
 * the frontier must not scale with it. Enumerating one candidate per integer
 * machine count from ceil(load/2.5) to ceil(load) built O(load) objects, and
 * allocateShards then spread that array into Math.max: at load 1.6e4 that's
 * fine, at 1.6e6 it throws RangeError, and at ~2.6e8 it allocates ~12 GB and
 * kills the browser renderer outright — an OOM no try/catch can catch, saved to
 * localStorage before the compute ran, so every later page load died the same
 * way and took all four views down with it.
 *
 * Only four candidates can ever be optimal, one per shard level: for a given
 * per-machine shard count, the smallest machine count that reaches it dominates
 * every larger one on BOTH axes (more machines and more shards), and dropping a
 * dominated option cannot remove an optimal knapsack solution. So the frontier
 * is O(1) in load, and the tests below pin that the surviving options are the
 * same ones the full enumeration would have chosen.
 */
test('recipeOptions: the frontier is bounded, not one candidate per machine count', () => {
  assert.ok(recipeOptions(1e6).length <= 4, `1e6 load gave ${recipeOptions(1e6).length} options`);
  // Before the bound this built ~1.6e7 candidate objects (~760 MB).
  const huge = recipeOptions(1e9);
  assert.ok(huge.length <= 4, `1e9 load gave ${huge.length} options`);
  assert.deepEqual(huge.at(-1), { machines: 1e9, clock: 1, shards: 0 }, 'the no-shard option still covers the load at 100%');
  assert.equal(huge[0].machines, 4e8, 'and the cheapest-machine option still runs at 250%');
});

test('recipeOptions: drops only dominated candidates, keeps the frontier in machine order', () => {
  // Full enumeration for 7.5 was n=3..8; n=6 (6 machines, 6 shards) and n=7
  // (7 machines, 7 shards) are both dominated by n=5 (5 machines, 5 shards).
  assert.deepEqual(recipeOptions(7.5).map((o) => o.machines), [3, 4, 5, 8]);
  // Small loads collapse every shard level onto the same machine count.
  assert.deepEqual(recipeOptions(0.5), [{ machines: 1, clock: 0.5, shards: 0 }]);
  assert.deepEqual(recipeOptions(1), [{ machines: 1, clock: 1, shards: 0 }]);
  // 1.5 and 2.4 are load ratios other tests depend on; both are unchanged.
  assert.deepEqual(recipeOptions(1.5).map((o) => o.machines), [1, 2]);
  assert.deepEqual(recipeOptions(2.4).map((o) => o.machines), [1, 2, 3]);
});

/**
 * The DP's shard dimension indexes an array, and both numbers that size it are
 * user-controlled: the shard-budget box directly, and the load through
 * maxUseful (3 shards per machine at the top level). A large budget against a
 * large load allocated until the process died, which in a browser is an
 * uncatchable renderer OOM rather than an exception. Bounded budgets have to
 * still solve, and an absurd one has to degrade instead of crashing.
 */
test('allocateShards: an absurd budget and load degrade instead of exhausting memory', () => {
  const items = [{ id: 'x', options: recipeOptions(1e10) }];
  const r = allocateShards(items, 1e9);
  assert.equal(r.totalMachines, 1e10, 'falls back to the no-shard option, which fits any budget');
  assert.equal(r.totalShards, 0);
  // A realistic budget on a realistic load is untouched by the ceiling.
  const real = allocateShards([{ id: 'a', options: recipeOptions(7.5) }], 9);
  assert.equal(real.totalMachines, 3);
  assert.equal(real.totalShards, 9);
});

test('allocateShards: DP minimizes machines within budget (non-convex frontier)', () => {
  const A = { id: 'A', options: recipeOptions(7.5) };
  const B = { id: 'B', options: recipeOptions(4) };
  assert.equal(allocateShards([A, B], 0).totalMachines, 12);
  assert.equal(allocateShards([A, B], 5).totalMachines, 9);
  assert.equal(allocateShards([A, B], 8).totalMachines, 8);
  assert.equal(allocateShards([A, B], 9).totalMachines, 7);
  assert.equal(allocateShards([A, B], 100).totalMachines, 5);
  // budget 5 spends exactly 5 on A -> 5 machines @150%
  const r5 = allocateShards([A, B], 5);
  assert.equal(r5.chosen.get('A').machines, 5);
  assert.equal(r5.chosen.get('A').shards, 5);
});

const dataset = {
  rawResourceIds: new Set(['ore']),
  items: new Map(),
  buildings: new Map([['bld', { id: 'bld', name: 'B', basePowerMW: 4, powerExponent: 1.321928 }]]),
  recipes: [
    { id: 'r1', name: 'r1', buildingId: 'bld', alternate: false, inputs: [{ itemId: 'ore', perMin: 20 }], outputs: [{ itemId: 'x', perMin: 10 }] },
  ],
};

test('realize: no shards -> ceil machines at even clock, exact power at 100%', () => {
  const r = realize({ dataset, recipeRates: new Map([['r1', 2]]), shardBudget: 0 });
  assert.equal(r.totalMachines, 2);           // load 2 -> 2 machines @ clock 1.0
  assert.equal(r.totalShardsUsed, 0);
  assert.equal(r.perRecipe[0].clock, 1);
  assert.equal(r.perRecipe[0].powerMW, 8);    // 2 * 4 * 1^exp = 8, exact
});

test('realize: shard budget consolidates machines and raises power', () => {
  const r = realize({ dataset, recipeRates: new Map([['r1', 2]]), shardBudget: 2 });
  assert.equal(r.totalMachines, 1);           // load 2 -> 1 machine @ 200%
  assert.equal(r.totalShardsUsed, 2);
  assert.equal(r.perRecipe[0].clock, 2);
  assert.ok(approx(r.perRecipe[0].powerMW, 4 * Math.pow(2, 1.321928))); // ~10 MW
});

test('realize: absorbs LP float noise via rounding', () => {
  const r = realize({ dataset, recipeRates: new Map([['r1', 1.99999999]]), shardBudget: 0 });
  assert.equal(r.totalMachines, 2);           // rounds to 2, not ceil(1.99999999)->2 anyway, but 2.0000001 would also -> 2
});

test('allocateShards: floors a non-integer budget and treats NaN as 0', () => {
  const A = { id: 'A', options: recipeOptions(7.5) };
  assert.equal(allocateShards([A], 5.9).totalMachines, allocateShards([A], 5).totalMachines);
  assert.equal(allocateShards([A], NaN).totalMachines, allocateShards([A], 0).totalMachines);
});
