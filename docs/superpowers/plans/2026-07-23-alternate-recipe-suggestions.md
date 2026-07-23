# Alternate-Recipe Improvement Suggestions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Suggest the specific disabled alternate recipes that would improve the current build (more output / fewer machines / meets-targets-or-less-raw), each with a quantified benefit and a one-click Enable.

**Architecture:** A new pure engine module `js/engine/suggestions.js` composes the existing `optimize.js` + `physical-layer.js`: it re-solves the current request with each candidate alternate added and diffs the result. `computePlan` attaches a shaped `suggestions` array to the PlanView; `render.js` shows an accent callout with an Enable button that flips the alternate's checkbox via a new `inputs.enableAlternate` wired through `main.js`. The LP/solver and all existing engine files are untouched.

**Tech Stack:** Vanilla ES modules, zero build step, no dependencies. Tests via `node --test` (node ≥ 21). Static app served by `python3 -m http.server`; UI verified with headless-Chrome screenshots.

## Global Constraints

- **No new dependencies; no build step.** Vanilla ES modules only.
- **Do NOT modify the existing engine internals** — `optimize.js`, `lp-builder.js`, `solver.js`, `physical-layer.js`, `belt-layer.js`, `resource-model.js`, `normalize.js`. `suggestions.js` may only *import and call* `optimize.js` (`maxSets`, `hitTargets`) and `physical-layer.js` (`realize`).
- **`js/engine/suggestions.js` must be PURE** — no DOM, no imports from `js/ui/*`.
- **All dataset-derived strings rendered via `textContent`, never `innerHTML`.**
- **Reuse existing CSS tokens** (`--accent`, `--surface`, `--border`, `--ink`, `--ink-2`) so light + dark both work.
- **Do NOT modify `test/fixtures/mini-data.js`** (`test/data/normalize.test.js` asserts `recipes.length === 2`). Suggestion tests use inline hand-built datasets.
- **Tests:** `npm test` runs `node --test "test/**/*.test.js"`; single file `node --test test/<path>.test.js`. Suite is currently **96 pass / 0 fail** and must stay green.
- **Commits:** conventional-commit style, one per task, ending with the trailer:
  `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`
- Work on branch `phase-7-alt-suggestions` (already created; spec committed at `a1f3b62`).

## Data-shape reference (do not re-derive)

- `maxSets({ dataset, caps, enabledRecipeIds, targets, noWaste })` → `{ feasible, sets, recipeRates: Map<recipeId,number>, perPart: [{itemId,weight,rate}], bindingResources }`. `targets` is an array `[{itemId, weight}]`.
- `hitTargets({ dataset, caps, enabledRecipeIds, targets, noWaste })` → `{ feasible, recipeRates: Map, shortfalls: Map<itemId,number>, bindingResources }`. `targets` is a map/object `{itemId: rate}`.
- `realize({ dataset, recipeRates, shardBudget })` → `{ perRecipe, totalMachines, totalShardsUsed, totalPowerMW }`.
- A recipe: `{ id, name, buildingId, alternate, inputs:[{itemId,perMin}], outputs:[{itemId,perMin}] }`. `dataset.rawResourceIds` is a Set; `dataset.items` is a `Map<id,{id,name,slug,liquid}>`.

## File Structure

| File | Responsibility |
|---|---|
| `js/engine/suggestions.js` | **new** — `suggestAlternates` analysis (pure). |
| `test/engine/suggestions.test.js` | **new** — unit tests. |
| `js/ui/view-model.js` | call `suggestAlternates`; attach shaped `suggestions`. |
| `test/ui/view-model.test.js` | extend: `suggestions` shaped + empty cases. |
| `js/ui/render.js` | `renderSuggestions` + `handlers` arg + render order. |
| `js/ui/inputs.js` | `enableAlternate(recipeId)` on the `buildInputs` return. |
| `js/main.js` | pass `onEnableAlternate` into `renderResults`. |
| `css/styles.css` | `.suggestions` accent callout + Enable button. |

---

## Task 1: `suggestAlternates` engine (pure)

**Files:**
- Create: `js/engine/suggestions.js`
- Test: `test/engine/suggestions.test.js`

**Interfaces:**
- Consumes: `maxSets`, `hitTargets` from `../engine/optimize.js`; `realize` from `../engine/physical-layer.js`.
- Produces:
  `suggestAlternates({ dataset, caps, enabledRecipeIds, mode, targets, noWaste=false, shardBudget=0 }, { maxSuggestions=4, maxCandidates=12 }={}) → { suggestions: [{ recipeId, recipeName, outputItemId, benefit: { kind:'output'|'machines'|'raw'|'targets', label, deltaSets?, deltaMachines?, deltaRaw?, deltaShortfall? } }], evaluatedCount, capped }`.

- [ ] **Step 1: Write the failing tests**

Create `test/engine/suggestions.test.js`:

```js
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/engine/suggestions.test.js`
Expected: FAIL — `suggestAlternates` is not exported / module not found.

- [ ] **Step 3: Write the implementation**

Create `js/engine/suggestions.js`:

```js
import { maxSets, hitTargets } from './optimize.js';
import { realize } from './physical-layer.js';

const EPS = 1e-6;
const round1 = (x) => Math.round(x * 10) / 10;

/** Total raw units/min a build draws: sum of positive net raw consumption. */
function rawTotal(dataset, recipeRates) {
  const byId = new Map(dataset.recipes.map((r) => [r.id, r]));
  const net = new Map();
  for (const [rid, x] of recipeRates) {
    const r = byId.get(rid);
    if (!r) continue;
    for (const i of r.inputs) if (dataset.rawResourceIds.has(i.itemId)) net.set(i.itemId, (net.get(i.itemId) || 0) + x * i.perMin);
    for (const o of r.outputs) if (dataset.rawResourceIds.has(o.itemId)) net.set(o.itemId, (net.get(o.itemId) || 0) - x * o.perMin);
  }
  let total = 0;
  for (const v of net.values()) if (v > 0) total += v;
  return total;
}

/** Solve the active mode for a given enabled-recipe set; normalized shape. */
function solveFor({ dataset, caps, mode, targets, noWaste }, recipeIds) {
  if (mode === 'targets') {
    const r = hitTargets({ dataset, caps, enabledRecipeIds: recipeIds, targets, noWaste });
    let shortfallTotal = 0;
    for (const v of r.shortfalls.values()) shortfallTotal += v;
    return { recipeRates: r.recipeRates, sets: 0, perPart: [], shortfallTotal, feasible: r.feasible };
  }
  const r = maxSets({ dataset, caps, enabledRecipeIds: recipeIds, targets, noWaste });
  return { recipeRates: r.recipeRates, sets: r.sets, perPart: r.perPart, shortfallTotal: 0, feasible: r.feasible };
}

function metricsFor(dataset, recipeRates, shardBudget) {
  const phys = realize({ dataset, recipeRates, shardBudget });
  return { totalMachines: phys.totalMachines, rawTotal: rawTotal(dataset, recipeRates) };
}

/** Primary benefit of `plus` vs `base` for the mode, or null if no real gain. */
function benefitOf(mode, base, baseM, plus, plusM, nameOf) {
  if (mode !== 'targets') {
    const deltaSets = plus.sets - base.sets;
    if (deltaSets <= EPS) return null;
    if (plus.perPart.length === 1) {
      const partName = nameOf(plus.perPart[0].itemId);
      if (base.sets <= EPS) return { kind: 'output', label: `builds this (0 → ${round1(plus.perPart[0].rate)}/min ${partName})`, deltaSets };
      const deltaRate = round1(plus.perPart[0].rate - (base.perPart[0]?.rate ?? 0));
      const pct = Math.round((deltaSets / base.sets) * 100);
      return { kind: 'output', label: `+${deltaRate}/min ${partName} (+${pct}%)`, deltaSets };
    }
    if (base.sets <= EPS) return { kind: 'output', label: `builds this (0 → ${round1(plus.sets)} sets/min)`, deltaSets };
    const pct = Math.round((deltaSets / base.sets) * 100);
    return { kind: 'output', label: `+${pct}% output (${round1(deltaSets)} sets/min)`, deltaSets };
  }
  if (base.shortfallTotal > EPS && plus.shortfallTotal < base.shortfallTotal - EPS) {
    const deltaShortfall = base.shortfallTotal - plus.shortfallTotal;
    const label = plus.shortfallTotal <= EPS
      ? `meets all targets (was short ${round1(base.shortfallTotal)}/min)`
      : `reduces shortfall by ${round1(deltaShortfall)}/min`;
    return { kind: 'targets', label, deltaShortfall };
  }
  if (plusM.totalMachines < baseM.totalMachines) {
    const deltaMachines = baseM.totalMachines - plusM.totalMachines;
    return { kind: 'machines', label: `−${deltaMachines} machines (${baseM.totalMachines} → ${plusM.totalMachines})`, deltaMachines };
  }
  if (plusM.rawTotal < baseM.rawTotal - EPS) {
    const deltaRaw = baseM.rawTotal - plusM.rawTotal;
    const pct = baseM.rawTotal > 0 ? Math.round((deltaRaw / baseM.rawTotal) * 100) : 0;
    return { kind: 'raw', label: `−${round1(deltaRaw)}/min raw (−${pct}%)`, deltaRaw };
  }
  return null;
}

const KIND_PRIORITY = { targets: 4, machines: 3, raw: 2, output: 1 };
const magnitude = (b) => b.deltaShortfall ?? b.deltaMachines ?? b.deltaRaw ?? b.deltaSets ?? 0;

/**
 * Suggest disabled alternate recipes that would improve the current build.
 * Composes the existing optimizer + physical layer; pure, no DOM.
 */
export function suggestAlternates(
  { dataset, caps, enabledRecipeIds, mode, targets, noWaste = false, shardBudget = 0 },
  { maxSuggestions = 4, maxCandidates = 12 } = {},
) {
  const disabledAlts = dataset.recipes.filter((r) => r.alternate && !enabledRecipeIds.has(r.id));
  if (disabledAlts.length === 0) return { suggestions: [], evaluatedCount: 0, capped: false };

  const params = { dataset, caps, mode, targets, noWaste };
  const base = solveFor(params, enabledRecipeIds);
  const baseM = metricsFor(dataset, base.recipeRates, shardBudget);

  const allEnabled = new Set(enabledRecipeIds);
  for (const r of disabledAlts) allEnabled.add(r.id);
  const all = solveFor(params, allEnabled);

  // Only alternates the global optimum actually uses can help; rank by usage.
  let candidates = disabledAlts
    .filter((r) => (all.recipeRates.get(r.id) || 0) > 1e-9)
    .sort((x, y) => (all.recipeRates.get(y.id) || 0) - (all.recipeRates.get(x.id) || 0));
  const capped = candidates.length > maxCandidates;
  candidates = candidates.slice(0, maxCandidates);

  const byId = new Map(dataset.recipes.map((r) => [r.id, r]));
  const nameOf = (id) => dataset.items.get(id)?.name ?? id;
  const kept = [];
  for (const cand of candidates) {
    const plusSet = new Set(enabledRecipeIds);
    plusSet.add(cand.id);
    const plus = solveFor(params, plusSet);
    const plusM = metricsFor(dataset, plus.recipeRates, shardBudget);
    const benefit = benefitOf(mode, base, baseM, plus, plusM, nameOf);
    if (benefit) kept.push({ recipeId: cand.id, recipeName: cand.name, outputItemId: byId.get(cand.id)?.outputs?.[0]?.itemId, benefit });
  }

  kept.sort((a, b) => {
    const pk = KIND_PRIORITY[b.benefit.kind] - KIND_PRIORITY[a.benefit.kind];
    return pk !== 0 ? pk : magnitude(b.benefit) - magnitude(a.benefit);
  });
  return { suggestions: kept.slice(0, maxSuggestions), evaluatedCount: candidates.length, capped };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/engine/suggestions.test.js`
Expected: PASS (6 tests).

- [ ] **Step 5: Run the full suite (no regression)**

Run: `npm test`
Expected: PASS — 0 failures (96 prior + 6 new = 102).

- [ ] **Step 6: Commit**

```bash
git add js/engine/suggestions.js test/engine/suggestions.test.js
git commit -m "feat(engine): suggestAlternates — rank disabled alternates that improve a build

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: view-model integration

**Files:**
- Modify: `js/ui/view-model.js`
- Test: `test/ui/view-model.test.js`

**Interfaces:**
- Consumes: `suggestAlternates` (Task 1).
- Produces: `computePlan(...)` return gains `suggestions: [{ recipeId, recipeName, outputSlug, benefit }]` (empty array when no disabled alternates help).

- [ ] **Step 1: Write the failing tests**

Append to `test/ui/view-model.test.js` (the module-level `normalize`/`miniRaw` imports already exist from a prior phase; these tests use their own inline dataset):

```js
test('computePlan attaches alternate-recipe suggestions', () => {
  const altDs = {
    items: new Map([
      ['ore', { id: 'ore', name: 'Ore', slug: 'ore', liquid: false }],
      ['ingot', { id: 'ingot', name: 'Ingot', slug: 'ingot', liquid: false }],
    ]),
    buildings: new Map([['b', { id: 'b', name: 'B', slug: 'b', basePowerMW: 4, powerExponent: 1.321928 }]]),
    rawResourceIds: new Set(['ore']),
    recipes: [
      { id: 'ingotBase', name: 'Ingot', buildingId: 'b', alternate: false, inputs: [{ itemId: 'ore', perMin: 60 }], outputs: [{ itemId: 'ingot', perMin: 60 }] },
      { id: 'ingotAlt', name: 'Pure Ingot', buildingId: 'b', alternate: true, inputs: [{ itemId: 'ore', perMin: 60 }], outputs: [{ itemId: 'ingot', perMin: 120 }] },
    ],
  };
  const view = computePlan(altDs, {
    mode: 'max', caps: new Map([['ore', 60]]), enabledRecipeIds: new Set(['ingotBase']),
    targets: [{ itemId: 'ingot', weight: 1 }], shardBudget: 0, beltTier: 'Mk4', pipeTier: 'Mk2',
  });
  assert.equal(view.suggestions.length, 1);
  assert.equal(view.suggestions[0].recipeId, 'ingotAlt');
  assert.equal(view.suggestions[0].recipeName, 'Pure Ingot');
  assert.equal(view.suggestions[0].outputSlug, 'ingot');
  assert.equal(view.suggestions[0].benefit.kind, 'output');
});

test('computePlan: no suggestions when the dataset has no disabled alternates', () => {
  const view = computePlan(ironChain, {
    mode: 'max', caps: capsIron(360), enabledRecipeIds: ALL_IRON_RECIPES,
    targetItemId: 'mf', shardBudget: 0, beltTier: 'Mk2',
  });
  assert.deepEqual(view.suggestions, []);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/ui/view-model.test.js`
Expected: FAIL — `view.suggestions` is undefined.

- [ ] **Step 3: Add the import**

In `js/ui/view-model.js`, add after the existing engine imports at the top:

```js
import { suggestAlternates } from '../engine/suggestions.js';
```

- [ ] **Step 4: Compute + attach suggestions**

In `js/ui/view-model.js`, in `computePlan`, immediately AFTER the requirements/`hasProduction` block (the block that ends with the `else if (!hasProduction && requirements.missing.length > 0) { ... }` closing brace) and BEFORE the `return {` statement, insert:

```js
  // --- Alternate-recipe improvement suggestions (independent of the LP) ----
  const suggestTargets = mode === 'targets'
    ? (req.targets || {})
    : (req.targets && req.targets.length ? req.targets : req.targetItemId ? [{ itemId: req.targetItemId, weight: 1 }] : []);
  const suggestions = suggestAlternates({
    dataset, caps, enabledRecipeIds, mode, targets: suggestTargets, noWaste, shardBudget,
  }).suggestions.map((s) => ({
    recipeId: s.recipeId,
    recipeName: s.recipeName,
    outputSlug: slugOf(dataset, s.outputItemId),
    benefit: s.benefit,
  }));
```

Then add `suggestions,` to the returned object literal (alongside `requirements,` / `hasProduction,`):

```js
    hasProduction,
    requirements,
    suggestions,
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `node --test test/ui/view-model.test.js`
Expected: PASS — new tests plus all pre-existing view-model tests (no regression).

- [ ] **Step 6: Commit**

```bash
git add js/ui/view-model.js test/ui/view-model.test.js
git commit -m "feat(view-model): attach alternate-recipe suggestions to the plan

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: render callout + one-click Enable wiring

**Files:**
- Modify: `js/ui/render.js`, `js/ui/inputs.js`, `js/main.js`, `css/styles.css`

**Interfaces:**
- Consumes: `planView.suggestions` (Task 2).
- Produces: `renderResults(rootEl, planView, handlers = {})` renders the suggestions callout (before the `!hasProduction` return) with an Enable button calling `handlers.onEnableAlternate(recipeId)`; `buildInputs(...)` return gains `enableAlternate(recipeId)`.

- [ ] **Step 1: Add `renderSuggestions` to render.js**

In `js/ui/render.js`, add this function just above `renderResults`:

```js
/**
 * Alternate-recipe improvement suggestions: an accent callout, each row an
 * output icon + recipe name + benefit + an Enable button that ticks the
 * alternate on via `onEnable`. Names via textContent (XSS-safe).
 */
function renderSuggestions(suggestions, onEnable) {
  const box = el('div', 'suggestions');
  const head = el('p', 'suggestions__head');
  head.textContent = '💡 Improve this build with alternate recipes:';
  box.appendChild(head);
  for (const s of suggestions) {
    const row = el('div', 'suggestion');
    row.appendChild(makeIcon(s.outputSlug, s.recipeName, 'item'));
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

- [ ] **Step 2: Wire it into `renderResults` (before the hide-empty-plan return)**

In `js/ui/render.js`, change the `renderResults` signature and insert the suggestions block after the requirements block and BEFORE the `if (!planView.hasProduction) return;` line. Replace:

```js
export function renderResults(rootEl, planView) {
  rootEl.replaceChildren();

  rootEl.appendChild(renderHeadline(planView));

  if (planView.requirements && planView.requirements.hasIssues) {
    rootEl.appendChild(renderRequirements(planView.requirements));
  }

  // Nothing to build — the requirements callout(s) above explain why. Skip the
  // empty tiles / "No production required" table / empty meters / diagram.
  if (!planView.hasProduction) return;
```

with:

```js
export function renderResults(rootEl, planView, handlers = {}) {
  rootEl.replaceChildren();

  rootEl.appendChild(renderHeadline(planView));

  if (planView.requirements && planView.requirements.hasIssues) {
    rootEl.appendChild(renderRequirements(planView.requirements));
  }

  // Rendered BEFORE the hide-empty-plan return so "enable X to build this at
  // all" still shows when the base recipes produce nothing.
  if (planView.suggestions && planView.suggestions.length > 0) {
    rootEl.appendChild(renderSuggestions(planView.suggestions, handlers.onEnableAlternate));
  }

  // Nothing to build — the requirements callout(s) above explain why. Skip the
  // empty tiles / "No production required" table / empty meters / diagram.
  if (!planView.hasProduction) return;
```

(Leave the rest of `renderResults` unchanged.)

- [ ] **Step 3: Add `enableAlternate` to `buildInputs`**

In `js/ui/inputs.js`, replace the `buildInputs` return object (currently):

```js
  return {
    readRequest,
    onChange(cb) {
      listeners.push(cb);
    },
  };
```

with:

```js
  return {
    readRequest,
    onChange(cb) {
      listeners.push(cb);
    },
    // Tick an alternate recipe on (from a results-panel suggestion) and recompute.
    enableAlternate(recipeId) {
      const entry = altRowEntries.find((e) => e.id === recipeId);
      if (!entry) return;
      entry.cb.checked = true;
      altChecked.set(recipeId, true);
      updateSummary();
      emitChange();
    },
  };
```

(`altRowEntries`, `altChecked`, `updateSummary`, and `emitChange` are all already defined in `buildInputs`'s scope.)

- [ ] **Step 4: Wire the handler in `main.js`**

In `js/main.js`, change the destructure (currently `const { readRequest, onChange } = buildInputs(dataset, sidebarEl);`) to:

```js
  const { readRequest, onChange, enableAlternate } = buildInputs(dataset, sidebarEl);
```

and change the render call inside `recompute` (currently `renderResults(resultsEl, computePlan(dataset, req));`) to:

```js
      renderResults(resultsEl, computePlan(dataset, req), { onEnableAlternate: enableAlternate });
```

- [ ] **Step 5: Add the CSS**

In `css/styles.css`, append (after the `.requirements` / `.req-dep` block added in the prior phase):

```css
/* ==========================================================================
   Alternate-recipe improvement suggestions (accent callout, one-click Enable)
   ========================================================================== */
.suggestions {
  margin-top: 0.75rem;
  padding: 0.7rem 0.85rem;
  border: 1px solid var(--border);
  border-left: 3px solid var(--accent);
  border-radius: 0.5rem;
  background: var(--surface);
  font-size: 0.88rem;
}
.suggestions__head { margin: 0 0 0.5rem; color: var(--ink); font-weight: 600; }
.suggestion {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.3rem 0;
}
.suggestion .icon { width: 1.1rem; height: 1.1rem; }
.suggestion__name { color: var(--ink); }
.suggestion__benefit { color: var(--ink-2); font-size: 0.82rem; }
.suggestion__enable {
  margin-left: auto;
  padding: 0.25rem 0.7rem;
  border: 1px solid var(--accent);
  border-radius: 0.4rem;
  background: color-mix(in srgb, var(--accent) 16%, transparent);
  color: var(--ink);
  cursor: pointer;
  font: inherit;
  font-size: 0.82rem;
}
.suggestion__enable:hover { background: color-mix(in srgb, var(--accent) 28%, transparent); }
```

- [ ] **Step 6: Verify (syntax + tests)**

Run: `node --check js/ui/render.js && node --check js/ui/inputs.js && node --check js/main.js && echo OK`
Expected: `OK`.

Run: `npm test`
Expected: PASS — 0 failures, 102 tests (unchanged from Task 2; these files have no unit tests).

- [ ] **Step 7: Commit**

```bash
git add js/ui/render.js js/ui/inputs.js js/main.js css/styles.css
git commit -m "feat(ui): alternate-recipe suggestion callout with one-click Enable

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: full verification + docs

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Full test suite**

Run: `npm test`
Expected: PASS — 0 failures, 102 tests total (96 baseline + 6 suggestions + 2 view-model; the exact count is secondary — confirm **0 fail**).

- [ ] **Step 2: Visual + interaction smoke (controller/screenshot pass)**

With `python3 -m http.server` serving the repo, in the real app confirm:
- **Maximize**, add Iron Ore, target a part with a strong alternate → a 💡 suggestion appears with a `+X/min (+P%)` benefit; clicking **Enable** ticks the alternate in the panel and the plan updates (higher output; the suggestion disappears).
- **Target rates** → a machine-saving or shortfall-resolving suggestion shows the right benefit label.
- Suggestion callout is accent-colored (distinct from red/amber requirement callouts) and readable in dark + light.

- [ ] **Step 3: Update README**

In `README.md`, add a short bullet under the existing feature notes describing alternate-recipe suggestions (one or two lines, matching the README voice).

- [ ] **Step 4: Commit + report**

```bash
git add README.md
git commit -m "docs: note alternate-recipe suggestions in README

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

Then stop and report: branch `phase-7-alt-suggestions` ready for the final whole-branch review before local merge. Do **not** push (user tests locally first).

---

## Self-Review

**Spec coverage:**
- §3–4 metrics + `suggestAlternates` (baseline → all-on candidates → per-candidate marginal → rank) → Task 1. ✅
- §5 view-model attaches shaped `suggestions` → Task 2. ✅
- §6.1 `renderSuggestions` + `handlers` + order (before hide-empty-plan) → Task 3 Steps 1-2. ✅
- §6.2 `inputs.enableAlternate` → Task 3 Step 3. ✅
- §6.3 `main.js` wiring → Task 3 Step 4. ✅
- §7 tests (output / machines / shortfall / no-alts / not-used / cap; view-model shaped + empty) → Tasks 1-2. ✅
- §8 files → all present. ✅

**Placeholder scan:** No TBD/TODO; every code step has complete code; run steps have commands + expected results. README bullet (Task 4 Step 3) is discretionary prose, not a code placeholder. ✅

**Type consistency:** `suggestAlternates` return (`suggestions[].{recipeId,recipeName,outputItemId,benefit{kind,label,delta*}}`, `capped`) matches Task 2's mapping (`outputItemId`→`outputSlug`, keeps `benefit`) and Task 3's render (`s.outputSlug`, `s.recipeName`, `s.benefit.label`, `s.recipeId`). `renderResults(rootEl, planView, handlers)` + `handlers.onEnableAlternate` matches `main.js` (`{ onEnableAlternate: enableAlternate }`) and `inputs.enableAlternate(recipeId)`. Mode/targets shapes match `maxSets` (array) / `hitTargets` (map) per the data-shape reference. ✅
