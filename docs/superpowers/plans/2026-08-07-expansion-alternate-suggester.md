# Expansion Alternate Suggester Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Suggest disabled alternate recipes that would increase output in the Expansion view's Maximize mode, each with a one-click Enable.

**Architecture:** `suggestAlternates` gains an injected `solve` function, defaulting to its existing internal `solveFor` so the Optimizer path is untouched. Expansion passes a `solve` that wraps `planExpansion`, so block semantics are inherited from the real planner rather than restated. `renderSuggestions` moves to the shared `report-panels.js` and both views call it.

**Tech Stack:** Vanilla ES modules, no build step, zero runtime dependencies. `node:test` + `node:assert/strict`.

**Design spec:** `docs/superpowers/specs/2026-08-07-expansion-alternate-suggester-design.md`

## Global Constraints

- **Test command is EXACTLY** `npm test 2>&1 | grep -E "^ℹ (tests|pass|fail)|^✖ [a-z]"`. Bare `npm test` prints ~300 lines and has caused three subagent context deaths in this project. Never `node --test test/` — wrong glob, spurious failures.
- Baseline at plan start: **308 passing, 0 failing**. Every task must end green.
- `js/engine/**` and `js/domain/**` are pure: they must never import from `js/ui/**`.
- Vanilla ES modules. No build step. No new runtime dependencies.
- `.expansion-view` is a **SIBLING** of `.app` in `index.html` (`:42` vs `:25`). `.app`/`.sidebar`/`.results`-scoped CSS never reaches it. This trap has bitten the Expansion feature five times.
- **Do not add a DOM shim.** `js/ui/**` is deliberately not unit-tested (documented in README); the rendering layer is verified by running the app. Extract pure decisions as exports and test those. If a shim seems necessary, STOP and raise it.
- Conventional-commit types must match content. A commit changing production behaviour must not be typed `docs:` or `test:`.
- Do NOT push. Do NOT merge. Do not touch `main` or `expansion-alternates-and-built-blocks`.
- Branch: `optimizer-fixes-and-diagnostics`.

---

### Task 1: Inject the solver into `suggestAlternates`

Pure refactor. The Optimizer's behaviour must not change; that is the deliverable.

**Files:**
- Modify: `js/engine/suggestions.js:81-122`
- Test: `test/engine/suggestions.test.js`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `suggestAlternates({ dataset, caps, enabledRecipeIds, mode, targets, noWaste, shardBudget, solve }, opts)`. `solve` is optional; when omitted the existing internal `solveFor` is used, so all current callers keep working unchanged. When supplied it has signature `solve(recipeIds: Set<string>) -> { sets, perPart, feasible, recipeRates, shortfallTotal }`.

- [ ] **Step 1: Write the characterisation test that pins current Optimizer behaviour**

Add to `test/engine/suggestions.test.js` (create the file if it does not exist; if it does, append):

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { suggestAlternates } from '../../js/engine/suggestions.js';

// ore(raw) -> ingot. `ingotAlt` is a strictly better alternate: same ore in,
// 45 ingot out instead of 30. Small enough to reason about by hand.
const io = (itemId, perMin) => ({ itemId, perMin });
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
```

- [ ] **Step 2: Run it to confirm it passes against the CURRENT code**

Run: `npm test 2>&1 | grep -E "^ℹ (tests|pass|fail)|^✖ [a-z]"`
Expected: **309 passing, 0 failing.** This test must pass *before* the refactor — it is a characterisation test, not a red test. If it fails, the fixture is wrong; fix the fixture, not the source.

- [ ] **Step 3: Add the `solve` parameter**

In `js/engine/suggestions.js`, change the signature and the three call sites. Replace lines 81-96:

```js
export function suggestAlternates(
  { dataset, caps, enabledRecipeIds, mode, targets, noWaste = false, shardBudget = 0, solve },
  { maxSuggestions = 4, maxCandidates = 12 } = {},
) {
  const disabledAlts = dataset.recipes.filter((r) => r.alternate && !enabledRecipeIds.has(r.id));
  if (disabledAlts.length === 0) return { suggestions: [], evaluatedCount: 0, capped: false };

  // The caller may supply its own solver. Expansion does, because its plans are
  // bounded by declared blocks and Have rows rather than by raw caps, and
  // `solveFor` below models neither — pointed at an Expansion plan it would
  // rank alternates against a node-fed factory the user does not have. Passing
  // planExpansion in means those semantics are inherited rather than restated
  // here, which is where this project's escaped bugs have come from.
  const params = { dataset, caps, mode, targets, noWaste };
  const solveWith = solve || ((recipeIds) => solveFor(params, recipeIds));

  const base = solveWith(enabledRecipeIds);
  // Machine/raw metrics feed only the target-rates benefits; in Maximize mode the
  // benefit is output-only, so skip the realize() work entirely (baseM/plusM null).
  const baseM = mode === 'targets' ? metricsFor(dataset, base.recipeRates, shardBudget) : null;

  const allEnabled = new Set(enabledRecipeIds);
  for (const r of disabledAlts) allEnabled.add(r.id);
  const all = solveWith(allEnabled);
```

Then at line 111 (inside the candidate loop) replace `const plus = solveFor(params, plusSet);` with:

```js
    const plus = solveWith(plusSet);
```

- [ ] **Step 4: Run the tests to confirm nothing changed**

Run: `npm test 2>&1 | grep -E "^ℹ (tests|pass|fail)|^✖ [a-z]"`
Expected: **309 passing, 0 failing.** The characterisation test from Step 1 passing after the refactor is the proof that the Optimizer path is unaffected.

- [ ] **Step 5: Add a test proving the injected solver is actually used**

Append to `test/engine/suggestions.test.js`:

```js
test('suggestAlternates: an injected solve() replaces the built-in solver entirely', () => {
  const seen = [];
  const r = suggestAlternates({
    dataset: suggestDs, caps: CAPS, enabledRecipeIds: BASE_ONLY,
    mode: 'max', targets: [{ itemId: 'ingot', weight: 1 }],
    solve: (ids) => {
      seen.push([...ids].sort().join(','));
      // Report the alternate as making things worse, the opposite of the truth,
      // so a suggestion surviving would prove the built-in solver still ran.
      const hasAlt = ids.has('ingotAlt');
      return {
        sets: hasAlt ? 10 : 100,
        perPart: [{ itemId: 'ingot', weight: 1, rate: hasAlt ? 10 : 100 }],
        feasible: true,
        recipeRates: new Map([['ingotAlt', 1]]),
        shortfallTotal: 0,
      };
    },
  });
  assert.deepEqual(r.suggestions, [], 'an alternate the injected solver says is worse must not be suggested');
  assert.ok(seen.includes('ingot'), 'injected solve() should be called for the base set');
  assert.ok(seen.includes('ingot,ingotAlt'), 'injected solve() should be called for the all-on set');
});
```

- [ ] **Step 6: Run the tests**

Run: `npm test 2>&1 | grep -E "^ℹ (tests|pass|fail)|^✖ [a-z]"`
Expected: **310 passing, 0 failing.**

- [ ] **Step 7: Commit**

```bash
git add js/engine/suggestions.js test/engine/suggestions.test.js
git commit -m "refactor(engine): let suggestAlternates take an injected solver

Expansion's plans are bounded by declared blocks and Have rows, not by
raw caps, and solveFor models neither — aimed at an Expansion plan it
would rank alternates against a node-fed factory the user does not
have. An injected solve() lets Expansion pass planExpansion so those
semantics are inherited rather than restated in this module.

Default is unchanged, so js/ui/view-model.js's call site is untouched
and the Optimizer path is provably identical: the characterisation test
added here passes before and after the refactor."
```

---

### Task 2: Move `renderSuggestions` into the shared renderer module

**Files:**
- Modify: `js/ui/report-panels.js` (add the function, export it)
- Modify: `js/ui/render.js:189-211` (delete the local copy), `js/ui/render.js` import line
- Test: none — this is DOM-only code, deliberately not unit-tested here (see Global Constraints). Verified by the app continuing to render.

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces: `export function renderSuggestions(suggestions, onEnable)` from `js/ui/report-panels.js`. Each `suggestions[]` entry is `{ recipeId, recipeName, outputSlug, benefit: { kind, label } }`.

- [ ] **Step 1: Add the function to `report-panels.js`**

`js/ui/report-panels.js` already imports `iconEl` from `./icons.js` (line 13) and has a local `el()` helper, so no new imports are needed. `render.js`'s local `makeIcon(slug, name, kind)` is a three-line wrapper for `iconEl(slug, kind, name || '')`; inline it. Append to `js/ui/report-panels.js`:

```js
/**
 * Alternate-recipe improvement suggestions: an accent callout, each row an
 * output icon + recipe name + benefit + an Enable button that ticks the
 * alternate on via `onEnable`. Names via textContent (XSS-safe).
 *
 * Shared by the Optimizer (render.js) and Expansion (expansion-render.js).
 * The benefit label is produced by js/engine/suggestions.js and is already
 * mode-appropriate, so this renderer never inspects `benefit.kind`.
 */
export function renderSuggestions(suggestions, onEnable) {
  const box = el('div', 'suggestions');
  const head = el('p', 'suggestions__head');
  head.textContent = '💡 Improve this build with alternate recipes:';
  box.appendChild(head);
  for (const s of suggestions) {
    const row = el('div', 'suggestion');
    row.appendChild(iconEl(s.outputSlug, 'item', s.recipeName || ''));
    const name = el('span', 'suggestion__name');
    name.textContent = s.recipeName;
    row.appendChild(name);
    const benefit = el('span', 'suggestion__benefit');
    benefit.textContent = s.benefit.label;
    row.appendChild(benefit);
    const btn = el('button', 'suggestion__enable');
    btn.type = 'button';
    btn.textContent = 'Enable';
    if (onEnable) btn.addEventListener('click', () => onEnable(s.recipeId));
    row.appendChild(btn);
    box.appendChild(row);
  }
  return box;
}
```

- [ ] **Step 2: Delete the local copy from `render.js` and import instead**

Delete `js/ui/render.js:189-211` (the `function renderSuggestions` block and the docstring immediately above it at `:184-188`). Add `renderSuggestions` to the existing import from `./report-panels.js` in `js/ui/render.js`. Do not change the call site at `:232`.

- [ ] **Step 3: Confirm no stale references remain**

Run: `grep -n "makeIcon\|renderSuggestions" js/ui/render.js js/ui/report-panels.js`
Expected: `render.js` shows `renderSuggestions` only in its import and at the call site (~`:232`); `makeIcon` still exists in `render.js` for its other users. `report-panels.js` shows the new export.

- [ ] **Step 4: Run the tests**

Run: `npm test 2>&1 | grep -E "^ℹ (tests|pass|fail)|^✖ [a-z]"`
Expected: **310 passing, 0 failing.** (No behaviour change; the suite does not cover this layer.)

- [ ] **Step 5: Verify the Optimizer still renders suggestions**

Serve with `python3 -m http.server 8000` from the repo root. Drive headless Chrome over the DevTools Protocol with Node built-ins (throwaway script under `/tmp` only; no new dependency). In the Factory Optimizer add **Iron Ore** and set a target that has a useful disabled alternate; confirm the 💡 callout renders with an Enable button, and that clicking Enable ticks the alternate. **Screenshot and READ the PNG** — do not infer from source. Kill the server when done.

- [ ] **Step 6: Commit**

```bash
git add js/ui/report-panels.js js/ui/render.js
git commit -m "refactor(ui): share renderSuggestions from report-panels

Expansion needs the same callout, and report-panels.js is where the
markup both views genuinely share already lives (renderRequirements took
the same route). No markup change: render.js's local makeIcon was a
three-line wrapper for iconEl, which report-panels.js already imports."
```

---

### Task 3: Compute suggestions for an Expansion Maximize plan

**Files:**
- Modify: `js/ui/expansion.js:476-...` (`computeExpansionResult`)
- Test: `test/ui/expansion.test.js`

**Interfaces:**
- Consumes: `suggestAlternates({ ..., solve })` from Task 1.
- Produces: `computeExpansionResult(...)` returns a `plan` object carrying a new `suggestions` array, each entry `{ recipeId, recipeName, outputSlug, benefit: { kind, label } }` — the exact shape `renderSuggestions` (Task 2) consumes. Empty array whenever suggestions do not apply.

- [ ] **Step 1: Write the failing test**

Append to `test/ui/expansion.test.js`. This dataset is deliberately shaped so the suggestion is **only** correct if the block bounds the plan — with the Optimizer's raw-capped solver it would not be reachable at all, so a test that passed against the old `solveFor` would prove nothing.

```js
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

test('computeExpansionResult: no suggestions in Target rates mode', () => {
  const res = computeExpansionResult({
    dataset: ironChain, rows: [{ kind: 'want', itemId: 'rod', rate: 15 }],
    enabledRecipeIds: ALL_IRON_RECIPES,
    catalog: [], goals: [], fillMinutes: 60, mode: 'targets',
  });
  assert.deepEqual(res.plan.suggestions, [], 'suggestions are a Maximize-only feature');
});

test('computeExpansionResult: no suggestions when no max target is picked', () => {
  const res = computeExpansionResult({
    dataset: ironChain, rows: [{ kind: 'block', recipeId: 'rod', machines: 2, clock: 1 }],
    enabledRecipeIds: ALL_IRON_RECIPES,
    catalog: [], goals: [], fillMinutes: 60, mode: 'max',
  });
  assert.deepEqual(res.plan.suggestions, [], 'nothing to improve until a target is picked');
});

test('computeExpansionResult: no suggestions when the plan is unbounded', () => {
  // A max target with no block or have row feeding it: Expansion caps every raw
  // at Infinity, so nothing bounds the answer and `sets` is not a number worth
  // comparing a "+28%" against.
  const res = computeExpansionResult({
    dataset: ironChain, rows: [{ kind: 'max', itemId: 'rod', weight: 1 }],
    enabledRecipeIds: ALL_IRON_RECIPES,
    catalog: [], goals: [], fillMinutes: 60, mode: 'max',
  });
  assert.equal(res.plan.maximize.bounded, false, 'sanity check: this plan really is unbounded');
  assert.deepEqual(res.plan.suggestions, [], 'an unbounded plan gets no suggestions');
});
```

`ironChain` and `ALL_IRON_RECIPES` are already imported at the top of `test/ui/expansion.test.js`; do not add imports for them. If the unbounded test's `bounded: false` sanity assertion fails, the fixture has changed — stop and report rather than deleting the assertion.

Also add this test, which pins a decision from spec §7 that has no code of its own and could therefore be "fixed" away by a later reader:

```js
test('computeExpansionResult: an alternate declared as a block is still suggested', () => {
  // Spec §7: the picker governs what the PLANNER may choose, not what the user
  // may declare. Declaring plateAlt as a block does not enable it for the
  // planner, so suggesting it is correct — enabling it lets the plan add more.
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
  assert.ok(
    res.plan.suggestions.some((s) => s.recipeId === 'plateAlt'),
    'a disabled alternate the user has declared as a block is still worth enabling for the planner',
  );
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test 2>&1 | grep -E "^ℹ (tests|pass|fail)|^✖ [a-z]"`
Expected: **FAIL** — 5 failures, all on `res.plan.suggestions` being `undefined`.

- [ ] **Step 3: Implement**

In `js/ui/expansion.js`, add to the imports:

```js
import { suggestAlternates } from '../engine/suggestions.js';
```

Inside `computeExpansionResult`, immediately after `const plan = planExpansion({ dataset, rows, enabledRecipeIds, mode });`:

```js
    // Maximize only, and only once the plan is bounded: an unbounded plan's
    // `sets` is not a trustworthy number, so "+28% output" would be measuring
    // against nothing. Non-fatal by design, matching js/ui/view-model.js:227 —
    // a suggester failure must never take the plan down with it.
    plan.suggestions = [];
    if (mode === 'max' && plan.maximize && plan.maximize.bounded) {
      const maxTargets = rows
        .filter((r) => r.kind === 'max' && r.itemId)
        .map((r) => ({ itemId: r.itemId, weight: r.weight || 1 }));
      if (maxTargets.length > 0) {
        try {
          plan.suggestions = suggestAlternates({
            dataset,
            enabledRecipeIds,
            mode: 'max',
            targets: maxTargets,
            // Inherit Expansion's semantics by solving with the real planner:
            // gross-output-only blocks, blockOutputExclusions, raws uncapped.
            solve: (ids) => {
              const p = planExpansion({ dataset, rows, enabledRecipeIds: ids, mode });
              return {
                sets: p.maximize?.sets ?? 0,
                perPart: p.maximize?.perPart ?? [],
                feasible: p.feasible,
                recipeRates: p.recipeRates,
                shortfallTotal: 0,
              };
            },
          }).suggestions.map((s) => ({
            recipeId: s.recipeId,
            recipeName: s.recipeName,
            outputSlug: dataset.items.get(s.outputItemId)?.slug,
            benefit: s.benefit,
          }));
        } catch (err) {
          console.error('expansion suggestAlternates failed; continuing without suggestions:', err);
        }
      }
    }
```

- [ ] **Step 4: Run the tests**

Run: `npm test 2>&1 | grep -E "^ℹ (tests|pass|fail)|^✖ [a-z]"`
Expected: **315 passing, 0 failing.**

- [ ] **Step 5: Commit**

```bash
git add js/ui/expansion.js test/ui/expansion.test.js
git commit -m "feat(expansion): compute alternate suggestions for Maximize plans

Solves each candidate through planExpansion itself, so the ranking
reflects the user's declared blocks and Have rows rather than a
node-fed factory. Gated on bounded: an unbounded plan's sets is not a
number worth comparing against. Non-fatal, matching the Optimizer's
own call site."
```

---

### Task 4: Render the suggestions in the Expansion results pane

**Files:**
- Modify: `js/ui/expansion-render.js:308` (`renderPlan` signature) and `:323-325` (the maximize block), plus its import from `./report-panels.js`
- Modify: `js/ui/expansion.js:615` (the `renderPlan` call)
- Test: none — DOM-only (see Global Constraints). Verified in the browser.

**Interfaces:**
- Consumes: `renderSuggestions` from Task 2; `plan.suggestions` from Task 3.
- Produces: `renderPlan(wrap, dataset, plan, onEnableAlternate)` — a fourth positional parameter, matching the existing `renderGoals(wrap, goalViews, shortfallCount, onAddShortfalls)` convention in the same file. Omitting it renders suggestions without working Enable buttons rather than throwing.

- [ ] **Step 1: Import the shared renderer**

In `js/ui/expansion-render.js`, add `renderSuggestions` to the existing import from `./report-panels.js` at line 13.

- [ ] **Step 2: Render them after the bounded check**

Change the signature at `js/ui/expansion-render.js:308` to:

```js
export function renderPlan(wrap, dataset, plan, onEnableAlternate) {
```

Then in the maximize block at `:323-325`, add the suggestions render **after** the early return:

```js
  if (plan.mode === 'max' && plan.maximize) {
    wrap.appendChild(renderMaximizePanel(plan.maximize));
    if (!plan.maximize.bounded) return;
    // Placed after the unbounded early-return on purpose: that branch renders
    // only a refusal message, and "+28% output" against an unbounded plan
    // would be measuring a gain over nothing.
    if (plan.suggestions && plan.suggestions.length > 0) {
      wrap.appendChild(renderSuggestions(plan.suggestions, onEnableAlternate));
    }
  }
```

- [ ] **Step 3: Pass the enable handler from the view**

In `js/ui/expansion.js`, change the call at `:615` to:

```js
      renderPlan(resultsPane, dataset, result.plan, (recipeId) => {
        altPicker.enableOne(recipeId);
      });
```

`altPicker.enableOne` already exists (`js/ui/alt-picker.js:154`) and is used the same way by `js/ui/inputs.js:675`. It ticks the checkbox in the bottom alternates panel and fires the picker's `onChange`, which triggers a re-solve — so no manual recompute call is needed here.

- [ ] **Step 4: Run the tests**

Run: `npm test 2>&1 | grep -E "^ℹ (tests|pass|fail)|^✖ [a-z]"`
Expected: **315 passing, 0 failing.**

- [ ] **Step 5: Verify in a real browser**

Serve with `python3 -m http.server 8000` from the repo root. Drive headless Chrome over the DevTools Protocol using Node built-ins (throwaway script under `/tmp` only; no new dependency). **Screenshot and READ the PNGs with the Read tool — do not infer appearance from CSS.** Kill the server when done.

Verify all of:
1. Expansion → Maximize with a block declared and a target picked → the 💡 callout renders in the **results pane, below the "Most you can make" readout**.
2. Clicking **Enable** ticks that recipe in the bottom alternates panel, the count rises (e.g. `0/110` → `1/110`), and the maximize number increases.
3. Maximize with **no target picked** → no callout (the readout shows "Pick something to maximize").
4. An **unbounded** plan (a target no declared block feeds) → no callout, only the refusal message.
5. **Target rates** mode → no callout.
6. Both **dark and light** themes, and a **760px** viewport. `.expansion-view` is a sibling of `.app`, so confirm `.suggestions` is actually styled here and not inheriting nothing — check the computed `background-color` of the callout rather than reading the stylesheet.
7. **Zero console errors** in every state visited.

- [ ] **Step 6: Commit**

```bash
git add js/ui/expansion-render.js js/ui/expansion.js
git commit -m "feat(expansion): show alternate suggestions under the maximize readout

Rendered after the unbounded early-return, so a plan with nothing
bounding it shows only its refusal message. Enable routes to the
existing altPicker.enableOne, which ticks the box in the alternates
panel and re-solves."
```

- [ ] **Step 7: If the callout is unstyled in Expansion, add the CSS**

Only if Step 5.6 shows `.suggestions` resolving to a transparent background in `.expansion-view`. The existing rules are `.app`-scoped and will not reach it — this is the sibling trap that has bitten this feature five times. Follow the precedent set by `.exp-controls`/`.exp-alts` in `css/styles.css`: extend the existing selector list rather than duplicating the declaration block, so the two views cannot drift apart. Re-screenshot after the change and commit separately as `fix(css):`.
