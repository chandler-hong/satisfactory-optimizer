import test from 'node:test';
import assert from 'node:assert/strict';
import { maxOutput, hitTargets } from '../../js/engine/optimize.js';
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
