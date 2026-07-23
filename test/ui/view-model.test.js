import test from 'node:test';
import assert from 'node:assert/strict';
import { computePlan } from '../../js/ui/view-model.js';
import { ironChain, ALL_IRON_RECIPES, capsIron } from '../fixtures/iron-chain.js';

const approx = (a, b, e = 1e-4) => Math.abs(a - b) <= e;

test('computePlan (max mode) shapes a PlanView from the iron chain', () => {
  const view = computePlan(ironChain, {
    mode: 'max', caps: capsIron(360), enabledRecipeIds: ALL_IRON_RECIPES,
    targetItemId: 'mf', shardBudget: 0, beltTier: 'Mk2', pipeTier: 'Mk2',
  });
  assert.equal(view.feasible, true);
  assert.match(view.headline, /15\b/);                 // 15 Modular Frames/min
  assert.equal(view.tiles.machines, 50);
  assert.equal(view.tiles.shards, 0);
  // ore meter: fully used and binding
  const ore = view.resourceMeters.find((m) => m.itemId === 'ore');
  assert.ok(approx(ore.used, 360));
  assert.equal(ore.available, 360);
  assert.equal(ore.binding, true);
  assert.ok(approx(ore.pct, 1));
  // build rows: one per active recipe, sorted by machines desc
  assert.equal(view.buildRows.length, 6);
  for (let i = 1; i < view.buildRows.length; i++) assert.ok(view.buildRows[i - 1].machines >= view.buildRows[i].machines);
  // belt rows include ore at 360 -> 3 lines on Mk2
  const oreBelt = view.beltRows.find((b) => b.itemId === 'ore');
  assert.equal(oreBelt.lines, 3);
});

test('computePlan (targets mode) reports shortfalls', () => {
  const view = computePlan(ironChain, {
    mode: 'targets', caps: capsIron(359), enabledRecipeIds: ALL_IRON_RECIPES,
    targets: { rotor: 16, mf: 7.5 }, shardBudget: 0, beltTier: 'Mk2',
  });
  assert.equal(view.feasible, false);
  assert.ok(view.shortfalls.some((s) => s.itemId === 'mf' && s.amount > 0));
});
