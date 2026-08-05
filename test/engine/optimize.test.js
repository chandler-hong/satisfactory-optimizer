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

const unbounded = new Map([['ore', Infinity]]);
const rate = (m, id) => Math.round((m.get(id) || 0) * 1e6) / 1e6;

test('hitTargets: a partial supply is drained first and the overflow is built', () => {
  const base = hitTargets({ dataset: ironChain, caps: unbounded, enabledRecipeIds: ALL_IRON_RECIPES, targets: { plate: 60, screw: 120 } });
  assert.equal(rate(base.recipeRates, 'screw'), 3);
  assert.equal(rate(base.recipeRates, 'rod'), 2);

  const r = hitTargets({
    dataset: ironChain, caps: unbounded, enabledRecipeIds: ALL_IRON_RECIPES,
    targets: { plate: 60, screw: 120 },
    supplies: [{ itemId: 'screw', rate: 60, kind: 'have' }],
  });
  assert.equal(r.feasible, true);
  assert.equal(rate(r.recipeRates, 'screw'), 1.5, 'builds for the 60/min the supply does not cover');
  assert.equal(rate(r.recipeRates, 'rod'), 1);
  assert.equal(rate(r.recipeRates, 'ingot'), 3.5);
  assert.deepEqual(r.supplyDrawn, [{ itemId: 'screw', kind: 'have', used: 60 }]);
});

test('hitTargets: a supply covering demand builds nothing for that item', () => {
  const r = hitTargets({
    dataset: ironChain, caps: unbounded, enabledRecipeIds: ALL_IRON_RECIPES,
    targets: { plate: 60, screw: 120 },
    supplies: [{ itemId: 'screw', rate: 120, kind: 'have' }],
  });
  assert.equal(rate(r.recipeRates, 'screw'), 0);
  assert.equal(rate(r.recipeRates, 'rod'), 0, 'and nothing to feed it either');
  assert.equal(rate(r.recipeRates, 'ingot'), 3);
});

// Guards the zero-cost degeneracy: `used` must mean "consumed", not "available".
test('hitTargets: an oversized supply reports the amount consumed, not its cap', () => {
  const r = hitTargets({
    dataset: ironChain, caps: unbounded, enabledRecipeIds: ALL_IRON_RECIPES,
    targets: { plate: 60, screw: 120 },
    supplies: [{ itemId: 'screw', rate: 300, kind: 'have' }],
  });
  assert.deepEqual(r.supplyDrawn, [{ itemId: 'screw', kind: 'have', used: 120 }]);
});

test('hitTargets: an unneeded supply reports zero rather than its cap', () => {
  const r = hitTargets({
    dataset: ironChain, caps: unbounded, enabledRecipeIds: ALL_IRON_RECIPES,
    targets: { plate: 60 },
    supplies: [{ itemId: 'rotor', rate: 40, kind: 'pinned' }],
  });
  assert.deepEqual(r.supplyDrawn, [{ itemId: 'rotor', kind: 'pinned', used: 0 }]);
});

test('hitTargets: pinned supply is consumed before have supply', () => {
  const r = hitTargets({
    dataset: ironChain, caps: unbounded, enabledRecipeIds: ALL_IRON_RECIPES,
    targets: { screw: 120 },
    supplies: [
      { itemId: 'screw', rate: 80, kind: 'pinned' },
      { itemId: 'screw', rate: 80, kind: 'have' },
    ],
  });
  assert.deepEqual(r.supplyDrawn, [
    { itemId: 'screw', kind: 'pinned', used: 80 },
    { itemId: 'screw', kind: 'have', used: 40 },
  ]);
});

// --- maxSets with declared supplies -----------------------------------------

/**
 * The Expansion view's maximize bound: a declared supply caps the answer, and
 * the recipes that could produce that item are withheld from the solver, so the
 * supply is the only source. rotor takes 100 screw per 4 rotor (25 each), so
 * 80 screw/min caps rotor at 3.2/min.
 */
test('maxSets: a declared supply caps the maximum and is reported as drawn', () => {
  const baseNoScrew = new Set([...ALL_IRON_RECIPES].filter((id) => id !== 'screw'));
  const r = maxSets({
    dataset: ironChain,
    caps: capsIron(Infinity),
    enabledRecipeIds: baseNoScrew,
    targets: [{ itemId: 'rotor', weight: 1 }],
    supplies: [{ itemId: 'screw', rate: 80, kind: 'pinned' }],
  });
  assert.equal(r.feasible, true);
  assert.ok(Math.abs(r.sets - 3.2) < 1e-6, `expected 3.2 rotor/min, got ${r.sets}`);
  assert.equal(r.supplyDrawn.length, 1, 'one entry per input supply');
  assert.equal(r.supplyDrawn[0].itemId, 'screw');
  assert.equal(r.supplyDrawn[0].kind, 'pinned');
  assert.ok(Math.abs(r.supplyDrawn[0].used - 80) < 1e-6, 'the supply is fully consumed, i.e. binding');
});

test('maxSets: without the supply the same request is infeasible or zero', () => {
  const baseNoScrew = new Set([...ALL_IRON_RECIPES].filter((id) => id !== 'screw'));
  const r = maxSets({
    dataset: ironChain,
    caps: capsIron(Infinity),
    enabledRecipeIds: baseNoScrew,
    targets: [{ itemId: 'rotor', weight: 1 }],
  });
  assert.ok(!r.feasible || r.sets < 1e-6, `no screw source means no rotors, got ${r.sets}`);
  assert.deepEqual(r.supplyDrawn, [], 'and nothing was drawn');
});

/**
 * The tests above disable the recipe for the supplied item, leaving the
 * supply as its sole source — both passes are then forced to draw the same
 * amount, which cannot tell `chosen` (the min-raw pass) apart from `r1` (the
 * max-sets pass). Here, `screw`'s recipe stays enabled, so both sources
 * exist. `plate`'s recipe is disabled and its supply capped at 20, which
 * hard-pins sets at 20 on its own — pass 1 (max sets) is indifferent to how
 * screw gets sourced once that cap is hit, but pass 2 (min raw, at sets=20)
 * still strictly prefers the near-free screw supply over ore-costing recipe
 * screw. This is what actually pins "supplyDrawn is read off the min-raw
 * pass, not the max-sets pass".
 */
test('maxSets: supplyDrawn reflects the min-raw pass, not the max-sets pass', () => {
  const noPlateRecipe = new Set([...ALL_IRON_RECIPES].filter((id) => id !== 'plate'));
  const r = maxSets({
    dataset: ironChain,
    caps: capsIron(1000),
    enabledRecipeIds: noPlateRecipe,
    targets: [{ itemId: 'plate', weight: 1 }, { itemId: 'screw', weight: 1 }],
    supplies: [
      { itemId: 'plate', rate: 20, kind: 'pinned' },
      { itemId: 'screw', rate: 8, kind: 'have' },
    ],
  });
  assert.equal(r.feasible, true);
  assert.ok(Math.abs(r.sets - 20) < 1e-6, `plate's own supply hard-caps sets at 20, got ${r.sets}`);
  const screw = r.supplyDrawn.find((d) => d.itemId === 'screw');
  assert.ok(Math.abs(screw.used - 8) < 1e-6, `expected the cheap screw supply fully drawn, got ${screw.used}`);
});

test('maxSets: supplyDrawn keeps one entry per input supply even when infeasible', () => {
  const r = maxSets({
    dataset: ironChain,
    caps: capsIron(-10), // negative cap: every ore-touching recipe becomes infeasible
    enabledRecipeIds: ALL_IRON_RECIPES,
    targets: [{ itemId: 'mf', weight: 1 }],
    supplies: [{ itemId: 'screw', rate: 40, kind: 'have' }],
  });
  assert.equal(r.feasible, false, 'a negative ore cap makes every ore-touching recipe infeasible');
  assert.deepEqual(r.supplyDrawn, [{ itemId: 'screw', kind: 'have', used: 0 }]);
});

test('maxSets: an unneeded supply reports zero rather than being dropped', () => {
  const r = maxSets({
    dataset: ironChain,
    caps: capsIron(360),
    enabledRecipeIds: ALL_IRON_RECIPES,
    targets: [{ itemId: 'rotor', weight: 1 }],
    supplies: [
      { itemId: 'plate', rate: 50, kind: 'pinned' }, // rotor's chain never touches plate
      { itemId: 'screw', rate: 40, kind: 'have' },
    ],
  });
  assert.equal(r.feasible, true);
  assert.equal(r.supplyDrawn.length, 2, 'both entries present, in input order');
  assert.deepEqual(r.supplyDrawn[0], { itemId: 'plate', kind: 'pinned', used: 0 }, 'unneeded, but not dropped');
  assert.equal(r.supplyDrawn[1].itemId, 'screw');
  assert.ok(r.supplyDrawn[1].used > 1e-6, `expected screw to be used, got ${r.supplyDrawn[1].used}`);
});
