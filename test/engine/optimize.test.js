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

// Fix round 4: supplyAtMax mirrors supplyDrawn's shape (one entry per input
// supply, zero-filled on the infeasible path), but is sourced from pass 1
// (buildMaxSetsModel), not `chosen`. Same infeasible setup as the test just
// above, extended to check the new field carries the identical contract.
test('maxSets: supplyAtMax keeps one entry per input supply even when infeasible', () => {
  const r = maxSets({
    dataset: ironChain,
    caps: capsIron(-10),
    enabledRecipeIds: ALL_IRON_RECIPES,
    targets: [{ itemId: 'mf', weight: 1 }],
    supplies: [{ itemId: 'screw', rate: 40, kind: 'have' }],
  });
  assert.equal(r.feasible, false);
  assert.deepEqual(r.supplyAtMax, [{ itemId: 'screw', kind: 'have', used: 0 }]);
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

// Fix round 4: supplyAtMax agrees with supplyDrawn exactly when there is no
// alternate route to create pass-2-vs-pass-1 degeneracy -- screw's own
// recipe is disabled, so the supply is the sole source and both passes are
// forced to draw the identical amount. This is the control: the new field
// must not diverge from the old one in the ordinary, non-small-sets case.
test('maxSets: supplyAtMax agrees with supplyDrawn when the supply is the sole source', () => {
  const baseNoScrew = new Set([...ALL_IRON_RECIPES].filter((id) => id !== 'screw'));
  const r = maxSets({
    dataset: ironChain,
    caps: capsIron(Infinity),
    enabledRecipeIds: baseNoScrew,
    targets: [{ itemId: 'rotor', weight: 1 }],
    supplies: [{ itemId: 'screw', rate: 80, kind: 'pinned' }],
  });
  assert.equal(r.feasible, true);
  assert.equal(r.supplyAtMax.length, 1);
  assert.equal(r.supplyAtMax[0].itemId, 'screw');
  assert.ok(Math.abs(r.supplyAtMax[0].used - 80) < 1e-6, `expected 80, got ${r.supplyAtMax[0].used}`);
  assert.equal(r.supplyAtMax[0].used, r.supplyDrawn[0].used, 'no alternate route exists, so both passes must agree exactly');
});

/**
 * Fix round 4, main fix, at the unit level -- the coordinator's own repro,
 * exercised directly against maxSets() rather than through planExpansion.
 * A wholly fresh, throwaway two-item dataset (catalyst(1) -> widget(1), one
 * recipe), not derived from ironChain: have catalyst 1, max widget at
 * weight 1001. sets lands at 0.000999, small enough that
 * buildMinRawForSetsModel's flat give term dominates and `chosen`'s own
 * draw on catalyst (supplyDrawn) falls short of 1 by ~2e-6 -- exactly the
 * "shortfall 2.0e-6" the coordinator measured. supplyAtMax, read from pass 1
 * (buildMaxSetsModel, no give at all), must stay exactly 1 regardless.
 */
test('maxSets: supplyAtMax stays exact at small sets where supplyDrawn falls short', () => {
  const toy = {
    rawResourceIds: new Set(),
    recipes: [{ id: 'r', inputs: [{ itemId: 'catalyst', perMin: 1 }], outputs: [{ itemId: 'widget', perMin: 1 }] }],
  };
  const r = maxSets({
    dataset: toy,
    caps: new Map(),
    enabledRecipeIds: new Set(['r']),
    targets: [{ itemId: 'widget', weight: 1001 }],
    supplies: [{ itemId: 'catalyst', rate: 1, kind: 'have' }],
  });
  assert.equal(r.feasible, true);
  assert.ok(Math.abs(r.sets - 0.000999) < 1e-9, `expected sets ~0.000999, got ${r.sets}`);
  assert.ok(r.supplyDrawn[0].used < 1 - 1e-6, `expected supplyDrawn to fall short of 1 past a flat EPS, got ${r.supplyDrawn[0].used}`);
  assert.equal(r.supplyAtMax[0].used, 1, 'pass 1 has no give, so a binding supply is drawn to exactly its rate');
});

/**
 * Fix round 4, finding (a) -- same toy dataset, at a rate/SETS ratio well
 * above 1e4 (weight 100000 -> sets 1e-5 -> ratio 1e5). The round-3-deferred
 * concern ("whatever supply makes SETS finite must itself be SETS-scaled and
 * so safely inside its own margin") only holds under ratio ~1000; this pins
 * supplyAtMax staying exact two orders past that.
 */
test('maxSets: supplyAtMax stays exact at a rate/SETS ratio above 1e4', () => {
  const toy = {
    rawResourceIds: new Set(),
    recipes: [{ id: 'r', inputs: [{ itemId: 'catalyst', perMin: 1 }], outputs: [{ itemId: 'widget', perMin: 1 }] }],
  };
  const r = maxSets({
    dataset: toy,
    caps: new Map(),
    enabledRecipeIds: new Set(['r']),
    targets: [{ itemId: 'widget', weight: 100000 }],
    supplies: [{ itemId: 'catalyst', rate: 1, kind: 'have' }],
  });
  assert.equal(r.feasible, true);
  const ratio = 1 / r.sets;
  assert.ok(ratio > 1e4, `test setup check: expected ratio above 1e4, got ${ratio}`);
  assert.equal(r.supplyAtMax[0].used, 1, `pass 1 must stay exact at ratio ${ratio}`);
});

// --- raw resources are not producible targets -------------------------------
/**
 * Live bug: a raw resource picked as a max target came back
 * `{ sets: Infinity, feasible: true }`. Its {max: cap} constraint was replaced
 * by the target-balance {min: 0}, so the cap vanished and the -weight
 * coefficient on a net-CONSUMPTION row made "more sets" satisfiable by
 * consuming more. Reproduced on the real dataset with Iron Ore at a 240/min
 * cap; the iron-chain fixture is the same shape.
 */
test('maxSets: a raw target cannot make the objective unbounded', () => {
  const r = maxSets({ dataset: ironChain, caps: capsIron(240), enabledRecipeIds: ALL_IRON_RECIPES, targets: [{ itemId: 'ore', weight: 1 }] });
  assert.ok(Number.isFinite(r.sets), `sets must be finite, got ${r.sets}`);
  assert.equal(r.sets, 0, 'nothing producible was asked for');
  assert.deepEqual(r.perPart, [], 'and no per-part row claims a rate for it');
});

test('maxSets: a raw target alongside a real one leaves the real answer intact', () => {
  const r = maxSets({ dataset: ironChain, caps: capsIron(360), enabledRecipeIds: ALL_IRON_RECIPES, targets: [{ itemId: 'mf', weight: 1 }, { itemId: 'ore', weight: 1 }] });
  assert.ok(approx(r.sets, 15), `expected the plain max-mf answer (~15), got ${r.sets}`);
  assert.deepEqual(r.perPart.map((p) => p.itemId), ['mf'], 'the raw target is dropped, not balanced against');
});

/**
 * The same unbounded LP by a second route: with no targets at all, `__sets__`
 * appears in no constraint. Live today for a Maximize session with no part
 * picked yet, which reported "Infinity sets/min".
 */
test('maxSets: no targets returns a flat zero rather than an unbounded solve', () => {
  const r = maxSets({ dataset: ironChain, caps: capsIron(360), enabledRecipeIds: ALL_IRON_RECIPES, targets: [] });
  assert.equal(r.feasible, true);
  assert.equal(r.sets, 0);
  assert.deepEqual(r.perPart, []);
  assert.equal(r.recipeRates.size, 0);
});

/**
 * Target-rates mode had the same constraint-clobbering hole with a different
 * symptom: {min: d} replaced {max: cap}, so the ask was "met" by consuming raw
 * straight through the cap and the plan reported zero shortfall.
 */
test('hitTargets: a raw target is reported short, never met by blowing its cap', () => {
  const r = hitTargets({ dataset: ironChain, caps: capsIron(50), enabledRecipeIds: ALL_IRON_RECIPES, targets: { ore: 1000 } });
  assert.equal(r.feasible, false, 'the model cannot produce a raw resource');
  assert.equal(r.shortfalls.get('ore'), 1000);
  assert.equal(r.recipeRates.size, 0, 'and it builds nothing to pretend otherwise');
});

// --- bottleneck detection must not depend on the size of the cap ------------
/**
 * bindingResources used to be computed from the min-raw SECOND pass, whose
 * SETS relaxation (`|minSets|*1e-9 + 1e-9`, buildMinRawForSetsModel) frees
 * roughly `cap*1e-9 + (cap/sets)*1e-9` raw units. That is a RELATIVE shortfall
 * measured against a FLAT 1e-6 margin, so detection silently switched off once
 * the cap grew past ~1e3. The only pre-existing coverage sat at cap 360, just
 * under the crossover, which is why it never showed. Pass 1 has no give, so
 * the answer is now the same at every scale.
 */
for (const cap of [360, 1000, 5000, 70000, 1e6]) {
  test(`maxSets: ore reports as binding at cap ${cap}`, () => {
    const r = maxSets({ dataset: ironChain, caps: capsIron(cap), enabledRecipeIds: ALL_IRON_RECIPES, targets: [{ itemId: 'mf', weight: 1 }] });
    assert.equal(r.feasible, true);
    assert.ok(approx(r.sets, cap / 24, cap * 1e-6), `test setup check: sets should scale with the cap, got ${r.sets}`);
    assert.deepEqual(r.bindingResources, ['ore'], `the only capped resource is exhausted at cap ${cap}`);
  });
}

test('maxSets: a cap the plan cannot exhaust is not reported as binding', () => {
  // 360 ore is the whole budget; ask for a fraction of it by weighting a cheap
  // target so the LP leaves ore slack... it cannot, so use a second, oversized
  // resource instead: 'spare' is capped but no recipe touches it.
  const caps = new Map([['ore', 70000], ['spare', 70000]]);
  const r = maxSets({ dataset: ironChain, caps, enabledRecipeIds: ALL_IRON_RECIPES, targets: [{ itemId: 'mf', weight: 1 }] });
  assert.deepEqual(r.bindingResources, ['ore'], 'an untouched cap must not be reported as maxed');
});

// --- repeated max targets are one target, not two ---------------------------
/**
 * buildMaxSetsModel accumulates its per-target coefficients, so the LP total
 * was always right — but perPart carried one entry per ROW, each reporting the
 * shared `sets` figure. Two Rotor rows at weight 1 turned one 32/min answer
 * into two rows reading "16/min" each. planExpansion deduped its own rows
 * before calling in; the Optimizer path did not.
 */
test('maxSets: two rows on the same item read as one target at the full rate', () => {
  const one = maxSets({ dataset: ironChain, caps: capsIron(360), enabledRecipeIds: ALL_IRON_RECIPES, targets: [{ itemId: 'rotor', weight: 1 }] });
  const two = maxSets({ dataset: ironChain, caps: capsIron(360), enabledRecipeIds: ALL_IRON_RECIPES, targets: [{ itemId: 'rotor', weight: 1 }, { itemId: 'rotor', weight: 1 }] });
  assert.ok(approx(one.sets, 32), `test setup check: expected ~32, got ${one.sets}`);
  assert.equal(two.perPart.length, 1, 'one item, one per-part row');
  assert.ok(approx(two.perPart[0].rate, one.perPart[0].rate),
    `duplicating a row must not halve the reported rate: ${two.perPart[0].rate} vs ${one.perPart[0].rate}`);
  // `sets` itself DOES halve, and correctly so: merging by summing weights
  // makes this "2 rotors per set" rather than "1 rotor per set", exactly as one
  // row at weight 2 would. rate = weight * sets is the invariant that matters,
  // and it is what every consumer of perPart displays.
  assert.equal(two.perPart[0].weight, 2);
  assert.ok(approx(two.perPart[0].rate, two.perPart[0].weight * two.sets));
});

test('maxSets: repeated rows sum their weights, matching a single combined row', () => {
  const split = maxSets({ dataset: ironChain, caps: capsIron(360), enabledRecipeIds: ALL_IRON_RECIPES, targets: [{ itemId: 'mf', weight: 2 }, { itemId: 'rotor', weight: 1 }, { itemId: 'mf', weight: 3 }] });
  const merged = maxSets({ dataset: ironChain, caps: capsIron(360), enabledRecipeIds: ALL_IRON_RECIPES, targets: [{ itemId: 'mf', weight: 5 }, { itemId: 'rotor', weight: 1 }] });
  assert.deepEqual(split.perPart.map((p) => [p.itemId, p.weight]), [['mf', 5], ['rotor', 1]]);
  assert.ok(approx(split.sets, merged.sets), `${split.sets} vs ${merged.sets}`);
});
