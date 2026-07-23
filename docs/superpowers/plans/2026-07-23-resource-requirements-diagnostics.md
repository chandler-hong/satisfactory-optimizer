# Resource Requirements & Feasibility Diagnostics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tell the user which raw resources a target needs, flag genuinely-impossible resource/target combos with a clear error, add a default-vein note, and fix the cramped target picker rows + wrapping dropdown.

**Architecture:** A new pure engine module (`js/engine/requirements.js`) decides, per target, whether it's buildable from the added resources — and if not, whether that's a "missing inputs" (amber) or "these resources can't make it" (red) situation, plus the raw-dependency list. `computePlan` (view-model) calls it and attaches a render-ready `requirements` object + `hasProduction` flag to the `PlanView`; `render.js` shows callouts and hides the empty plan. The LP/solver is untouched. UI layout fixes are CSS + light DOM restructuring in `inputs.js`.

**Tech Stack:** Vanilla ES modules, zero build step, no dependencies. Tests via `node --test` (node ≥ 21). Static app served by `python3 -m http.server`; UI verified with headless-Chrome screenshots.

## Global Constraints

- **No new dependencies; no build step.** Vanilla ES modules only.
- **No LP/solver/optimize/physical/belt changes.** This feature sits alongside the engine, never inside it.
- **Pure engine modules stay pure** — `js/engine/requirements.js` imports nothing from the DOM and is fully unit-tested, like `resource-model.js`.
- **All dataset-derived strings rendered via `textContent`, never `innerHTML`** (XSS-safe pattern already used throughout `render.js`).
- **Reuse existing CSS tokens** (`--warning`, `--critical`, `--surface`, `--border`, `--ink`, `--ink-2`, `--ink-muted`, `--good`, `--accent`) so light and dark themes both work. Never rely on color alone — pair every status color with a ✓/✗ mark or text.
- **Tests:** `npm test` runs `node --test "test/**/*.test.js"`; a single file runs as `node --test test/<path>.test.js`. Full suite is currently **65/65 passing** and must stay green.
- **Do NOT modify `test/fixtures/mini-data.js`** — `test/data/normalize.test.js` asserts `ds.recipes.length === 2`. Any extra fixture recipes go in an inline hand-built dataset inside the requirements test (mirroring `test/fixtures/iron-chain.js`).
- **Commits:** conventional-commit style (`feat:` / `fix:` / `docs:`), one per task, ending with the trailer:
  `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`
- Work on branch `phase-6-requirements-diagnostics` (already created; spec committed at `aad70de`).

## Dataset shape (reference — do not re-derive)

`normalize(raw)` → `{ items: Map<id,{id,name,slug,liquid,energyValue}>, buildings: Map, recipes: Array<{id,name,buildingId,alternate,inputs:[{itemId,perMin}],outputs:[{itemId,perMin}]}>, rawResourceIds: Set<id>, generators: [] }`.

`normalize(miniRaw)` yields exactly two machine recipes over **disjoint branches**: `Recipe_IngotIron_C` (`Desc_OreIron_C` → `Desc_IronIngot_C`) and `Recipe_Plastic_C` (`Desc_LiquidOil_C` → `Desc_Plastic_C` + `Desc_HeavyOilResidue_C`); `rawResourceIds = {Desc_OreIron_C, Desc_LiquidOil_C}`. This is the crude-oil-can't-make-iron test bed.

## File Structure

| File | Responsibility |
|---|---|
| `js/engine/requirements.js` | **new** — pure reachability/dependency analysis. Exports `producibleClosure` + `analyzeRequirements`. |
| `test/engine/requirements.test.js` | **new** — unit tests for the module. |
| `js/ui/view-model.js` | call `analyzeRequirements`, shape `requirements`, add `hasProduction`; override headline when impossible. |
| `test/ui/view-model.test.js` | extend: requirements shape + `hasProduction` + no-regression. |
| `js/ui/render.js` | `renderRequirements` callouts under the headline; hide plan sections when `!hasProduction`. |
| `js/ui/inputs.js` | vein hint line; two-line `makeMaxTargetRow` / `makeTargetRow`. |
| `css/styles.css` | dropdown width, `.target-row` column layout, `.requirements` / `.req-dep` callout styles. |

---

## Task 1: `producibleClosure` (pure)

**Files:**
- Create: `js/engine/requirements.js`
- Test: `test/engine/requirements.test.js`

**Interfaces:**
- Consumes: the `Dataset` shape (`recipes`, `rawResourceIds`).
- Produces: `producibleClosure(dataset, enabledRecipeIds: Set<string>, seedIds: Iterable<string>) → { producible: Set<string>, firedRecipeIds: Set<string> }`. A recipe fires when all its inputs are producible; its outputs then become producible; iterated to a fixpoint (cycle-safe).

- [ ] **Step 1: Write the failing test**

Create `test/engine/requirements.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { normalize } from '../../js/data/normalize.js';
import { miniRaw } from '../fixtures/mini-data.js';
import { producibleClosure } from '../../js/engine/requirements.js';

const ds = normalize(miniRaw);
const ALL = new Set(ds.recipes.map((r) => r.id)); // Recipe_IngotIron_C, Recipe_Plastic_C

test('producibleClosure: ore seed makes iron ingot, not plastic', () => {
  const { producible, firedRecipeIds } = producibleClosure(ds, ALL, ['Desc_OreIron_C']);
  assert.ok(producible.has('Desc_IronIngot_C'));
  assert.ok(!producible.has('Desc_Plastic_C'));
  assert.ok(firedRecipeIds.has('Recipe_IngotIron_C'));
  assert.ok(!firedRecipeIds.has('Recipe_Plastic_C'));
});

test('producibleClosure: oil seed makes plastic + heavy oil residue, not iron', () => {
  const { producible } = producibleClosure(ds, ALL, ['Desc_LiquidOil_C']);
  assert.ok(producible.has('Desc_Plastic_C'));
  assert.ok(producible.has('Desc_HeavyOilResidue_C'));
  assert.ok(!producible.has('Desc_IronIngot_C'));
});

test('producibleClosure: a disabled recipe never fires', () => {
  const onlyPlastic = new Set(['Recipe_Plastic_C']);
  const { producible } = producibleClosure(ds, onlyPlastic, ['Desc_OreIron_C']);
  assert.ok(!producible.has('Desc_IronIngot_C')); // iron recipe disabled
});

test('producibleClosure: seeds are always producible; terminates on a cycle', () => {
  // Inline dataset with an A<->B cycle that can only start from a seed.
  const cyc = {
    rawResourceIds: new Set(['seed']),
    recipes: [
      { id: 'ra', inputs: [{ itemId: 'b', perMin: 1 }], outputs: [{ itemId: 'a', perMin: 1 }] },
      { id: 'rb', inputs: [{ itemId: 'a', perMin: 1 }], outputs: [{ itemId: 'b', perMin: 1 }] },
      { id: 'seedA', inputs: [{ itemId: 'seed', perMin: 1 }], outputs: [{ itemId: 'a', perMin: 1 }] },
    ],
  };
  const { producible } = producibleClosure(cyc, new Set(['ra', 'rb', 'seedA']), ['seed']);
  assert.ok(producible.has('seed') && producible.has('a') && producible.has('b'));
  // Without the seed, the pure A<->B loop must NOT bootstrap itself.
  const none = producibleClosure(cyc, new Set(['ra', 'rb']), []);
  assert.ok(!none.producible.has('a') && !none.producible.has('b'));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/engine/requirements.test.js`
Expected: FAIL — `producibleClosure` is not exported / module not found.

- [ ] **Step 3: Write minimal implementation**

Create `js/engine/requirements.js`:

```js
/**
 * Reachability / dependency analysis over recipes — decides whether a target
 * can be produced from a set of available raw resources, and if not, why.
 * Pure: no DOM, no solver. Depends only on the Dataset shape.
 * @typedef {import('../domain/model.js').Dataset} Dataset
 */

/**
 * Forward producible closure. Starting from `seedIds`, a recipe in
 * `enabledRecipeIds` "fires" once all its inputs are producible, adding its
 * outputs. Iterated to a fixpoint, so cycles terminate (a pure A↔B loop never
 * bootstraps without a seed).
 * @param {Dataset} dataset
 * @param {Set<string>} enabledRecipeIds
 * @param {Iterable<string>} seedIds
 * @returns {{ producible: Set<string>, firedRecipeIds: Set<string> }}
 */
export function producibleClosure(dataset, enabledRecipeIds, seedIds) {
  const producible = new Set(seedIds);
  const firedRecipeIds = new Set();
  const recipes = dataset.recipes.filter((r) => enabledRecipeIds.has(r.id));
  let changed = true;
  while (changed) {
    changed = false;
    for (const r of recipes) {
      if (firedRecipeIds.has(r.id)) continue;
      if (r.inputs.every((i) => producible.has(i.itemId))) {
        firedRecipeIds.add(r.id);
        for (const o of r.outputs) producible.add(o.itemId);
        changed = true;
      }
    }
  }
  return { producible, firedRecipeIds };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/engine/requirements.test.js`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add js/engine/requirements.js test/engine/requirements.test.js
git commit -m "feat(engine): producibleClosure reachability fixpoint

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: `analyzeRequirements` (pure)

**Files:**
- Modify: `js/engine/requirements.js` (add `rawAncestors` + `analyzeRequirements`)
- Test: `test/engine/requirements.test.js` (add cases)

**Interfaces:**
- Consumes: `producibleClosure` (Task 1).
- Produces:
  `analyzeRequirements(dataset, enabledRecipeIds: Set, availableRawIds: Set, userAddedRawIds: Set, targetItemIds: string[]) → { perTarget: Array<{ itemId, status: 'ok'|'missing'|'impossible', reason: 'buildable'|'partial'|'no-resources'|'wrong-resources'|'no-recipe', deps: Array<{itemId, added:boolean}> }>, anyImpossible: boolean, anyMissing: boolean }`.
  - `availableRawIds` — raws with cap > 0 incl auto-water (drives buildability + the `added` flag).
  - `userAddedRawIds` — raws the user explicitly added (finite cap > 0), excl auto-water (drives severity).
  - `deps` — the target's raw ancestors, each flagged `added = availableRawIds.has(itemId)`, sorted by item id.

- [ ] **Step 1: Write the failing tests**

Append to `test/engine/requirements.test.js`:

```js
import { analyzeRequirements } from '../../js/engine/requirements.js';

const one = (out, avail, userAdded, targets) =>
  analyzeRequirements(ds, ALL, new Set(avail), new Set(userAdded), targets).perTarget.find((p) => p.itemId === out);

test('analyzeRequirements: buildable target is ok', () => {
  const p = one('Desc_IronIngot_C', ['Desc_OreIron_C'], ['Desc_OreIron_C'], ['Desc_IronIngot_C']);
  assert.equal(p.status, 'ok');
});

test('analyzeRequirements: wrong resource added -> impossible (crude oil -> iron ingot)', () => {
  const p = one('Desc_IronIngot_C', ['Desc_LiquidOil_C'], ['Desc_LiquidOil_C'], ['Desc_IronIngot_C']);
  assert.equal(p.status, 'impossible');
  assert.equal(p.reason, 'wrong-resources');
  assert.deepEqual(p.deps, [{ itemId: 'Desc_OreIron_C', added: false }]);
});

test('analyzeRequirements: nothing added yet -> missing (no-resources)', () => {
  const p = one('Desc_IronIngot_C', [], [], ['Desc_IronIngot_C']);
  assert.equal(p.status, 'missing');
  assert.equal(p.reason, 'no-resources');
  assert.deepEqual(p.deps, [{ itemId: 'Desc_OreIron_C', added: false }]);
});

test('analyzeRequirements: target that is itself a raw', () => {
  const added = one('Desc_OreIron_C', ['Desc_OreIron_C'], ['Desc_OreIron_C'], ['Desc_OreIron_C']);
  assert.equal(added.status, 'ok');
  const notAdded = one('Desc_OreIron_C', [], [], ['Desc_OreIron_C']);
  assert.equal(notAdded.status, 'missing');
});

test('analyzeRequirements: no enabled recipe produces the target -> impossible (no-recipe)', () => {
  // Iron ingot with the iron recipe disabled: no path from any raw.
  const res = analyzeRequirements(ds, new Set(['Recipe_Plastic_C']),
    new Set(['Desc_OreIron_C']), new Set(['Desc_OreIron_C']), ['Desc_IronIngot_C']);
  const p = res.perTarget[0];
  assert.equal(p.status, 'impossible');
  assert.equal(p.reason, 'no-recipe');
  assert.equal(p.deps.length, 0);
});

test('analyzeRequirements: partial deps (have one, missing another)', () => {
  // Inline dataset: gadget needs raw X (added) + raw Y (missing).
  const gadgetDs = {
    rawResourceIds: new Set(['x', 'y']),
    recipes: [{ id: 'mk', inputs: [{ itemId: 'x', perMin: 1 }, { itemId: 'y', perMin: 1 }], outputs: [{ itemId: 'gadget', perMin: 1 }] }],
  };
  const res = analyzeRequirements(gadgetDs, new Set(['mk']), new Set(['x']), new Set(['x']), ['gadget']);
  const p = res.perTarget[0];
  assert.equal(p.status, 'missing');
  assert.equal(p.reason, 'partial');
  assert.deepEqual(p.deps, [{ itemId: 'x', added: true }, { itemId: 'y', added: false }]);
});

test('analyzeRequirements: alternate recipe toggles buildability', () => {
  // widget is ONLY producible via an alternate recipe from raw z.
  const altDs = {
    rawResourceIds: new Set(['z']),
    recipes: [{ id: 'altW', alternate: true, inputs: [{ itemId: 'z', perMin: 1 }], outputs: [{ itemId: 'widget', perMin: 1 }] }],
  };
  const off = analyzeRequirements(altDs, new Set(), new Set(['z']), new Set(['z']), ['widget']).perTarget[0];
  assert.equal(off.status, 'impossible');
  assert.equal(off.reason, 'no-recipe');
  const on = analyzeRequirements(altDs, new Set(['altW']), new Set(['z']), new Set(['z']), ['widget']).perTarget[0];
  assert.equal(on.status, 'ok');
});

test('analyzeRequirements: anyImpossible / anyMissing summary flags', () => {
  const res = analyzeRequirements(ds, ALL, new Set(['Desc_LiquidOil_C']), new Set(['Desc_LiquidOil_C']),
    ['Desc_IronIngot_C', 'Desc_Plastic_C']);
  assert.equal(res.anyImpossible, true);  // iron ingot
  assert.equal(res.anyMissing, false);
  assert.equal(res.perTarget.find((p) => p.itemId === 'Desc_Plastic_C').status, 'ok');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/engine/requirements.test.js`
Expected: FAIL — `analyzeRequirements` is not exported.

- [ ] **Step 3: Write minimal implementation**

Append to `js/engine/requirements.js`:

```js
/**
 * Raw resources reachable by walking backward from `targetItemId` over the
 * recipes in `firedRecipeIds` (recipes that can actually run). Stops at raws.
 * @returns {Set<string>} raw item ids the target depends on
 */
function rawAncestors(dataset, firedRecipeIds, targetItemId) {
  const raw = dataset.rawResourceIds;
  const producersOf = new Map(); // itemId -> [recipe]
  for (const r of dataset.recipes) {
    if (!firedRecipeIds.has(r.id)) continue;
    for (const o of r.outputs) {
      const list = producersOf.get(o.itemId);
      if (list) list.push(r);
      else producersOf.set(o.itemId, [r]);
    }
  }
  const deps = new Set();
  const seen = new Set();
  const stack = [targetItemId];
  while (stack.length) {
    const item = stack.pop();
    if (seen.has(item)) continue;
    seen.add(item);
    if (raw.has(item)) { deps.add(item); continue; } // raws have no producers
    for (const r of producersOf.get(item) || []) {
      for (const i of r.inputs) stack.push(i.itemId);
    }
  }
  return deps;
}

function depList(depSet, availableRawIds) {
  return [...depSet]
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
    .map((itemId) => ({ itemId, added: availableRawIds.has(itemId) }));
}

/**
 * Classify each target as ok / missing / impossible against the available and
 * user-added raw resources. See module header + spec §5.3.
 * @param {Dataset} dataset
 * @param {Set<string>} enabledRecipeIds
 * @param {Set<string>} availableRawIds  raws with cap>0, incl auto-water
 * @param {Set<string>} userAddedRawIds  explicitly-added raws, excl auto-water
 * @param {string[]} targetItemIds
 */
export function analyzeRequirements(dataset, enabledRecipeIds, availableRawIds, userAddedRawIds, targetItemIds) {
  const raw = dataset.rawResourceIds;
  const availClosure = producibleClosure(dataset, enabledRecipeIds, availableRawIds);
  const allFired = producibleClosure(dataset, enabledRecipeIds, raw).firedRecipeIds;

  const perTarget = targetItemIds.map((itemId) => {
    // Target is itself a raw resource: buildable iff it's available.
    if (raw.has(itemId)) {
      const added = availableRawIds.has(itemId);
      return { itemId, status: added ? 'ok' : 'missing', reason: added ? 'buildable' : 'no-resources', deps: [{ itemId, added }] };
    }
    if (availClosure.producible.has(itemId)) {
      return { itemId, status: 'ok', reason: 'buildable', deps: [] };
    }
    const depSet = rawAncestors(dataset, allFired, itemId);
    const deps = depList(depSet, availableRawIds);
    if (depSet.size === 0) {
      return { itemId, status: 'impossible', reason: 'no-recipe', deps };
    }
    let overlap = false;
    for (const d of depSet) if (userAddedRawIds.has(d)) { overlap = true; break; }
    if (overlap) return { itemId, status: 'missing', reason: 'partial', deps };
    if (userAddedRawIds.size === 0) return { itemId, status: 'missing', reason: 'no-resources', deps };
    return { itemId, status: 'impossible', reason: 'wrong-resources', deps };
  });

  return {
    perTarget,
    anyImpossible: perTarget.some((p) => p.status === 'impossible'),
    anyMissing: perTarget.some((p) => p.status === 'missing'),
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/engine/requirements.test.js`
Expected: PASS (all Task 1 + Task 2 tests).

- [ ] **Step 5: Commit**

```bash
git add js/engine/requirements.js test/engine/requirements.test.js
git commit -m "feat(engine): analyzeRequirements (missing/impossible classification)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: view-model integration

**Files:**
- Modify: `js/ui/view-model.js`
- Test: `test/ui/view-model.test.js`

**Interfaces:**
- Consumes: `analyzeRequirements` (Task 2).
- Produces: `computePlan(...)` return object gains:
  - `hasProduction: boolean` (= `recipeRates.size > 0`)
  - `requirements: { hasIssues: boolean, impossible: Shaped[], missing: Shaped[] }` where `Shaped = { itemId, name, slug, reason, deps: Array<{itemId,name,slug,added,fluid}> }`.
  - When any target is impossible: `feasible` is forced `false` and `headline = 'Can’t build from these resources'`.

- [ ] **Step 1: Write the failing tests**

Append to `test/ui/view-model.test.js`:

```js
import { normalize } from '../../js/data/normalize.js';
import { miniRaw } from '../fixtures/mini-data.js';

const mini = normalize(miniRaw);
const MINI_ALL = new Set(mini.recipes.map((r) => r.id));

test('computePlan: impossible target (oil only -> iron ingot) hides plan, red headline', () => {
  const view = computePlan(mini, {
    mode: 'max', caps: new Map([['Desc_LiquidOil_C', 30]]), enabledRecipeIds: MINI_ALL,
    targets: [{ itemId: 'Desc_IronIngot_C', weight: 1 }],
  });
  assert.equal(view.hasProduction, false);
  assert.equal(view.feasible, false);
  assert.equal(view.requirements.hasIssues, true);
  assert.equal(view.requirements.impossible.length, 1);
  const t = view.requirements.impossible[0];
  assert.equal(t.itemId, 'Desc_IronIngot_C');
  assert.equal(t.reason, 'wrong-resources');
  assert.deepEqual(t.deps.map((d) => [d.itemId, d.added]), [['Desc_OreIron_C', false]]);
  assert.equal(t.deps[0].name, 'Iron Ore');
});

test('computePlan: missing target (nothing added) reports deps, no impossible', () => {
  const view = computePlan(mini, {
    mode: 'max', caps: new Map(), enabledRecipeIds: MINI_ALL,
    targets: [{ itemId: 'Desc_IronIngot_C', weight: 1 }],
  });
  assert.equal(view.hasProduction, false);
  assert.equal(view.requirements.impossible.length, 0);
  assert.equal(view.requirements.missing.length, 1);
  assert.equal(view.requirements.missing[0].reason, 'no-resources');
});

test('computePlan: buildable case has no requirements issues (no regression)', () => {
  const view = computePlan(ironChain, {
    mode: 'max', caps: capsIron(360), enabledRecipeIds: ALL_IRON_RECIPES,
    targetItemId: 'mf', shardBudget: 0, beltTier: 'Mk2',
  });
  assert.equal(view.hasProduction, true);
  assert.equal(view.requirements.hasIssues, false);
  assert.match(view.headline, /15\b/); // unchanged
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/ui/view-model.test.js`
Expected: FAIL — `view.requirements` / `view.hasProduction` are undefined.

- [ ] **Step 3: Add the import**

In `js/ui/view-model.js`, add after the existing engine imports (top of file):

```js
import { analyzeRequirements } from '../engine/requirements.js';
```

- [ ] **Step 4: Compute + shape requirements and add the fields**

In `js/ui/view-model.js`, in `computePlan`, immediately after the line
`const graph = buildGraph(dataset, recipeRates, ...);` (currently line ~273) and before the `return {`, insert:

```js
  // --- Requirements / feasibility diagnostics (independent of the LP) -------
  const targetItemIds = mode === 'targets'
    ? Object.keys(req.targets || {})
    : perPart.map((p) => p.itemId);
  const availableRawIds = new Set();
  const userAddedRawIds = new Set();
  for (const [id, cap] of caps) {
    if (cap > 0) availableRawIds.add(id);
    if (Number.isFinite(cap) && cap > 0) userAddedRawIds.add(id); // excludes auto-unlimited water
  }
  const analysis = analyzeRequirements(dataset, enabledRecipeIds, availableRawIds, userAddedRawIds, targetItemIds);
  const shapeDep = (d) => ({ itemId: d.itemId, name: nameOf(dataset, d.itemId), slug: slugOf(dataset, d.itemId), added: d.added, fluid: fluidOf(dataset, d.itemId) });
  const shapeTarget = (t) => ({ itemId: t.itemId, name: nameOf(dataset, t.itemId), slug: slugOf(dataset, t.itemId), reason: t.reason, deps: t.deps.map(shapeDep) });
  const requirements = {
    hasIssues: analysis.anyImpossible || analysis.anyMissing,
    impossible: analysis.perTarget.filter((t) => t.status === 'impossible').map(shapeTarget),
    missing: analysis.perTarget.filter((t) => t.status === 'missing').map(shapeTarget),
  };
  const hasProduction = recipeRates.size > 0;
  if (requirements.impossible.length > 0) {
    feasible = false;
    headline = 'Can’t build from these resources';
  } else if (!hasProduction && requirements.missing.length > 0) {
    headline = 'Add the required resources';
  }
```

Then add the two fields to the returned object (in the `return { ... }` literal, alongside `feasible` / `headline`):

```js
    hasProduction,
    requirements,
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `node --test test/ui/view-model.test.js`
Expected: PASS — new tests plus the three pre-existing view-model tests (no regression).

- [ ] **Step 6: Commit**

```bash
git add js/ui/view-model.js test/ui/view-model.test.js
git commit -m "feat(view-model): attach requirements diagnostics + hasProduction

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: render callouts + hide-empty-plan

**Files:**
- Modify: `js/ui/render.js`
- Modify: `css/styles.css` (add `.requirements` / `.req-dep` block)

**Interfaces:**
- Consumes: `planView.requirements` + `planView.hasProduction` (Task 3).
- Produces: rendered red/amber callouts under the headline; plan body hidden when `!hasProduction`.

- [ ] **Step 1: Add the callout renderers**

In `js/ui/render.js`, add these functions (e.g. just above `renderResults`):

```js
/** ✓/✗ dependency chips for a requirements callout. */
function renderReqDeps(deps) {
  const wrap = el('div', 'req-deps');
  for (const d of deps) {
    const chip = el('span', d.added ? 'req-dep req-dep--have' : 'req-dep req-dep--need');
    const mark = el('span', 'req-dep__mark');
    mark.textContent = d.added ? '✓' : '✗';
    chip.appendChild(mark);
    chip.appendChild(makeIcon(d.slug, d.name, d.fluid ? 'fluid' : 'item'));
    const name = el('span');
    name.textContent = d.name;
    chip.appendChild(name);
    wrap.appendChild(chip);
  }
  return wrap;
}

/**
 * Requirements diagnostics: a red `.critical` callout per impossible target and
 * an amber `.warning` callout per missing target, each listing raw dependencies
 * as ✓ added / ✗ missing chips. Names via textContent (XSS-safe).
 */
function renderRequirements(requirements) {
  const frag = document.createDocumentFragment();
  for (const t of requirements.impossible) {
    const box = el('div', 'requirements requirements--critical');
    const p = el('p');
    p.textContent = t.reason === 'no-recipe'
      ? `No enabled recipe produces ${t.name}. Try enabling the alternate recipe it needs.`
      : `${t.name} can’t be made from the resources you’ve added — recheck your resources or target.`;
    box.appendChild(p);
    if (t.deps.length) {
      const label = el('p', 'req-label');
      label.textContent = 'Requires:';
      box.appendChild(label);
      box.appendChild(renderReqDeps(t.deps));
    }
    frag.appendChild(box);
  }
  for (const t of requirements.missing) {
    const box = el('div', 'requirements requirements--warning');
    const p = el('p');
    p.textContent = `To make ${t.name} you need:`;
    box.appendChild(p);
    box.appendChild(renderReqDeps(t.deps));
    frag.appendChild(box);
  }
  return frag;
}
```

- [ ] **Step 2: Wire into `renderResults` and gate the plan body**

In `js/ui/render.js`, replace the body of `renderResults` (currently lines ~348-373) with:

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

  if (planView.perPart && planView.perPart.length > 1) {
    rootEl.appendChild(renderPerPart(planView.perPart));
  }

  if (planView.shortfalls && planView.shortfalls.length > 0) {
    rootEl.appendChild(renderShortfalls(planView.shortfalls));
  }

  rootEl.appendChild(renderTiles(planView.tiles));
  rootEl.appendChild(renderMeters(planView.resourceMeters));
  rootEl.appendChild(renderBuildTable(planView.buildRows, planView.machineTotals));
  rootEl.appendChild(renderBeltList(planView.beltRows));

  if (planView.graph && planView.graph.nodes.length > 0) {
    rootEl.appendChild(renderDiagramSection(planView.graph));
  }

  if (planView.refinements && planView.refinements.length > 0) {
    rootEl.appendChild(renderRefinements(planView.refinements));
  }
}
```

- [ ] **Step 3: Add the callout CSS**

In `css/styles.css`, append after the `.hint` block (~line 410):

```css
/* ==========================================================================
   Requirements / feasibility callouts (missing / impossible targets)
   Rendered under the headline. Color is always paired with a ✓/✗ mark + text.
   ========================================================================== */
.requirements {
  margin-top: 0.75rem;
  padding: 0.7rem 0.85rem;
  border: 1px solid var(--border);
  border-left-width: 3px;
  border-radius: 0.5rem;
  background: var(--surface);
  font-size: 0.88rem;
}
.requirements--warning { border-left-color: var(--warning); }
.requirements--critical { border-left-color: var(--critical); }
.requirements p { margin: 0 0 0.4rem; color: var(--ink); }
.requirements .req-label { color: var(--ink-2); font-size: 0.8rem; margin: 0.3rem 0 0.35rem; }

.req-deps { display: flex; flex-wrap: wrap; gap: 0.35rem; }
.req-dep {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  padding: 0.2rem 0.5rem;
  border: 1px solid var(--border);
  border-radius: 999px;
  font-size: 0.82rem;
}
.req-dep .icon { width: 1rem; height: 1rem; }
.req-dep--have { color: var(--ink-muted); }
.req-dep--have .req-dep__mark { color: var(--good); }
.req-dep--need { color: var(--ink); border-color: color-mix(in srgb, var(--critical) 45%, var(--border)); }
.req-dep--need .req-dep__mark { color: var(--critical); }
.req-dep__mark { font-weight: 700; }
```

- [ ] **Step 4: Verify (tests + screenshot)**

Run: `npm test`
Expected: PASS 68/68 (65 prior + Task 1/2/3 additions; render has no unit tests).

Then verify the UI in the browser:

```bash
cd /Users/chong/Documents/GitHub/satisfactory-optimizer
python3 -m http.server 8791 &
open "http://localhost:8791"   # or use headless-Chrome screenshot as in prior phases
```

Manual repro of the impossible case: **Maximize** mode → **+ Add resource** → pick **Crude Oil**, set Normal = 1 → **+ Add part** → pick **Modular Frame**. Confirm: a red callout "Modular Frame can't be made from the resources you've added — recheck…" with **Requires: ✗ Iron Ore**, and the tiles/build/diagram are hidden. Change the resource to **Iron Ore** → callout disappears and the normal plan returns. Screenshot in dark mode for the record.

- [ ] **Step 5: Commit**

```bash
git add js/ui/render.js css/styles.css
git commit -m "feat(ui): requirements callouts + hide empty plan

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: vein hint + target-row / dropdown layout

**Files:**
- Modify: `js/ui/inputs.js`
- Modify: `css/styles.css`

**Interfaces:**
- No JS API changes. `makeMaxTargetRow` / `makeTargetRow` keep their existing return shapes (`el`, `getItemId`, `getWeight`/`getRate`, `removeBtn`, `getState`, `setItem`, `setWeight`/`setRate`) — verified against `addMaxRow` / `addTargetRow` / `restoreState` in `buildInputs`.

- [ ] **Step 1: Add the default-vein hint**

In `js/ui/inputs.js`, in `buildInputs`, right after the existing `resourceHint` is appended (currently lines 533-535), add:

```js
  const veinHint = el('p', 'hint');
  veinHint.textContent = 'New veins default to Normal purity — set Impure/Pure to match your map.';
  sidebarEl.appendChild(veinHint);
```

- [ ] **Step 2: Restructure `makeMaxTargetRow` to two lines**

In `js/ui/inputs.js`, replace the whole `makeMaxTargetRow` function (currently lines ~452-480) with:

```js
/** One "maximize" target row: item picker (line 1) + weight + remove (line 2). */
function makeMaxTargetRow(itemOptions, onRowChange) {
  const row = el('div', 'target-row');
  const picker = createSearchSelect({ options: itemOptions, placeholder: 'Part…', showIcon: true });
  picker.el.style.width = '100%';
  row.appendChild(picker.el);

  const foot = el('div', 'target-row__foot');
  const label = el('span', 'target-row__label');
  label.textContent = 'Weight';
  const weightInput = numberInput({ value: 1, min: 0, step: 'any', width: '4rem' });
  weightInput.title = 'Weight — parts per set (equal = balanced)';
  const removeBtn = el('button');
  removeBtn.type = 'button';
  removeBtn.textContent = 'Remove';
  removeBtn.style.marginLeft = 'auto';
  foot.append(label, weightInput, removeBtn);
  row.appendChild(foot);

  picker.onSelect(onRowChange);
  weightInput.addEventListener('input', onRowChange);
  const getWeight = () => {
    const w = Number(weightInput.value);
    return Number.isFinite(w) && w > 0 ? w : 1;
  };
  return {
    el: row,
    removeBtn,
    getItemId: () => picker.getValue(),
    getWeight,
    setItem: (id) => picker.setValue(id),
    setWeight: (w) => { weightInput.value = String(w); },
    getState: () => ({ itemId: picker.getValue(), weight: getWeight() }),
  };
}
```

- [ ] **Step 3: Restructure `makeTargetRow` to two lines**

In `js/ui/inputs.js`, replace the whole `makeTargetRow` function (currently lines ~418-450) with:

```js
/** One "target-rate" row: item picker (line 1) + rate + remove (line 2). */
function makeTargetRow(itemOptions, onRowChange) {
  const row = el('div', 'target-row');
  const picker = createSearchSelect({ options: itemOptions, placeholder: 'Part…', showIcon: true });
  picker.el.style.width = '100%';
  row.appendChild(picker.el);

  const foot = el('div', 'target-row__foot');
  const label = el('span', 'target-row__label');
  label.textContent = 'Rate /min';
  const rateInput = numberInput({ value: '', min: 0, step: 'any', placeholder: 'rate /min', width: '6rem' });
  const removeBtn = el('button');
  removeBtn.type = 'button';
  removeBtn.textContent = 'Remove';
  removeBtn.style.marginLeft = 'auto';
  foot.append(label, rateInput, removeBtn);
  row.appendChild(foot);

  picker.onSelect(onRowChange);
  rateInput.addEventListener('input', onRowChange);

  return {
    el: row,
    getItemId: () => picker.getValue(),
    getRate: () => Math.max(0, Number(rateInput.value) || 0),
    removeBtn,
    getState: () => ({ itemId: picker.getValue(), rate: Math.max(0, Number(rateInput.value) || 0) }),
    setItem: (id) => picker.setValue(id),
    setRate: (v) => { rateInput.value = String(v); },
  };
}
```

- [ ] **Step 4: Update the CSS (dropdown width + target-row layout)**

In `css/styles.css`:

(a) Replace the `.search-list` block (~lines 554-562) with (adds `min-width` / `max-width`):

```css
.search-list {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 0.5rem;
  max-height: 15rem;
  overflow-y: auto;
  padding: 0.25rem;
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.35);
  min-width: 18rem;              /* wider than the (narrow) input so names don't wrap */
  max-width: min(24rem, 90vw);   /* over-constrained: right:0 is ignored, popup grows right */
}
```

(b) Replace the `.search-option` block (~lines 564-577) with (adds `white-space: nowrap` + an ellipsis rule):

```css
.search-option {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  width: 100%;
  padding: 0.45rem 0.55rem;
  background: transparent;
  border: none;
  border-radius: 0.4rem;
  text-align: left;
  cursor: pointer;
  color: var(--ink);
  font: inherit;
  white-space: nowrap;
}
.search-option > span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}
```

(c) Replace the `.target-row` block (~lines 691-697) with the two-line layout:

```css
/* Target rows (Maximize weight / Target-rates rate): picker on its own line,
   controls beneath so long item names ("Heavy Modular Frame") aren't clipped. */
.target-row {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  margin-bottom: 0.6rem;
}
.target-row__foot {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}
.target-row__label {
  color: var(--ink-2);
  font-size: 0.8rem;
}
```

- [ ] **Step 5: Verify (tests + screenshot)**

Run: `npm test`
Expected: PASS 68/68 (unchanged — this task is UI-only, no test-affecting logic).

Browser check (server from Task 4, or restart it): switch to **Maximize**, **+ Add part**, open the picker and type "control" — confirm options like "Adaptive Control Unit" render on **one line** in a wider popup; select **Heavy Modular Frame** and confirm the full name shows (not "Heavy M…") with the Weight box + Remove on the line below. Repeat in **Target rates** mode (Rate /min row). Confirm the Resources section shows the "New veins default to Normal purity…" hint. Screenshot dark + toggle light once.

- [ ] **Step 6: Commit**

```bash
git add js/ui/inputs.js css/styles.css
git commit -m "fix(ui): vein hint, roomier target rows, non-wrapping picker dropdown

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: full verification + docs

**Files:**
- Modify: `README.md` (feature note) and/or the base spec backlog if appropriate.

- [ ] **Step 1: Full test suite**

Run: `npm test`
Expected: PASS, 68/68 (65 baseline + 3 new files' worth of tests; confirm 0 fail).

- [ ] **Step 2: Final manual smoke (both modes, both themes)**

With `python3 -m http.server 8791` running, confirm end-to-end:
- Crude Oil → Modular Frame (Maximize): red callout, plan hidden.
- Nothing added → Modular Frame: amber "you need ✗ Iron Ore".
- Iron Ore → Modular Frame: normal plan, no callout.
- Target-rates mode: one impossible target shows the red callout above any buildable target's plan.
- Vein hint present; dropdown non-wrapping; target name not clipped; light mode readable.

- [ ] **Step 3: Update README**

Add a short bullet to `README.md` describing the new resource-requirements diagnostics (missing vs impossible) under the features list. (Keep to the existing README voice; one or two lines.)

- [ ] **Step 4: Commit + note for merge**

```bash
git add README.md
git commit -m "docs: note resource requirements diagnostics in README

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

Then stop and report: branch `phase-6-requirements-diagnostics` ready for the final whole-branch review before local merge to `main` (per the project's per-phase workflow). Do **not** push (user tests locally first).

---

## Self-Review

**Spec coverage:**
- §3 vein note → Task 5 Step 1. ✅
- §4.1 dropdown wrapping → Task 5 Step 4(a)(b). ✅
- §4.2 cramped target rows → Task 5 Steps 2-3 + 4(c). ✅
- §5.1-5.3 requirements module → Tasks 1-2. ✅
- §5.4 alternate caveat → accepted (union deps); alt-toggle covered by Task 2 test. ✅
- §6 view-model integration (`requirements`, `hasProduction`, headline override) → Task 3. ✅
- §7 render callouts + hide-empty-plan → Task 4. ✅
- §8 testing → Tasks 1-6 (requirements.test.js, extended view-model.test.js, screenshot verification). ✅ (mini-data left unmodified; alt case uses inline datasets, per Global Constraints.)
- §9 files touched → all present in File Structure + tasks. ✅

**Placeholder scan:** No TBD/TODO/"handle edge cases". Every code step shows complete code; every run step shows the command + expected result. README bullet (Task 6 Step 3) is discretionary copy, not a code placeholder. ✅

**Type consistency:** `producibleClosure` returns `{producible, firedRecipeIds}` — used verbatim in Task 2 (`availClosure.producible`, `.firedRecipeIds`). `analyzeRequirements` return (`perTarget[].status/reason/deps`, `anyImpossible`, `anyMissing`) matches Task 3's consumption (`analysis.perTarget.filter(... status ...)`, `anyImpossible||anyMissing`). Shaped `requirements` (`hasIssues/impossible/missing`, dep `{itemId,name,slug,added,fluid}`) matches `render.js` usage in Task 4 (`requirements.impossible`, `t.reason`, `t.deps`, `d.added`, `d.slug`, `d.name`, `d.fluid`). `hasProduction` produced in Task 3, consumed in Task 4. ✅
