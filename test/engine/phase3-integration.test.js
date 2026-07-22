import test from 'node:test';
import assert from 'node:assert/strict';
import { maxOutput } from '../../js/engine/optimize.js';
import { realize } from '../../js/engine/physical-layer.js';
import { beltReport } from '../../js/engine/belt-layer.js';
import { ironChain, ALL_IRON_RECIPES, capsIron } from '../fixtures/iron-chain.js';

test('optimize -> realize: 15 Modular Frames build is 50 machines at 0 shards', () => {
  const { recipeRates } = maxOutput({ dataset: ironChain, caps: capsIron(360), enabledRecipeIds: ALL_IRON_RECIPES, targetItemId: 'mf' });
  const r = realize({ dataset: ironChain, recipeRates, shardBudget: 0 });
  assert.equal(r.totalMachines, 50);          // ceil: ingot12 plate7 rod11 screw7 rip5 mf8
  assert.equal(r.totalShardsUsed, 0);
});

test('optimize -> realize: a shard budget reduces total machines', () => {
  const { recipeRates } = maxOutput({ dataset: ironChain, caps: capsIron(360), enabledRecipeIds: ALL_IRON_RECIPES, targetItemId: 'mf' });
  const r = realize({ dataset: ironChain, recipeRates, shardBudget: 30 });
  assert.ok(r.totalMachines < 50, `expected < 50, got ${r.totalMachines}`);
  assert.ok(r.totalShardsUsed <= 30);
});

test('optimize -> belts: ore needs 3 Mk.2 belts, 1 Mk.4 belt', () => {
  const { recipeRates } = maxOutput({ dataset: ironChain, caps: capsIron(360), enabledRecipeIds: ALL_IRON_RECIPES, targetItemId: 'mf' });
  const mk2 = beltReport({ dataset: ironChain, recipeRates, beltTier: 'Mk2' });
  assert.equal(mk2.find((r) => r.itemId === 'ore').lines, 3);
  const mk4 = beltReport({ dataset: ironChain, recipeRates, beltTier: 'Mk4' });
  assert.equal(mk4.find((r) => r.itemId === 'ore').lines, 1);
});
