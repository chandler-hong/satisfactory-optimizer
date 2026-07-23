import test from 'node:test';
import assert from 'node:assert/strict';
import { maxOutput, hitTargets, maxSets } from '../../js/engine/optimize.js';
import { ironChain, ALL_IRON_RECIPES, capsIron } from '../fixtures/iron-chain.js';

const approx = (a, b, e = 1e-5) => Math.abs(a - b) <= e;

test('maxOutput: 360 iron -> 15 Modular Frames/min', () => {
  const r = maxOutput({ dataset: ironChain, caps: capsIron(360), enabledRecipeIds: ALL_IRON_RECIPES, targetItemId: 'mf' });
  assert.equal(r.feasible, true);
  assert.ok(approx(r.maxRate, 15), `expected ~15, got ${r.maxRate}`);
  // the mf recipe makes 2/machine, so 7.5 machines -> 15/min
  assert.ok(approx(r.recipeRates.get('mf'), 7.5), `mf machines ${r.recipeRates.get('mf')}`);
});

test('maxOutput: 360 iron -> 32 Rotors/min', () => {
  const r = maxOutput({ dataset: ironChain, caps: capsIron(360), enabledRecipeIds: ALL_IRON_RECIPES, targetItemId: 'rotor' });
  assert.equal(r.feasible, true);
  assert.ok(approx(r.maxRate, 32), `expected ~32, got ${r.maxRate}`);
});

test('maxOutput: zero caps -> feasible with zero output', () => {
  const r = maxOutput({ dataset: ironChain, caps: capsIron(0), enabledRecipeIds: ALL_IRON_RECIPES, targetItemId: 'mf' });
  assert.ok(approx(r.maxRate, 0));
});

test('hitTargets: {16 rotor, 7.5 mf} feasible at 360 iron, no shortfall', () => {
  const r = hitTargets({ dataset: ironChain, caps: capsIron(360), enabledRecipeIds: ALL_IRON_RECIPES, targets: { rotor: 16, mf: 7.5 } });
  assert.equal(r.feasible, true);
  assert.equal(r.shortfalls.size, 0);
  assert.ok(r.bindingResources.includes('ore'));   // ore is fully used
});

test('hitTargets: same targets infeasible at 359 iron, reports Modular Frame shortfall', () => {
  const r = hitTargets({ dataset: ironChain, caps: capsIron(359), enabledRecipeIds: ALL_IRON_RECIPES, targets: { rotor: 16, mf: 7.5 } });
  assert.equal(r.feasible, false);
  assert.ok(r.shortfalls.get('mf') > 0, 'expected a Modular Frame shortfall');
});

test('maxSets: single target (weight 1) matches maxOutput (15 Modular Frames)', () => {
  const r = maxSets({ dataset: ironChain, caps: capsIron(360), enabledRecipeIds: ALL_IRON_RECIPES, targets: [{ itemId: 'mf', weight: 1 }] });
  assert.equal(r.feasible, true);
  assert.ok(approx(r.sets, 15), `expected ~15 sets, got ${r.sets}`);
  assert.ok(approx(r.perPart[0].rate, 15));
});

test('maxSets: balanced {mf, rotor} maximizes matched sets from 360 iron', () => {
  const r = maxSets({ dataset: ironChain, caps: capsIron(360), enabledRecipeIds: ALL_IRON_RECIPES, targets: [{ itemId: 'mf', weight: 1 }, { itemId: 'rotor', weight: 1 }] });
  assert.equal(r.feasible, true);
  // 1 mf (24 ore) + 1 rotor (11.25 ore) = 35.25 ore/set; 360/35.25 = 10.2127…
  assert.ok(approx(r.sets, 360 / 35.25, 1e-3), `expected ~10.213 sets, got ${r.sets}`);
  assert.ok(approx(r.perPart.find((p) => p.itemId === 'mf').rate, 360 / 35.25, 1e-3));
  assert.ok(approx(r.perPart.find((p) => p.itemId === 'rotor').rate, 360 / 35.25, 1e-3));
  assert.ok(r.bindingResources.includes('ore'));
});

test('maxSets: weighted 2:1 (mf:rotor) respects the ratio', () => {
  const r = maxSets({ dataset: ironChain, caps: capsIron(360), enabledRecipeIds: ALL_IRON_RECIPES, targets: [{ itemId: 'mf', weight: 2 }, { itemId: 'rotor', weight: 1 }] });
  assert.equal(r.feasible, true);
  // per set: 2 mf (48) + 1 rotor (11.25) = 59.25 ore; 360/59.25 = 6.0759 sets
  assert.ok(approx(r.sets, 360 / 59.25, 1e-3), `expected ~6.076 sets, got ${r.sets}`);
  const mf = r.perPart.find((p) => p.itemId === 'mf').rate;
  const rotor = r.perPart.find((p) => p.itemId === 'rotor').rate;
  assert.ok(approx(mf, 2 * rotor, 1e-3), `mf ${mf} should be ~2x rotor ${rotor}`);
});
