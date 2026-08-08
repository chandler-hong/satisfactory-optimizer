import test from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeState, DEFAULT_STATE, uncoveredToRows, computeExpansionResult } from '../../js/ui/expansion.js';
import { ironChain, ALL_IRON_RECIPES } from '../fixtures/iron-chain.js';

test('sanitizeState: null / garbage falls back to defaults', () => {
  assert.deepEqual(sanitizeState(null), DEFAULT_STATE);
  assert.deepEqual(sanitizeState('nope'), DEFAULT_STATE);
  assert.deepEqual(sanitizeState({}), DEFAULT_STATE);
});

test('sanitizeState: drops rows with an unknown kind', () => {
  const s = sanitizeState({ rows: [
    { kind: 'block', recipeId: 'r', machines: 2, clock: 1 },
    { kind: 'wat', itemId: 'x', rate: 5 },
  ] });
  assert.deepEqual(s.rows.map((r) => r.kind), ['block']);
});

test('sanitizeState: coerces numbers and drops non-numeric rates', () => {
  const s = sanitizeState({ rows: [
    { kind: 'block', recipeId: 'r', machines: '6', clock: '1.5' },
    { kind: 'want', itemId: 'a', rate: 'abc' },
    { kind: 'have', itemId: 'b', rate: '300' },
  ] });
  assert.deepEqual(s.rows[0], { kind: 'block', recipeId: 'r', machines: 6, clock: 1.5 });
  assert.equal(s.rows.length, 2, 'the non-numeric rate row is dropped');
  assert.deepEqual(s.rows[1], { kind: 'have', itemId: 'b', rate: 300 });
});

/**
 * State outlives the code that wrote it, so the clamp can't live only at the
 * input. A payload from an older build, hand-edited, or pasted from someone else
 * has to come back inside the same bounds the live inputs enforce — otherwise a
 * value the UI would now refuse gets replayed straight into the plan at boot.
 */
test('sanitizeState: clamps magnitudes a stored payload could still carry', () => {
  const s = sanitizeState({ rows: [
    { kind: 'block', recipeId: 'r', machines: 1e12, clock: 1 },
    { kind: 'want', itemId: 'a', rate: 1e10 },
    { kind: 'have', itemId: 'b', rate: -5 },
    { kind: 'block', recipeId: 'r2', machines: 3, clock: -0.5 },
    { kind: 'max', itemId: 'c', weight: 1e10 },
  ] });
  assert.equal(s.rows[0].machines, 9999, 'machines clamp to MAX_MACHINES');
  assert.equal(s.rows[1].rate, 1e6, 'rates clamp to MAX_RATE');
  assert.equal(s.rows[2].rate, 0, 'a negative rate floors at 0');
  assert.equal(s.rows[3].clock, 1, 'and an invalid clock normalizes to 100%, same as the engine');
  assert.equal(s.rows[4].weight, 10000, 'weight clamps to MAX_WEIGHT');
});

test('sanitizeState: keeps only string goal ids and a positive fillMinutes', () => {
  const s = sanitizeState({ goals: ['a', 7, null, 'b'], fillMinutes: -3 });
  assert.deepEqual(s.goals, ['a', 'b']);
  assert.equal(s.fillMinutes, 10, 'a non-positive horizon falls back to the default');
});

test('uncoveredToRows: one want row per uncovered part, de-duplicated across goals', () => {
  const views = [
    { id: 'g1', uncovered: [{ itemId: 'a', name: 'A', rate: 20 }, { itemId: 'b', name: 'B', rate: 5 }] },
    { id: 'g2', uncovered: [{ itemId: 'a', name: 'A', rate: 50 }] },
  ];
  const rows = uncoveredToRows(views);
  assert.deepEqual(rows, [
    { kind: 'want', itemId: 'a', rate: 50 },
    { kind: 'want', itemId: 'b', rate: 5 },
  ], 'the same item across two goals takes the higher rate, not the sum');
});

test('uncoveredToRows: nothing uncovered yields no rows', () => {
  assert.deepEqual(uncoveredToRows([{ id: 'g', uncovered: [] }]), []);
});

test('computeExpansionResult: ok:true with a plan/goalViews/shortfallRows for a normal input', () => {
  const result = computeExpansionResult({
    dataset: ironChain,
    rows: [{ kind: 'want', itemId: 'rod', rate: 15 }],
    enabledRecipeIds: ALL_IRON_RECIPES,
    catalog: [],
    goals: [],
    fillMinutes: 10,
  });
  assert.equal(result.ok, true);
  assert.equal(result.plan.feasible, true);
  assert.deepEqual(result.goalViews, []);
  assert.deepEqual(result.shortfallRows, []);
});

/**
 * A want rate this size used to blow up: the LP sized `rod`'s load past what
 * physical-layer.js's allocateShards could handle and it threw RangeError
 * (recipeOptions built one candidate object per integer machine count, and
 * allocateShards spread that array into Math.max). recipeOptions is bounded to
 * one candidate per shard level now, so the load no longer drives the
 * allocation size and this solves cleanly instead of throwing.
 *
 * Kept as a regression guard at the UI boundary: this rate is unreachable
 * through any realistic base/have/want combination, so if it ever throws again
 * something has reintroduced a load-proportional allocation.
 */
test('computeExpansionResult: an oversized want rate no longer crashes the engine', () => {
  const result = computeExpansionResult({
    dataset: ironChain,
    rows: [{ kind: 'want', itemId: 'rod', rate: 4_000_000 }],
    enabledRecipeIds: ALL_IRON_RECIPES,
    catalog: [],
    goals: [],
    fillMinutes: 10,
  });
  assert.equal(result.ok, true, `expected a clean solve, got ${result.error}`);
  assert.equal(result.plan.feasible, true);
});

/**
 * Pins Fix 1's guard itself, independently of any particular engine crash. The
 * previous version of this test used an oversized want rate to trigger a real
 * RangeError, which pinned the catch only for as long as that specific crash
 * existed — bounding recipeOptions removed the crash and silently un-pinned the
 * guard. Injecting the fault instead keeps the contract under test: whatever
 * the engine throws, computeExpansionResult reports { ok: false } and hands the
 * error back, which is what stops recompute() (js/ui/expansion.js) from letting
 * it reach buildSecondaryView's error path and wipe the rows pane.
 */
test('computeExpansionResult: an engine throw is caught and reported as ok:false', () => {
  const exploding = Object.defineProperty({ ...ironChain }, 'recipes', {
    get() { throw new Error('dataset access exploded'); },
  });
  const result = computeExpansionResult({
    dataset: exploding,
    rows: [{ kind: 'want', itemId: 'rod', rate: 15 }],
    enabledRecipeIds: ALL_IRON_RECIPES,
    catalog: [],
    goals: [],
    fillMinutes: 10,
  });
  assert.equal(result.ok, false);
  assert.equal(result.error?.message, 'dataset access exploded');
});

/**
 * Task 5 post-plan review, Finding D. applyMode() (js/ui/expansion.js) only
 * hides goalsWrap — the checkbox list's DOM node — when the mode select reads
 * "max"; it never clears the `selected` Set backing it. That alone would just
 * waste a computation, but recompute() renders the Goals *report card*
 * separately, straight into resultsPane (the always-visible results pane) via
 * renderGoals(), a target applyMode() never touches. So pre-fix, a goal
 * checked before switching to Maximize kept being scored and its report card
 * kept rendering in full view in the results pane, complete with a live
 * "Add N shortfalls as WANT rows" button able to inject a row into the Want
 * section the user could no longer see. `rows` here deliberately carries both
 * a leftover want row and a max row at once, matching what recompute()
 * actually assembles from readAll() across every section regardless of which
 * wrapper is visible.
 */
test('computeExpansionResult: Goals is inert in max mode, matching the hidden Goals section', () => {
  const catalog = [{ id: 'g1', kind: 'milestone', label: 'Test milestone', order: 1, cost: [{ itemId: 'rod', name: 'Rod', amount: 100 }] }];
  const args = {
    dataset: ironChain,
    rows: [
      { kind: 'want', itemId: 'rod', rate: 15 },
      { kind: 'max', itemId: 'rod', weight: 1 },
    ],
    enabledRecipeIds: ALL_IRON_RECIPES,
    catalog,
    goals: ['g1'],
    fillMinutes: 10,
  };

  const targetsResult = computeExpansionResult({ ...args, mode: 'targets' });
  assert.equal(targetsResult.ok, true);
  assert.equal(targetsResult.goalViews.length, 1, 'sanity check: the selected goal is actually scored when mode is targets');

  const maxResult = computeExpansionResult({ ...args, mode: 'max' });
  assert.equal(maxResult.ok, true);
  assert.deepEqual(maxResult.goalViews, [], 'Goals stays a Target-rates feature; the Goals section is hidden in max mode and must not keep scoring behind it');
  assert.deepEqual(maxResult.shortfallRows, [], 'no shortfall-as-want-row button should have anything to inject while Goals is hidden');
});

test('sanitizeState: alts keeps known recipe id strings and nothing else', () => {
  const s = sanitizeState({ alts: ['ingot', 42, null, 'not-a-recipe', 'plate'] }, new Set(['ingot', 'plate']));
  assert.deepEqual(s.alts, ['ingot', 'plate'], 'non-strings and unknown ids are dropped');
});

test('sanitizeState: alts defaults to empty, so alternates start off', () => {
  assert.deepEqual(sanitizeState(null).alts, []);
  assert.deepEqual(sanitizeState({}).alts, []);
  assert.deepEqual(sanitizeState({ alts: 'nope' }).alts, []);
});

test('sanitizeState: without a known-id set, alt ids are kept as-is', () => {
  // The boot path passes the set; callers that don't care skip the filter.
  assert.deepEqual(sanitizeState({ alts: ['anything'] }).alts, ['anything']);
});

test('sanitizeState: a knownRecipeIds argument without a .has method is ignored, not thrown', () => {
  // Feature-test the second argument rather than trusting its type: an array
  // (one refactor away from the Set the boot path builds today) or a plain
  // object both lack .has, and must degrade to "skip the filter" like an
  // omitted argument — not throw. loadState wraps sanitizeState in try/catch,
  // so a throw here wouldn't just fail to filter; it would discard the user's
  // entire saved plan and fall back to defaults.
  assert.deepEqual(sanitizeState({ alts: ['ingot'] }, ['ingot']).alts, ['ingot']);
  assert.deepEqual(sanitizeState({ alts: ['ingot'] }, {}).alts, ['ingot']);
});

// --- Wave B test hardening ---------------------------------------------------

test('sanitizeState (D8): alts drops non-string entries even with no knownRecipeIds argument at all', () => {
  // The two existing alts tests above either supply a knownRecipeIds Set (whose
  // .has() safely returns false for a non-string, masking a missing type
  // filter) or supply only strings (which a missing type filter would also let
  // through unchanged). Neither can catch the type filter being removed; this
  // scenario — a non-string, no knownRecipeIds — can only pass if the
  // `typeof id === 'string'` filter itself is doing the work.
  assert.deepEqual(sanitizeState({ alts: ['x', 42] }).alts, ['x'], 'a non-string alt id must be dropped even when no known-id set is supplied');
});

test('sanitizeState: mode accepts only max or targets, defaulting to max', () => {
  assert.equal(sanitizeState(null).mode, 'max');
  assert.equal(sanitizeState({}).mode, 'max');
  assert.equal(sanitizeState({ mode: 'max' }).mode, 'max');
  assert.equal(sanitizeState({ mode: 'nonsense' }).mode, 'max', 'an unknown mode falls back to the default');
  assert.equal(sanitizeState({ mode: 7 }).mode, 'max', 'a non-string falls back to the default');
  // Only an explicit 'targets' opts out, so a saved state that already chose
  // Target rates is not silently flipped to the new default on load.
  assert.equal(sanitizeState({ mode: 'targets' }).mode, 'targets');
});

test('sanitizeState: max rows keep an itemId and a positive weight', () => {
  const s = sanitizeState({ rows: [
    { kind: 'max', itemId: 'a' },
    { kind: 'max', itemId: 'b', weight: 3 },
    { kind: 'max', itemId: 'c', weight: -2 },
    { kind: 'max', itemId: 'd', weight: 'abc' },
    { kind: 'max', itemId: 42, weight: 5 },
    { kind: 'max', weight: 2 },
  ] });
  assert.deepEqual(s.rows, [
    { kind: 'max', itemId: 'a', weight: 1 },
    { kind: 'max', itemId: 'b', weight: 3 },
    { kind: 'max', itemId: 'c', weight: 1 },
    { kind: 'max', itemId: 'd', weight: 1 },
  ], 'a missing/invalid weight becomes 1; a row with no itemId or a non-string itemId (42) is dropped');
});

// --- Alternate suggestions for Maximize plans --------------------------------

test('computeExpansionResult: a Maximize plan suggests an alternate that uses the block better', () => {
  const io = (itemId, perMin) => ({ itemId, perMin });
  const ds = {
    rawResourceIds: new Set([]),          // Expansion caps every raw at Infinity anyway
    items: new Map([
      ['ingot', { id: 'ingot', name: 'Ingot', slug: 'ingot' }],
      ['plate', { id: 'plate', name: 'Plate', slug: 'plate' }],
    ]),
    recipes: [
      { id: 'ingotMaker', name: 'ingotMaker', buildingId: 'b', alternate: false, inputs: [], outputs: [io('ingot', 30)] },
      { id: 'plate', name: 'plate', buildingId: 'b', alternate: false, inputs: [io('ingot', 30)], outputs: [io('plate', 20)] },
      { id: 'plateAlt', name: 'plateAlt', buildingId: 'b', alternate: true, inputs: [io('ingot', 30)], outputs: [io('plate', 30)] },
    ],
    buildings: new Map([['b', { id: 'b', name: 'b', powerMW: 4 }]]),
    goals: [],
  };
  const res = computeExpansionResult({
    dataset: ds,
    rows: [
      { kind: 'block', recipeId: 'ingotMaker', machines: 1, clock: 1 },
      { kind: 'max', itemId: 'plate', weight: 1 },
    ],
    enabledRecipeIds: new Set(['ingotMaker', 'plate']),
    catalog: [], goals: [], fillMinutes: 60, mode: 'max',
  });
  assert.equal(res.ok, true);
  assert.equal(res.plan.maximize.bounded, true, 'the block should bound the plan');
  assert.equal(res.plan.suggestions.length, 1);
  assert.equal(res.plan.suggestions[0].recipeId, 'plateAlt');
  assert.equal(res.plan.suggestions[0].outputSlug, 'plate');
  assert.match(res.plan.suggestions[0].benefit.label, /\+10\/min Plate/);
});

// Fix round 1: the three tests below used to run against `ironChain`, whose
// factory (test/fixtures/iron-chain.js:4, applied to all seven recipes at
// :11-17) hardcodes `alternate: false` on every recipe. With zero alternates,
// `disabledAlts` is empty and suggestAlternates short-circuits at
// js/engine/suggestions.js:85-86 (`if (disabledAlts.length === 0) return
// { suggestions: [] }`) before any gate below is ever reached — so all three
// tests passed even with their target gate deleted. Rebuilt on test 1's `ds`
// (a genuine disabled alternate, `plateAlt`) instead, per review.
test('computeExpansionResult: no suggestions in Target rates mode', () => {
  const io = (itemId, perMin) => ({ itemId, perMin });
  const ds = {
    rawResourceIds: new Set([]),
    items: new Map([
      ['ingot', { id: 'ingot', name: 'Ingot', slug: 'ingot' }],
      ['plate', { id: 'plate', name: 'Plate', slug: 'plate' }],
    ]),
    recipes: [
      { id: 'ingotMaker', name: 'ingotMaker', buildingId: 'b', alternate: false, inputs: [], outputs: [io('ingot', 30)] },
      { id: 'plate', name: 'plate', buildingId: 'b', alternate: false, inputs: [io('ingot', 30)], outputs: [io('plate', 20)] },
      { id: 'plateAlt', name: 'plateAlt', buildingId: 'b', alternate: true, inputs: [io('ingot', 30)], outputs: [io('plate', 30)] },
    ],
    buildings: new Map([['b', { id: 'b', name: 'b', powerMW: 4 }]]),
    goals: [],
  };
  // Same fixture and rows as test 1 above (which does get a suggestion in
  // Maximize mode) -- only `mode` differs, so a real disabled alternate is on
  // the table and the only thing that can suppress it is the mode check.
  const res = computeExpansionResult({
    dataset: ds,
    rows: [
      { kind: 'block', recipeId: 'ingotMaker', machines: 1, clock: 1 },
      { kind: 'max', itemId: 'plate', weight: 1 },
    ],
    enabledRecipeIds: new Set(['ingotMaker', 'plate']),
    catalog: [], goals: [], fillMinutes: 60, mode: 'targets',
  });
  assert.equal(res.ok, true);
  assert.deepEqual(res.plan.suggestions, [], 'suggestions are a Maximize-only feature');
});

test('computeExpansionResult: no suggestions when no max target is picked', () => {
  const io = (itemId, perMin) => ({ itemId, perMin });
  const ds = {
    rawResourceIds: new Set([]),
    items: new Map([
      ['ingot', { id: 'ingot', name: 'Ingot', slug: 'ingot' }],
      ['plate', { id: 'plate', name: 'Plate', slug: 'plate' }],
    ]),
    recipes: [
      { id: 'ingotMaker', name: 'ingotMaker', buildingId: 'b', alternate: false, inputs: [], outputs: [io('ingot', 30)] },
      { id: 'plate', name: 'plate', buildingId: 'b', alternate: false, inputs: [io('ingot', 30)], outputs: [io('plate', 20)] },
      { id: 'plateAlt', name: 'plateAlt', buildingId: 'b', alternate: true, inputs: [io('ingot', 30)], outputs: [io('plate', 30)] },
    ],
    buildings: new Map([['b', { id: 'b', name: 'b', powerMW: 4 }]]),
    goals: [],
  };
  // Same fixture as test 1 above, minus its `max` row: plateAlt is still a
  // live disabled alternate, and mode is still 'max' -- only "no max target
  // chosen" is left to suppress it.
  const res = computeExpansionResult({
    dataset: ds,
    rows: [
      { kind: 'block', recipeId: 'ingotMaker', machines: 1, clock: 1 },
    ],
    enabledRecipeIds: new Set(['ingotMaker', 'plate']),
    catalog: [], goals: [], fillMinutes: 60, mode: 'max',
  });
  assert.equal(res.ok, true);
  assert.deepEqual(res.plan.suggestions, [], 'nothing to improve until a target is picked');
});

test('computeExpansionResult: no suggestions when the plan is unbounded', () => {
  const io = (itemId, perMin) => ({ itemId, perMin });
  const ds = {
    rawResourceIds: new Set([]),
    items: new Map([
      ['ingot', { id: 'ingot', name: 'Ingot', slug: 'ingot' }],
      ['plate', { id: 'plate', name: 'Plate', slug: 'plate' }],
    ]),
    recipes: [
      { id: 'ingotMaker', name: 'ingotMaker', buildingId: 'b', alternate: false, inputs: [], outputs: [io('ingot', 30)] },
      { id: 'plate', name: 'plate', buildingId: 'b', alternate: false, inputs: [io('ingot', 30)], outputs: [io('plate', 20)] },
      { id: 'plateAlt', name: 'plateAlt', buildingId: 'b', alternate: true, inputs: [io('ingot', 30)], outputs: [io('plate', 30)] },
    ],
    buildings: new Map([['b', { id: 'b', name: 'b', powerMW: 4 }]]),
    goals: [],
  };
  // Same fixture as test 1 above, minus its `block` row: ingotMaker has no
  // inputs and nothing pins it, so plate is free to run unboundedly. plateAlt
  // is still a live disabled alternate, and a max target is still picked --
  // only "the plan is unbounded" is left to suppress it.
  const res = computeExpansionResult({
    dataset: ds,
    rows: [
      { kind: 'max', itemId: 'plate', weight: 1 },
    ],
    enabledRecipeIds: new Set(['ingotMaker', 'plate']),
    catalog: [], goals: [], fillMinutes: 60, mode: 'max',
  });
  assert.equal(res.ok, true);
  assert.equal(res.plan.maximize.bounded, false, 'sanity check: this plan really is unbounded');
  assert.deepEqual(res.plan.suggestions, [], 'an unbounded plan gets no suggestions');
});

// The brief's 5th test asserted that a disabled alternate declared as a block
// is "still suggested" (pinning spec §7's edge-case row: "enabling it lets the
// planner add more, which is a real gain"). Verified against the real,
// unmodified engine: this exact fixture produces zero suggestions, not one for
// plateAlt. Traced to js/engine/expansion.js:118-156 (blockOutputExclusions):
// declaring a recipe as a block adds ITS OWN primary output to `declared`, and
// the exclusion matches by output item, not by recipe identity — so a
// block-declared recipe always excludes itself from every one of
// suggestAlternates' internal solves (base, all-alternates-on, and the
// per-candidate re-solve). It can never accumulate a recipeRate there, never
// pass suggestAlternates' "only alternates the optimum actually uses" filter,
// and so never reaches benefitOf. This holds no matter which recipe is chosen
// as the block for that output (the match is item-scoped, not recipe-scoped)
// and is not a fixture problem — it is a structural consequence of the
// exclusion rule, which is deliberate and documented at expansion.js:118-147
// as closing a free-raws-into-capped-item hole. This test pins that verified,
// documented behaviour instead of the spec row it cannot satisfy; see the
// task report for the full derivation and a recommendation to reconcile spec
// §7 with blockOutputExclusions.
test('computeExpansionResult: an alternate declared as a block excludes itself from suggestions', () => {
  const io = (itemId, perMin) => ({ itemId, perMin });
  const ds = {
    rawResourceIds: new Set([]),
    items: new Map([
      ['ingot', { id: 'ingot', name: 'Ingot', slug: 'ingot' }],
      ['plate', { id: 'plate', name: 'Plate', slug: 'plate' }],
    ]),
    recipes: [
      { id: 'ingotMaker', name: 'ingotMaker', buildingId: 'b', alternate: false, inputs: [], outputs: [io('ingot', 60)] },
      { id: 'plate', name: 'plate', buildingId: 'b', alternate: false, inputs: [io('ingot', 30)], outputs: [io('plate', 20)] },
      { id: 'plateAlt', name: 'plateAlt', buildingId: 'b', alternate: true, inputs: [io('ingot', 30)], outputs: [io('plate', 30)] },
    ],
    buildings: new Map([['b', { id: 'b', name: 'b', powerMW: 4 }]]),
    goals: [],
  };
  const res = computeExpansionResult({
    dataset: ds,
    rows: [
      { kind: 'block', recipeId: 'ingotMaker', machines: 1, clock: 1 },
      { kind: 'block', recipeId: 'plateAlt', machines: 1, clock: 1 },
      { kind: 'max', itemId: 'plate', weight: 1 },
    ],
    enabledRecipeIds: new Set(['ingotMaker', 'plate']),   // plateAlt declared but NOT enabled
    catalog: [], goals: [], fillMinutes: 60, mode: 'max',
  });
  assert.equal(res.ok, true);
  assert.equal(res.plan.maximize.bounded, true, 'the plate block still bounds the plan at its own pinned rate');
  assert.deepEqual(
    res.plan.suggestions, [],
    'plateAlt cannot be suggested for producing more of its own block-declared output',
  );
});

// Fix round 1, finding 1: the outer gate in computeExpansionResult only checks
// the BASE plan's `bounded`. Enabling a specific alternate can only enlarge
// the feasible set, so a bounded base can go unbounded once that one
// candidate is added -- and planExpansion still returns a `sets` number even
// when `bounded` is false (a raw cap clamps it to a huge-but-finite value near
// RAW_CLAMP rather than the solve coming back infeasible; see
// js/engine/expansion.js:719-722). Reproduced here with an ingot block that
// bounds `plate`, and a disabled alternate (plateFromOre) that reaches plate
// straight from raw, uncapped ore, bypassing the block entirely: before the
// fix this fixture ranked plateFromOre top with a label of
// "+2000000000/min Plate (+10000000000%)"; the fix makes the candidate's own
// solve report sets:0 when its `bounded` is false, which drives
// deltaSets <= EPS and lets the ordinary benefitOf null-out path suppress it.
test('computeExpansionResult: a bounded base whose candidate goes unbounded gets no suggestion', () => {
  const io = (itemId, perMin) => ({ itemId, perMin });
  const ds = {
    rawResourceIds: new Set(['ore']),
    items: new Map([
      ['ore', { id: 'ore', name: 'Ore', slug: 'ore' }],
      ['ingot', { id: 'ingot', name: 'Ingot', slug: 'ingot' }],
      ['plate', { id: 'plate', name: 'Plate', slug: 'plate' }],
    ]),
    recipes: [
      { id: 'ingotMaker', name: 'ingotMaker', buildingId: 'b', alternate: false, inputs: [io('ore', 30)], outputs: [io('ingot', 30)] },
      { id: 'plate', name: 'plate', buildingId: 'b', alternate: false, inputs: [io('ingot', 30)], outputs: [io('plate', 20)] },
      { id: 'plateFromOre', name: 'plateFromOre', buildingId: 'b', alternate: true, inputs: [io('ore', 10)], outputs: [io('plate', 20)] },
    ],
    buildings: new Map([['b', { id: 'b', name: 'b', powerMW: 4 }]]),
    goals: [],
  };
  const res = computeExpansionResult({
    dataset: ds,
    rows: [
      { kind: 'block', recipeId: 'ingotMaker', machines: 1, clock: 1 },
      { kind: 'max', itemId: 'plate', weight: 1 },
    ],
    enabledRecipeIds: new Set(['ingotMaker', 'plate']),   // plateFromOre disabled
    catalog: [], goals: [], fillMinutes: 60, mode: 'max',
  });
  assert.equal(res.ok, true);
  assert.equal(res.plan.maximize.bounded, true, 'sanity check: the base plan is bounded by the block');
  assert.deepEqual(res.plan.suggestions, [], 'an unbounded candidate must be suppressed, not top-ranked');
});
