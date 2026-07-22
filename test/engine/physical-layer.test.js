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
