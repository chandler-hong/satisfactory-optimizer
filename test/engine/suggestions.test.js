import test from 'node:test';
import assert from 'node:assert/strict';
import { suggestAlternates } from '../../js/engine/suggestions.js';

const io = (itemId, perMin) => ({ itemId, perMin });
const R = (id, alternate, inputs, outputs) => ({ id, name: id, buildingId: 'b', alternate, inputs, outputs });
function ds(rawIds, itemNames, recipes) {
  return {
    items: new Map(Object.entries(itemNames).map(([id, name]) => [id, { id, name, slug: id, liquid: false }])),
    buildings: new Map([['b', { id: 'b', name: 'B', slug: 'b', basePowerMW: 4, powerExponent: 1.321928 }]]),
    rawResourceIds: new Set(rawIds),
    recipes,
  };
}

test('max: a higher-yield alternate is suggested with an output benefit', () => {
  const dataset = ds(['ore'], { ore: 'Ore', ingot: 'Ingot' }, [
    R('ingotBase', false, [io('ore', 60)], [io('ingot', 60)]),
    R('ingotAlt', true, [io('ore', 60)], [io('ingot', 120)]),
  ]);
  const out = suggestAlternates({
    dataset, caps: new Map([['ore', 60]]), enabledRecipeIds: new Set(['ingotBase']),
    mode: 'max', targets: [{ itemId: 'ingot', weight: 1 }],
  });
  assert.equal(out.suggestions.length, 1);
  assert.equal(out.suggestions[0].recipeId, 'ingotAlt');
  assert.equal(out.suggestions[0].benefit.kind, 'output');
  assert.ok(out.suggestions[0].benefit.deltaSets > 59, 'about +60 sets'); // 120-60
});

test('targets: a machine-saving alternate is suggested', () => {
  const dataset = ds(['ore'], { ore: 'Ore', screw: 'Screw' }, [
    R('screwBase', false, [io('ore', 10)], [io('screw', 40)]),
    R('screwCast', true, [io('ore', 12.5)], [io('screw', 100)]),
  ]);
  const out = suggestAlternates({
    dataset, caps: new Map([['ore', 1000]]), enabledRecipeIds: new Set(['screwBase']),
    mode: 'targets', targets: { screw: 200 },
  });
  const s = out.suggestions.find((x) => x.recipeId === 'screwCast');
  assert.ok(s, 'cast screw suggested');
  assert.equal(s.benefit.kind, 'machines');
  assert.equal(s.benefit.deltaMachines, 3); // 5 -> 2
});

test('targets: an alternate that resolves a shortfall is suggested', () => {
  const dataset = ds(['a', 'b'], { a: 'A', b: 'B', widget: 'Widget' }, [
    R('wBase', false, [io('b', 10)], [io('widget', 10)]),
    R('wAlt', true, [io('a', 10)], [io('widget', 10)]),
  ]);
  const out = suggestAlternates({
    dataset, caps: new Map([['a', 10]]), enabledRecipeIds: new Set(['wBase']), // only A available
    mode: 'targets', targets: { widget: 10 },
  });
  const s = out.suggestions.find((x) => x.recipeId === 'wAlt');
  assert.ok(s, 'alt using the available raw is suggested');
  assert.equal(s.benefit.kind, 'targets');
  assert.ok(s.benefit.deltaShortfall > 9, 'resolves ~10/min shortfall');
});

test('no suggestions when all alternates are already enabled', () => {
  const dataset = ds(['ore'], { ore: 'Ore', ingot: 'Ingot' }, [
    R('ingotBase', false, [io('ore', 60)], [io('ingot', 60)]),
    R('ingotAlt', true, [io('ore', 60)], [io('ingot', 120)]),
  ]);
  const out = suggestAlternates({
    dataset, caps: new Map([['ore', 60]]), enabledRecipeIds: new Set(['ingotBase', 'ingotAlt']),
    mode: 'max', targets: [{ itemId: 'ingot', weight: 1 }],
  });
  assert.deepEqual(out.suggestions, []);
  assert.equal(out.capped, false);
});

test('an alternate the optimum never uses is not suggested', () => {
  const dataset = ds(['ore'], { ore: 'Ore', ingot: 'Ingot' }, [
    R('ingotBase', false, [io('ore', 60)], [io('ingot', 60)]),
    R('ingotGood', true, [io('ore', 60)], [io('ingot', 120)]),
    R('ingotBad', true, [io('ore', 60)], [io('ingot', 30)]),
  ]);
  const out = suggestAlternates({
    dataset, caps: new Map([['ore', 60]]), enabledRecipeIds: new Set(['ingotBase']),
    mode: 'max', targets: [{ itemId: 'ingot', weight: 1 }],
  });
  assert.equal(out.suggestions.length, 1);
  assert.equal(out.suggestions[0].recipeId, 'ingotGood');
  assert.ok(!out.suggestions.some((s) => s.recipeId === 'ingotBad'));
});

test('respects the maxCandidates cap', () => {
  const dataset = ds(['ore'], { ore: 'Ore', sa: 'ScrewA', sb: 'ScrewB' }, [
    R('baseA', false, [io('ore', 10)], [io('sa', 40)]),
    R('baseB', false, [io('ore', 10)], [io('sb', 40)]),
    R('castA', true, [io('ore', 12.5)], [io('sa', 100)]),
    R('castB', true, [io('ore', 12.5)], [io('sb', 100)]),
  ]);
  const out = suggestAlternates({
    dataset, caps: new Map([['ore', 1000]]), enabledRecipeIds: new Set(['baseA', 'baseB']),
    mode: 'targets', targets: { sa: 200, sb: 200 },
  }, { maxCandidates: 1 });
  assert.equal(out.capped, true);
  assert.ok(out.suggestions.length <= 1);
});

// ore(raw) -> ingot. `ingotAlt` is a strictly better alternate: same ore in,
// 45 ingot out instead of 30. Small enough to reason about by hand.
const suggestDs = {
  rawResourceIds: new Set(['ore']),
  items: new Map([
    ['ore', { id: 'ore', name: 'Ore', slug: 'ore' }],
    ['ingot', { id: 'ingot', name: 'Ingot', slug: 'ingot' }],
  ]),
  recipes: [
    { id: 'ingot', name: 'ingot', buildingId: 'b', alternate: false, inputs: [io('ore', 30)], outputs: [io('ingot', 30)] },
    { id: 'ingotAlt', name: 'ingotAlt', buildingId: 'b', alternate: true, inputs: [io('ore', 30)], outputs: [io('ingot', 45)] },
  ],
  buildings: new Map([['b', { id: 'b', name: 'b', powerMW: 4 }]]),
};
const BASE_ONLY = new Set(['ingot']);
const CAPS = new Map([['ore', 60]]);

test('suggestAlternates: default solver still finds a better alternate (Optimizer path)', () => {
  const r = suggestAlternates({
    dataset: suggestDs, caps: CAPS, enabledRecipeIds: BASE_ONLY,
    mode: 'max', targets: [{ itemId: 'ingot', weight: 1 }],
  });
  assert.equal(r.suggestions.length, 1, 'the one disabled alternate should be suggested');
  assert.equal(r.suggestions[0].recipeId, 'ingotAlt');
  assert.equal(r.suggestions[0].benefit.kind, 'output');
  assert.match(r.suggestions[0].benefit.label, /\+30\/min Ingot \(\+50%\)/);
});

// A single disabled alternate cannot prove call site 3 (the per-candidate re-solve,
// suggestions.js:119) uses the injected solver: with only one candidate, `plusSet`
// (base + that one candidate) is set-equal to `allEnabled` (base + every candidate),
// so a regression that fell back to the real solver at call site 3 would solve the
// exact same set call site 2 already solved with the SAME injected function — and
// on this fixture both the real and injected values for that one set land below
// base.sets either way, so the two paths were indistinguishable by outcome. Two
// disabled alternates make plusSet differ from allEnabled for each candidate, and
// the injected values below are chosen so the real solver would reach the opposite
// suggest/don't-suggest verdict on each one.
test('suggestAlternates: an injected solve() replaces the built-in solver entirely', () => {
  const dataset = {
    rawResourceIds: new Set(['ore']),
    items: new Map([
      ['ore', { id: 'ore', name: 'Ore', slug: 'ore' }],
      ['ingot', { id: 'ingot', name: 'Ingot', slug: 'ingot' }],
    ]),
    recipes: [
      { id: 'ingot', name: 'ingot', buildingId: 'b', alternate: false, inputs: [io('ore', 30)], outputs: [io('ingot', 30)] },
      // Real math, load-bearing for the mutation check this test is designed to
      // catch: with ore capped at 60, ingotAlt run alone reaches 90/min (60 *
      // 45/30) — a real gain over the base recipe's own 60/min ceiling. ingotBad
      // run alongside the base recipe never draws any flow at all, since its
      // conversion (20 ingot per 30 ore) is strictly worse than the base recipe's
      // (30 per 30) — a real no-op. A real solve therefore favors ingotAlt and
      // rejects ingotBad; the injected solve below claims the exact opposite.
      { id: 'ingotAlt', name: 'ingotAlt', buildingId: 'b', alternate: true, inputs: [io('ore', 30)], outputs: [io('ingot', 45)] },
      { id: 'ingotBad', name: 'ingotBad', buildingId: 'b', alternate: true, inputs: [io('ore', 30)], outputs: [io('ingot', 20)] },
    ],
    buildings: new Map([['b', { id: 'b', name: 'b', powerMW: 4 }]]),
  };
  const enabledRecipeIds = new Set(['ingot']);
  const caps = new Map([['ore', 60]]);
  const seen = [];
  // Keyed by the sorted, comma-joined id set, so each of the four distinct sets
  // suggestAlternates can ask for (base; all-on; ingotAlt-only; ingotBad-only) gets
  // its own answer, independent of the other three.
  const SETS_BY_KEY = {
    ingot: 70,
    'ingot,ingotAlt': 1,
    'ingot,ingotBad': 500,
    'ingot,ingotAlt,ingotBad': 500,
  };
  const solve = (ids) => {
    const key = [...ids].sort().join(',');
    seen.push(key);
    const sets = SETS_BY_KEY[key] ?? 0;
    return {
      sets,
      perPart: [{ itemId: 'ingot', weight: 1, rate: sets }],
      feasible: true,
      recipeRates: new Map([['ingotAlt', 1], ['ingotBad', 1]]),
      shortfallTotal: 0,
    };
  };
  const r = suggestAlternates({
    dataset, caps, enabledRecipeIds, solve,
    mode: 'max', targets: [{ itemId: 'ingot', weight: 1 }],
  });
  assert.ok(r.suggestions.some((s) => s.recipeId === 'ingotBad'),
    'ingotBad, the injected solver\'s claimed winner, must be suggested');
  assert.ok(!r.suggestions.some((s) => s.recipeId === 'ingotAlt'),
    'ingotAlt, the injected solver\'s claimed loser, must not be suggested even though it is the real winner');
  assert.ok(seen.includes('ingot'), 'injected solve() should be called for the base set');
  assert.ok(seen.includes('ingot,ingotAlt,ingotBad'), 'injected solve() should be called for the all-on set');
  assert.ok(seen.includes('ingot,ingotAlt'), 'injected solve() should be called for the ingotAlt-only candidate set (call site 3)');
  assert.ok(seen.includes('ingot,ingotBad'), 'injected solve() should be called for the ingotBad-only candidate set (call site 3)');
});

// --- Candidate selection when the all-on probe can't be trusted ---------------

/**
 * Shaped after the real failure on the shipped dataset (Expansion -> Maximize,
 * block Iron Rod x6, max row Modular Frame): the base plan is bounded at
 * 8.57/min, the all-alternates-on probe runs away to 1.9e9, and in that runaway
 * solve the alternate that actually helps most — Steeled Frame, worth +425% —
 * carries a rate of exactly 0, while a mediocre one (Stitched Iron Plate, +75%)
 * carries all the flow. Candidate selection filtered on that map, so the winner
 * was never a candidate and the per-candidate `bounded` gate never saw it.
 *
 * `altGood`/`altOk`/`altNone` reproduce that in the three states that matter:
 * absent from the probe but a real gain, present in the probe and a small gain,
 * and no gain at all.
 */
const PROBE_DS = {
  rawResourceIds: new Set(['ore']),
  items: new Map([
    ['ore', { id: 'ore', name: 'Ore', slug: 'ore' }],
    ['frame', { id: 'frame', name: 'Frame', slug: 'frame' }],
  ]),
  recipes: [
    { id: 'mk', name: 'mk', buildingId: 'b', alternate: false, inputs: [io('ore', 30)], outputs: [io('frame', 30)] },
    { id: 'altGood', name: 'altGood', buildingId: 'b', alternate: true, inputs: [io('ore', 30)], outputs: [io('frame', 90)] },
    { id: 'altOk', name: 'altOk', buildingId: 'b', alternate: true, inputs: [io('ore', 30)], outputs: [io('frame', 45)] },
    { id: 'altNone', name: 'altNone', buildingId: 'b', alternate: true, inputs: [io('ore', 30)], outputs: [io('frame', 10)] },
  ],
  buildings: new Map([['b', { id: 'b', name: 'b', powerMW: 4 }]]),
};
const PROBE_SETS = { mk: 8, 'altGood,mk': 45, 'altOk,mk': 15, 'altNone,mk': 8 };
/**
 * @param {boolean|undefined} probeBounded what the all-on solve reports about
 *   itself; `undefined` models a solver with no boundedness concept.
 */
function probeSolver(probeBounded) {
  return (ids) => {
    const key = [...ids].sort().join(',');
    if (key === 'altGood,altNone,altOk,mk') {
      // The runaway probe: altOk carries every unit of flow, altGood none at all.
      const all = { sets: 2e9, perPart: [{ itemId: 'frame', weight: 1, rate: 2e9 }], feasible: true, shortfallTotal: 0, recipeRates: new Map([['altOk', 5e7]]) };
      return probeBounded === undefined ? all : { ...all, bounded: probeBounded };
    }
    const sets = PROBE_SETS[key] ?? 0;
    const one = { sets, perPart: [{ itemId: 'frame', weight: 1, rate: sets }], feasible: true, shortfallTotal: 0, recipeRates: new Map() };
    return probeBounded === undefined ? one : { ...one, bounded: true };
  };
}

test('suggestAlternates: an unbounded all-on probe is swept, not trusted to rank', () => {
  const r = suggestAlternates({
    dataset: PROBE_DS, caps: new Map([['ore', 60]]), enabledRecipeIds: new Set(['mk']),
    mode: 'max', targets: [{ itemId: 'frame', weight: 1 }], solve: probeSolver(false),
  });
  assert.deepEqual(
    r.suggestions.map((s) => s.recipeId), ['altGood', 'altOk'],
    'altGood is worth +37 sets and altOk only +7, so altGood must lead — pre-fix altGood was not even a candidate, because the runaway probe gave it rate 0',
  );
  assert.equal(r.evaluatedCount, 3, 'every disabled alternate is evaluated, not just the probe\'s support');
  assert.ok(!r.suggestions.some((s) => s.recipeId === 'altNone'), 'the per-candidate gate still drops an alternate with no gain');
});

/**
 * The other half of the same contract, and the reason the check is
 * `all.bounded !== false` rather than `!all.bounded`. The Optimizer's built-in
 * solver has no boundedness concept and omits the field; an implementation that
 * read a missing field as "unbounded" would silently move every Optimizer
 * session onto the sweep — a behaviour change nothing asked for, on a code path
 * whose probe is trustworthy (its raw caps make every solve finite).
 */
test('suggestAlternates: a probe that reports no boundedness at all still ranks, exactly as before', () => {
  const r = suggestAlternates({
    dataset: PROBE_DS, caps: new Map([['ore', 60]]), enabledRecipeIds: new Set(['mk']),
    mode: 'max', targets: [{ itemId: 'frame', weight: 1 }], solve: probeSolver(undefined),
  });
  assert.deepEqual(r.suggestions.map((s) => s.recipeId), ['altOk'],
    'with no boundedness reported, selection stays on the probe\'s recipe support — altOk only');
  assert.equal(r.evaluatedCount, 1);
});

/**
 * maxCandidates caps work by dropping the TAIL OF A RANKING. On the sweep there
 * is no ranking to be the tail of, so a slice would keep an arbitrary
 * `maxCandidates` alternates in dataset order and drop the rest — reintroducing
 * exactly the miss the sweep exists to prevent. `altGood` is deliberately last
 * in dataset order here and maxCandidates is 1, so any slice at all loses it.
 */
test('suggestAlternates: maxCandidates does not truncate the sweep', () => {
  const dataset = { ...PROBE_DS, recipes: [PROBE_DS.recipes[0], PROBE_DS.recipes[2], PROBE_DS.recipes[3], PROBE_DS.recipes[1]] };
  const r = suggestAlternates({
    dataset, caps: new Map([['ore', 60]]), enabledRecipeIds: new Set(['mk']),
    mode: 'max', targets: [{ itemId: 'frame', weight: 1 }], solve: probeSolver(false),
  }, { maxCandidates: 1 });
  assert.equal(r.suggestions[0]?.recipeId, 'altGood', 'the best alternate is found even though it sorts last in dataset order');
  assert.equal(r.evaluatedCount, 3);
  assert.equal(r.capped, false, 'nothing was dropped, so nothing should claim it was');
});
