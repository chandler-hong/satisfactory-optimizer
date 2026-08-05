# Expansion Maximize Mode — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Maximize mode to the Expansion view that answers "given the lines I've declared, what's the most of X I can make, and what do I build to get there?"

**Architecture:** The Expansion view solves with raw resources uncapped by design, so maximize against them is unbounded (measured: 21,308,980 Modular Engine/min). The bound comes from what the user declared instead — declared items become capped LP supplies, and recipes producing a **block's primary output** are excluded from the planner's choices, because a block is a statement about the user's capacity for that item. `maxSets` already does the two-pass maximize-then-minimize-raw that makes the answer "efficient"; this plan gives its LP builder the two parameters it lacks and teaches `planExpansion` a second mode.

**Tech Stack:** Vanilla ES modules, no build step. Tests: `node --test` via `npm test`. No dependencies may be added.

**Spec:** `docs/superpowers/specs/2026-08-05-expansion-maximize-mode-design.md`

## Global Constraints

- **Test command is `npm test`.** Never `node --test test/` — wrong glob, produces spurious failures.
- **Baseline is 236 tests passing, `fail 0`.** Every task states its expected count.
- **`test/fixtures/mini-data.js` and `test/fixtures/iron-chain.js` must NOT be modified.** Where a test needs a recipe a fixture lacks, build a throwaway dataset **inside the test file** — `oreMakerDataset`, `altDataset`, `loopDataset` and `dualOutputDataset` in `test/engine/expansion.test.js` are the established pattern (`{ ...ironChain, recipes: [...ironChain.recipes, extra] }`).
- **Read rates off `perMin`.** A normalized entry is `{ itemId, perMin, amount }` and the recipe carries `timeSec`; `amount`/`timeSec` exist for the Codex's per-craft display and are not the optimizer's units.
- **Layering:** `js/engine/**` and `js/domain/**` are pure and must never import from `js/ui/**`. `js/ui/**` is the only DOM-touching layer.
- **No `innerHTML`/`outerHTML`/`insertAdjacentHTML`.** Use `textContent`, or `img.src`/`img.alt` property assignment.
- **No new dependencies.**
- **CSS custom properties available:** `--surface`, `--border`, `--ink`, `--ink-muted`, `--accent`, `--accent-ink`, `--good`, `--warning`, `--critical`. There is no `--text-dim`. Append rules; don't alter existing ones. Note `.expansion-view` is a **sibling** of `.app` in `index.html` (`:42` vs `:25`), so `.app`-scoped rules do not reach it — this has already bitten this feature three times.
- **There is no DOM shim in the test suite.** `js/ui/**` is covered through pure exports only; rendering is verified by running the app with a throwaway `_probe.html`, deleted before committing.
- **Every new parameter must be inert by default.** `lp-builder.js` and `optimize.js` are shared with the live Factory Optimizer. Each of Tasks 1–2 includes a test proving the Optimizer's model is unchanged when the new parameter is omitted.
- **Branch:** continue on `expansion-alternates-and-built-blocks`. Commit per task; do not push; do not merge.

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `js/engine/lp-builder.js` | Builds LP models | `buildMaxSetsModel` gains `supplies` and `minRates`, both inert by default |
| `js/engine/optimize.js` | Solver entry points | `maxSets` threads both params and returns `supplyDrawn` |
| `js/engine/expansion.js` | The Expansion planner (pure) | `mode` param, the exclusion set, the maxSets branch, the maximize readout |
| `js/ui/expansion.js` | Expansion DOM: state, rows, wiring | `sanitizeState` for `mode`/`max` rows; the mode toggle; the Maximize section |
| `js/ui/expansion-render.js` | Expansion result panels | the maximize headline + the unbounded message |
| `css/styles.css` | Styles | append rules for the mode row |

---

### Task 1: `buildMaxSetsModel` accepts declared supplies and minimum rates

**Files:**
- Modify: `js/engine/lp-builder.js:131-147` (`buildMaxSetsModel`)
- Test: `test/engine/lp-builder.test.js`

**Interfaces:**
- Consumes: the existing private `addSupplies(dataset, variables, constraints, supplies)` at `js/engine/lp-builder.js:28`.
- Produces: `buildMaxSetsModel({ dataset, caps, enabledRecipeIds, targets, noWaste = false, supplies = [], minRates = new Map() })`. `supplies` is `[{ itemId, rate, kind }]` where `kind` is `'pinned'` or `'have'`. `minRates` is `Map<itemId, rate>` forcing `constraints[itemId] = { min: rate }`. Both default to inert. Task 3 relies on these exact names.

- [ ] **Step 1: Read the current function**

Read `js/engine/lp-builder.js:107-155`. You need three things:
1. How `buildTargetRatesModel` calls `addSupplies` (`:119`) — you are mirroring that call.
2. `buildMaxSetsModel`'s normalization loop:
```js
  for (const id of Object.keys(variables)) {
    if (id !== '__sets__') variables[id][SETS] = 0;
  }
```
   Your `addSupplies` call must run **before** this loop, so the supply variables it creates get `[SETS] = 0` like every other variable. Calling it after would leave them without that coefficient.
3. `buildMinRawForSetsModel(args, minSets)` delegates to `buildMaxSetsModel(args)`, so it inherits both new params with no change.

- [ ] **Step 2: Write the failing tests**

Append to `test/engine/lp-builder.test.js`. Read the top of that file first for its existing imports and fixture usage, and match them.

```js
// --- buildMaxSetsModel: declared supplies and minimum rates ------------------

// Expansion maximizes against what the user declared, not against ore, so the
// max model needs the same capped-supply primitive the target-rates model has.
test('buildMaxSetsModel: a declared supply becomes a capped variable', () => {
  const m = buildMaxSetsModel({
    dataset: ironChain,
    caps: capsIron(0),
    enabledRecipeIds: ALL_IRON_RECIPES,
    targets: [{ itemId: 'rotor', weight: 1 }],
    supplies: [{ itemId: 'screw', rate: 80, kind: 'pinned' }],
  });
  const capKey = '_supcap_pinned_screw';
  assert.deepEqual(m.constraints[capKey], { max: 80 }, 'the supply is capped at its rate');
  const supVar = Object.keys(m.variables).find((k) => m.variables[k][capKey] === 1);
  assert.ok(supVar, 'a supply variable exists and consumes the cap');
  assert.equal(m.variables[supVar].screw, 1, 'and it contributes to the screw balance');
  assert.equal(m.variables[supVar][SETS], 0,
    'addSupplies must run BEFORE the SETS normalization loop, or this coefficient is missing');
});

test('buildMaxSetsModel: minRates forces a floor on an item, not the default min 0', () => {
  const m = buildMaxSetsModel({
    dataset: ironChain,
    caps: capsIron(360),
    enabledRecipeIds: ALL_IRON_RECIPES,
    targets: [{ itemId: 'rotor', weight: 1 }],
    minRates: new Map([['plate', 25]]),
  });
  assert.deepEqual(m.constraints.plate, { min: 25 }, 'the floor replaces the default { min: 0 }');
  assert.deepEqual(m.constraints.rod, { min: 0 }, 'an item with no floor is untouched');
});

// Both params are additive and shared with the live Factory Optimizer, so the
// omitted-argument model must be byte-identical to what it was before.
test('buildMaxSetsModel: omitting supplies and minRates changes nothing', () => {
  const args = {
    dataset: ironChain,
    caps: capsIron(360),
    enabledRecipeIds: ALL_IRON_RECIPES,
    targets: [{ itemId: 'mf', weight: 1 }],
  };
  const bare = buildMaxSetsModel(args);
  const explicit = buildMaxSetsModel({ ...args, supplies: [], minRates: new Map() });
  assert.equal(JSON.stringify(bare), JSON.stringify(explicit),
    'an empty supplies array and an empty minRates map are inert');
  assert.equal(Object.keys(bare.constraints).some((k) => k.startsWith('_supcap_')), false,
    'and no supply-cap constraint appears');
});
```

**These tests need imports the file does not have.** `test/engine/lp-builder.test.js:3` currently imports only `{ buildMaxModel, buildMinRawModel, buildTargetRatesModel, supplyVarName, OBJ, RAWCOST }`, and the file works against its own tiny synthetic dataset (`ore → ingot → plate`, built with a local `io()` helper) — it has no `rotor`, no `capsIron`, and no iron-chain import. So:

Extend the existing import on line 3 to add `buildMaxSetsModel` and `SETS` (both already exported — `SETS` at `js/engine/lp-builder.js:123`):

```js
import { buildMaxModel, buildMinRawModel, buildTargetRatesModel, buildMaxSetsModel, supplyVarName, OBJ, RAWCOST, SETS } from '../../js/engine/lp-builder.js';
```

And add the fixture import the new tests need:

```js
import { ironChain, ALL_IRON_RECIPES, capsIron } from '../fixtures/iron-chain.js';
```

Leave the file's local `dataset`/`io` helpers alone — the existing tests use them.

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npm test`
Expected: the first two FAIL (`supplies`/`minRates` are ignored, so no `_supcap_` constraint exists and `constraints.plate` is `{ min: 0 }`). The third PASSES already — it is the inertness guard.

- [ ] **Step 4: Implement**

Change the signature and body of `buildMaxSetsModel`:

```js
export function buildMaxSetsModel({ dataset, caps, enabledRecipeIds, targets, noWaste = false, supplies = [], minRates = new Map() }) {
  const { variables, touchedRaw, touchedNonRaw } = buildVariables(dataset, enabledRecipeIds);
  const nVar = { [SETS]: 1, [RAWCOST]: 0 };
  for (const t of targets) {
    const w = t.weight > 0 ? t.weight : 1;
    nVar[t.itemId] = (nVar[t.itemId] || 0) - w;    // flow(t) - w*N >= 0
    touchedNonRaw.add(t.itemId);                   // ensure the target has a balance constraint
  }
  variables.__sets__ = nVar;
  const constraints = rawConstraints(touchedRaw, caps);
  // Before the SETS normalization below, so the supply variables this creates
  // pick up their [SETS] = 0 coefficient like every other variable.
  addSupplies(dataset, variables, constraints, supplies);
  for (const id of Object.keys(variables)) {
    if (id !== '__sets__') variables[id][SETS] = 0;
  }
  for (const i of touchedNonRaw) {
    constraints[i] = noWaste ? { equal: 0 } : { min: 0 };
  }
  // A floor on an item the caller must still satisfy — Expansion's max mode uses
  // this for a To-build block's feedstock, which has to be planned even while
  // something else is being maximized. Applied last so it wins over the { min: 0 }
  // default above.
  for (const [itemId, rate] of minRates) {
    if (Number.isFinite(rate) && rate > 0) constraints[itemId] = { min: rate };
  }
  return { optimize: SETS, opType: 'max', constraints, variables };
}
```

Note `rawConstraints(...)` moved **above** the `addSupplies` call because `addSupplies` writes into `constraints`. The `touchedNonRaw` loop stays after, unchanged.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm test`
Expected: **239 pass, fail 0** (3 new tests). Every pre-existing LP and view-model test must still pass — they are the regression signal for the Optimizer.

- [ ] **Step 6: Commit**

```bash
git add js/engine/lp-builder.js test/engine/lp-builder.test.js
git commit -m "feat(engine): the max model accepts declared supplies and rate floors

Expansion maximizes against what you declared rather than against ore, so the
max-sets model needs the capped-supply primitive the target-rates model already
had, plus a floor for demands that must still be met while something else is
maximized (a To-build block's feedstock).

addSupplies runs before the SETS normalization loop so the supply variables it
creates get that coefficient like every other variable. buildMinRawForSetsModel
needed no change — it delegates, so the min-raw second pass inherits both.

Both parameters default to inert, and a test asserts the omitted-argument model
is byte-identical, because this builder is shared with the live Optimizer."
```

---

### Task 2: `maxSets` threads the new params and reports supply usage

**Files:**
- Modify: `js/engine/optimize.js:49-60` (`maxSets`)
- Test: `test/engine/optimize.test.js`

**Interfaces:**
- Consumes: `buildMaxSetsModel`'s `supplies` and `minRates` from Task 1.
- Produces: `maxSets({ dataset, caps, enabledRecipeIds, targets, noWaste = false, supplies = [], minRates = new Map() })` returning `{ feasible, sets, recipeRates, perPart, bindingResources, supplyDrawn }`. `supplyDrawn` is `[{ itemId, kind, used }]` — **one entry per input supply, unfiltered, in input order**, matching what `hitTargets` already returns. Task 3's binding check depends on that alignment.

- [ ] **Step 1: Read how `hitTargets` builds `supplyDrawn`**

Read `js/engine/optimize.js:62-90`. You are copying its `supplyDrawn` construction verbatim, including the `Math.round(used * 1e6) / 1e6` rounding and the "skipped supply reports 0 rather than being omitted" behaviour that keeps the array aligned. `supplyVarName` is already imported in that file.

- [ ] **Step 2: Write the failing test**

Append to `test/engine/optimize.test.js`, matching its existing imports:

```js
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
```

- [ ] **Step 3: Run to verify it fails**

Run: `npm test`
Expected: the first FAILS — `supplies` is not threaded, so `r.sets` is not 3.2 and `r.supplyDrawn` is `undefined`.

- [ ] **Step 4: Implement**

Replace `maxSets`:

```js
export function maxSets({ dataset, caps, enabledRecipeIds, targets, noWaste = false, supplies = [], minRates = new Map() }) {
  const args = { dataset, caps, enabledRecipeIds, targets, noWaste, supplies, minRates };
  const r1 = solveModel(buildMaxSetsModel(args));
  if (!r1.feasible) return { feasible: false, sets: 0, recipeRates: new Map(), perPart: [], bindingResources: [], supplyDrawn: [] };
  const sets = r1.objective;
  const r2 = solveModel(buildMinRawForSetsModel(args, sets));
  const chosen = r2.feasible ? r2 : r1;
  const recipeRates = ratesFrom(chosen.values, enabledRecipeIds);
  const perPart = targets.map((t) => ({ itemId: t.itemId, weight: t.weight, rate: (t.weight > 0 ? t.weight : 1) * sets }));
  // One entry per input supply, in input order, so callers can pair it back up
  // positionally — same contract hitTargets provides. A skipped supply (raw, or
  // a non-positive rate) reports 0 rather than being omitted.
  const supplyDrawn = (supplies || []).map((s) => {
    const kind = s?.kind === 'pinned' ? 'pinned' : 'have';
    const used = chosen.values[supplyVarName(s?.itemId, kind)] || 0;
    return { itemId: s?.itemId, kind, used: Math.round(used * 1e6) / 1e6 };
  });
  return { feasible: true, sets, recipeRates, perPart, bindingResources: bindingResources(dataset, caps, recipeRates), supplyDrawn };
}
```

Note `supplyDrawn` reads from `chosen`, not `r1` — the reported build comes from the min-raw pass, so the drawn amounts must come from the same solution.

- [ ] **Step 5: Run to verify it passes**

Run: `npm test`
Expected: **241 pass, fail 0**.

- [ ] **Step 6: Commit**

```bash
git add js/engine/optimize.js test/engine/optimize.test.js
git commit -m "feat(engine): maxSets accepts declared supplies and reports what it drew

Threads supplies and minRates to the builder on both passes, and returns
supplyDrawn in the same shape hitTargets does — one entry per input supply,
unfiltered, in input order — so a caller can pair it positionally and tell
which declared line is binding.

Read off the chosen solution rather than the first pass: the reported build
comes from the min-raw pass, so the drawn amounts have to come from there too."
```

---

### Task 3: `planExpansion` gains max mode

**Files:**
- Modify: `js/engine/expansion.js:268` (signature), `:284-287` (the solve), and the return object
- Test: `test/engine/expansion.test.js`

**Interfaces:**
- Consumes: `maxSets` from Task 2 with `supplies`, `minRates` and `supplyDrawn`.
- Produces: `planExpansion({ ..., mode = 'targets' })`. In `'max'` mode the return gains:
  - `maximize: { sets: number, perPart: [{ itemId, name, slug, fluid, weight, rate }], bindingItems: [{ itemId, name, rate }], bounded: boolean }`
  - `mode: 'targets' | 'max'` echoed back.
  A new row kind `{ kind: 'max', itemId, weight }` supplies the targets. Tasks 4 and 5 rely on these names.

- [ ] **Step 1: Read the current solve region and the readout helpers**

Read `js/engine/expansion.js:260-300` and `:360-390`. You need:
- `splitDemand`'s return: `{ targets, supplies, rawDemand, rawSupplied, rawCredit }`. `targets` is a `Map<itemId, rate>` holding both want-row demand and To-build block deficits.
- `caps` at `:277-283`: every touched raw set to `Infinity`.
- `nameOf(dataset, id)`, `slugOf(dataset, id)`, `fluidOf(dataset, id)` and `round6` at `:22-25`.
- `blockLoad(byId, b)` returning `{ recipe, machines, load }` or null.
- **Do not** reuse `supplyUsage` (`:376-387`) for the binding check. It is filtered to `kind === 'have'`, so a block's `'pinned'` output never appears in it, and its `capped` flag additionally requires `builtItems.has(itemId)` — which in max mode is never true for the excluded item. Compute binding from `solved.supplyDrawn` instead.

- [ ] **Step 2: Write the failing tests**

Append to `test/engine/expansion.test.js`. Use the file's existing `plan(rows, extra = {})` helper for target-rates cases and `planExpansion` directly where you need `mode`.

```js
// --- Maximize mode -----------------------------------------------------------

const planMax = (rows, extra = {}) => planExpansion({
  dataset: ironChain, rows, enabledRecipeIds: ALL_IRON_RECIPES, mode: 'max', ...extra,
});

/**
 * The bound is what you declared. A Built screw block makes 80 screw/min; rotor
 * takes 100 screw per 4 rotor (25 each), so the most rotors is 3.2/min. rod is
 * built freely from uncapped ore, which is the point — you get told what to add.
 */
test('planExpansion (max): a Built block bounds the maximum at its own output', () => {
  const p = planMax([
    { kind: 'block', built: true, recipeId: 'screw', machines: 2, clock: 1 },
    { kind: 'max', itemId: 'rotor', weight: 1 },
  ]);
  assert.equal(p.mode, 'max');
  assert.equal(p.maximize.bounded, true);
  assert.ok(Math.abs(p.maximize.sets - 3.2) < 1e-6, `expected 3.2, got ${p.maximize.sets}`);
  assert.equal(p.maximize.perPart.length, 1);
  assert.equal(p.maximize.perPart[0].itemId, 'rotor');
  assert.ok(Math.abs(p.maximize.perPart[0].rate - 3.2) < 1e-6);
  assert.deepEqual(p.maximize.bindingItems.map((b) => b.itemId), ['screw'],
    'and it names the line that bound the answer');
  assert.ok(machinesOf(p, 'rod') > 0, 'rod is still built for you from free ore');
});

/**
 * The test that would have caught the 21-million bug. Without the exclusion the
 * solver builds screws from uncapped ore and the answer runs to the 1e9 raw
 * clamp instead of being bounded by the declared line.
 */
test('planExpansion (max): excluding the block output recipe is what bounds it', () => {
  const p = planMax([
    { kind: 'block', built: true, recipeId: 'screw', machines: 2, clock: 1 },
    { kind: 'max', itemId: 'rotor', weight: 1 },
  ]);
  assert.ok(p.maximize.sets < 100,
    `a bounded answer must be small; ${p.maximize.sets} means the screw recipe was not excluded`);
});

test('planExpansion (max): with nothing declared, it reports unbounded and no rate', () => {
  const p = planMax([{ kind: 'max', itemId: 'rotor', weight: 1 }]);
  assert.equal(p.maximize.bounded, false, 'nothing declared can bound this');
  assert.deepEqual(p.maximize.bindingItems, []);
});

test('planExpansion (max): a declared line that the target does not need is not binding', () => {
  // A Built ingot block cannot bound rotor here, because rod and screw can both
  // still be built from free ore — so the answer is unbounded, not 30-ingot-sized.
  const p = planMax([
    { kind: 'block', built: true, recipeId: 'ingot', machines: 1, clock: 1 },
    { kind: 'max', itemId: 'rotor', weight: 1 },
  ]);
  assert.equal(p.maximize.bounded, false,
    'the ingot line is not consumed to exhaustion, so nothing is binding');
});

test('planExpansion (max): a HAVE row is a floor to draw on, not a ceiling', () => {
  // screw recipes stay enabled here (no screw block), so the have row caps
  // nothing — the solver may build more screws and the answer is unbounded.
  const p = planMax([
    { kind: 'have', itemId: 'screw', rate: 80 },
    { kind: 'max', itemId: 'rotor', weight: 1 },
  ]);
  assert.equal(p.maximize.bounded, false, 'a have row does not exclude the item\'s recipes');
});

test('planExpansion (max): balanced sets weight the targets against each other', () => {
  const p = planMax([
    { kind: 'block', built: true, recipeId: 'screw', machines: 4, clock: 1 },
    { kind: 'max', itemId: 'rotor', weight: 1 },
    { kind: 'max', itemId: 'rod', weight: 2 },
  ]);
  assert.equal(p.maximize.perPart.length, 2);
  const rotor = p.maximize.perPart.find((x) => x.itemId === 'rotor');
  const rod = p.maximize.perPart.find((x) => x.itemId === 'rod');
  assert.ok(Math.abs(rod.rate - 2 * rotor.rate) < 1e-6,
    'weight 2 means twice as much rod as rotor, per set');
});

/**
 * Tests blockOutputExclusions directly rather than through a plan. Going through
 * planExpansion here would need a disjunctive assertion ("bMaker was built OR the
 * answer was unbounded"), which passes trivially via the second clause and proves
 * nothing — exactly the non-discriminating shape that slipped through twice on
 * the previous round of this feature. The exclusion set is pure and exported, so
 * assert on it.
 */
test('blockOutputExclusions: only the primary output is excluded, not a byproduct', () => {
  // dualOut makes 'a' (primary) and 'b' (byproduct). bMaker also makes 'b'.
  const twoOut = {
    ...ironChain,
    recipes: [...ironChain.recipes,
      { id: 'dualOut', name: 'dualOut', buildingId: 'b', alternate: false, inputs: [{ itemId: 'ore', perMin: 10 }], outputs: [{ itemId: 'a', perMin: 5 }, { itemId: 'b', perMin: 3 }] },
      { id: 'bMaker', name: 'bMaker', buildingId: 'b', alternate: false, inputs: [{ itemId: 'ore', perMin: 2 }], outputs: [{ itemId: 'b', perMin: 4 }] },
      { id: 'aMaker', name: 'aMaker', buildingId: 'b', alternate: false, inputs: [{ itemId: 'ore', perMin: 9 }], outputs: [{ itemId: 'a', perMin: 5 }] },
    ],
  };
  const ex = blockOutputExclusions(twoOut, [{ kind: 'block', built: true, recipeId: 'dualOut', machines: 1, clock: 1 }]);
  assert.equal(ex.has('dualOut'), true, 'the declared line itself produces the primary output');
  assert.equal(ex.has('aMaker'), true, 'and so does any other route to that primary output');
  assert.equal(ex.has('bMaker'), false,
    "the byproduct 'b' is NOT a declared ceiling, so its other producer stays available");
});

test('blockOutputExclusions: a have row excludes nothing', () => {
  const ex = blockOutputExclusions(ironChain, []);
  assert.equal(ex.size, 0, 'no blocks means no exclusions — have rows never exclude');
});

test('blockOutputExclusions: a stale or zero-machine block row excludes nothing', () => {
  const stale = blockOutputExclusions(ironChain, [{ kind: 'block', built: true, recipeId: 'no_such', machines: 2, clock: 1 }]);
  assert.equal(stale.size, 0, 'an unresolvable recipeId is skipped, matching pinnedBalance');
  const zero = blockOutputExclusions(ironChain, [{ kind: 'block', built: true, recipeId: 'screw', machines: 0, clock: 1 }]);
  assert.equal(zero.size, 0, 'a zero-load row declares no capacity, so it is not a ceiling');
});

test('planExpansion: mode defaults to targets, so every existing caller is unaffected', () => {
  const withoutMode = plan([{ kind: 'block', built: false, recipeId: 'rip', machines: 2, clock: 1 }]);
  const withMode = plan([{ kind: 'block', built: false, recipeId: 'rip', machines: 2, clock: 1 }], { mode: 'targets' });
  assert.equal(withoutMode.tiles.machines, withMode.tiles.machines);
  assert.equal(withoutMode.maximize, undefined, 'targets mode carries no maximize readout');
});
```

- [ ] **Step 3: Run to verify they fail**

Run: `npm test`
Expected: the eight max-mode tests FAIL (`p.mode` and `p.maximize` are `undefined`). The last one may already pass — it is the regression guard.

- [ ] **Step 4: Implement the exclusion helper**

Add near `pinnedBalance` in `js/engine/expansion.js`:

```js
/**
 * Recipe ids the solver must NOT use in max mode: anything producing a block
 * row's PRIMARY output. A block is a statement about your capacity for that item
 * ("my Motor line makes 30/min"), so letting the solver add more would make the
 * maximum unbounded — raws are free here, so it would just build more from ore.
 *
 * Scoped to outputs[0] deliberately. A block's byproducts stay available: a
 * Scrap line also outputs Water, and excluding every water-producing recipe in
 * the game because one block mentions it would wreck the plan. Have rows are
 * likewise untouched — "I can draw 300/min off my bus" is a floor, not a claim
 * that no more can exist.
 *
 * This never removes the block itself: blocks are applied through pinnedBalance,
 * never through enabledRecipeIds.
 */
export function blockOutputExclusions(dataset, blockRows) {
  const byId = new Map(dataset.recipes.map((r) => [r.id, r]));
  const declared = new Set();
  for (const b of blockRows || []) {
    const resolved = blockLoad(byId, b);
    if (!resolved || resolved.load <= 0) continue;
    const primary = resolved.recipe.outputs?.[0]?.itemId;
    if (primary) declared.add(primary);
  }
  const excluded = new Set();
  if (declared.size === 0) return excluded;
  for (const r of dataset.recipes) {
    if ((r.outputs || []).some((o) => declared.has(o.itemId))) excluded.add(r.id);
  }
  return excluded;
}
```

- [ ] **Step 5: Implement the max branch**

Change the signature at `:268` to add `mode = 'targets'`, then replace the solve block at `:284-287`:

```js
  const maxRows = all.filter((r) => r?.kind === 'max');
  const maxTargets = maxRows
    .filter((r) => typeof r?.itemId === 'string' && r.itemId)
    .map((r) => ({ itemId: r.itemId, weight: Number(r.weight) > 0 ? Number(r.weight) : 1 }));
  const isMax = mode === 'max' && maxTargets.length > 0;

  // In max mode the solver may not add to a declared line's primary output.
  const excluded = isMax ? blockOutputExclusions(dataset, blockRows) : new Set();
  const solveEnabled = excluded.size > 0
    ? new Set([...enabledRecipeIds].filter((id) => !excluded.has(id)))
    : enabledRecipeIds;

  let solved;
  if (isMax) {
    // `targets` from splitDemand are floors here, not the objective: a To-build
    // block's feedstock still has to be planned while something else is maximized.
    solved = maxSets({ dataset, caps, enabledRecipeIds: solveEnabled, targets: maxTargets, supplies, minRates: targets });
  } else if (targets.size > 0) {
    solved = hitTargets({ dataset, caps, enabledRecipeIds, targets, supplies });
  } else {
    solved = { feasible: true, recipeRates: new Map(), shortfalls: new Map(), supplyDrawn: supplies.map((s) => ({ itemId: s.itemId, kind: s.kind, used: 0 })) };
  }
```

Add `maxSets` to the import from `./optimize.js` at `:13`.

Everything downstream (`realize`, `beltReport`, `computeNetOutput`, the raw footer, the graph merge) reads `solved.recipeRates` and is unchanged. Note `solveEnabled` is what you must pass to `ratesFrom`'s consumers — `maxSets` already uses it internally, so `solved.recipeRates` is correct without further work.

- [ ] **Step 6: Implement the maximize readout**

Before the `return {`, add:

```js
  // Binding = this declared supply was consumed to exhaustion. Computed here
  // rather than from supplyUsage, which is filtered to have-rows only and whose
  // `capped` flag also requires the item to be LP-built — never true in max mode,
  // since the item's recipes are excluded by design.
  const maximize = !isMax ? undefined : (() => {
    const drawn = solved.supplyDrawn || [];
    const bindingItems = supplies
      .map((s, i) => ({ s, used: drawn[i]?.used ?? 0 }))
      .filter(({ s, used }) => s.rate > EPS && used >= s.rate - EPS)
      .map(({ s }) => ({ itemId: s.itemId, name: nameOf(dataset, s.itemId), rate: round6(s.rate) }));
    return {
      sets: round6(solved.sets || 0),
      perPart: (solved.perPart || []).map((p) => ({
        itemId: p.itemId,
        name: nameOf(dataset, p.itemId),
        slug: slugOf(dataset, p.itemId),
        fluid: fluidOf(dataset, p.itemId),
        weight: p.weight,
        rate: round6(p.rate),
      })),
      bindingItems,
      bounded: bindingItems.length > 0,
    };
  })();
```

Add `mode` and `maximize` to the returned object.

- [ ] **Step 7: Run to verify they pass**

Run: `npm test`
Expected: **251 pass, fail 0** (10 new). All 241 prior tests must still pass — the `mode = 'targets'` default is what guarantees it. If the balanced-sets test's ratio is off, check that `perPart`'s `rate` is `weight * sets`, not `sets`.

- [ ] **Step 8: Commit**

```bash
git add js/engine/expansion.js test/engine/expansion.test.js
git commit -m "feat(engine): maximize mode for the Expansion planner

Answers the other question the Optimizer already answers for ore: given the
lines you declared, what's the most of X you can make. Raws are free in this
view, so the bound is what you declared — your lines become capped supplies and
recipes producing a block's PRIMARY output are withheld from the solver, since a
block is a statement about your capacity for that item.

Scoped to outputs[0] on purpose: a block's byproducts and every have row stay
available, because declaring a Scrap line shouldn't forbid the whole game from
producing Water.

splitDemand's targets become rate FLOORS in max mode rather than the objective,
so a To-build block's feedstock is still planned while something else is
maximized.

Binding is computed from supplyDrawn, not from supplyUsage — that one is
filtered to have-rows and its capped flag also requires the item to be LP-built,
which is never true here since the item's recipes are excluded. When nothing
binds, the readout says unbounded instead of printing the 1e9-clamp number.

mode defaults to 'targets', so every existing caller and all 241 prior tests are
unaffected."
```

---

### Task 4: Persist `mode` and the maximize rows

**Files:**
- Modify: `js/ui/expansion.js` — `DEFAULT_STATE`, `sanitizeState`
- Test: `test/ui/expansion.test.js`

**Interfaces:**
- Consumes: the `{ kind: 'max', itemId, weight }` row shape and `mode: 'targets' | 'max'` from Task 3.
- Produces: sanitized state gains `mode` (only `'max'` or `'targets'`, defaulting to `'targets'`) and accepts `kind: 'max'` rows with a clamped positive `weight`. Task 5 reads both.

- [ ] **Step 1: Write the failing tests**

Append to `test/ui/expansion.test.js`:

```js
test('sanitizeState: mode accepts only max or targets, defaulting to targets', () => {
  assert.equal(sanitizeState(null).mode, 'targets');
  assert.equal(sanitizeState({}).mode, 'targets');
  assert.equal(sanitizeState({ mode: 'max' }).mode, 'max');
  assert.equal(sanitizeState({ mode: 'targets' }).mode, 'targets');
  assert.equal(sanitizeState({ mode: 'nonsense' }).mode, 'targets', 'an unknown mode falls back');
  assert.equal(sanitizeState({ mode: 7 }).mode, 'targets', 'a non-string falls back');
});

test('sanitizeState: max rows keep an itemId and a positive weight', () => {
  const s = sanitizeState({ rows: [
    { kind: 'max', itemId: 'a' },
    { kind: 'max', itemId: 'b', weight: 3 },
    { kind: 'max', itemId: 'c', weight: -2 },
    { kind: 'max', itemId: 'd', weight: 'abc' },
    { kind: 'max', weight: 2 },
  ] });
  assert.deepEqual(s.rows, [
    { kind: 'max', itemId: 'a', weight: 1 },
    { kind: 'max', itemId: 'b', weight: 3 },
    { kind: 'max', itemId: 'c', weight: 1 },
    { kind: 'max', itemId: 'd', weight: 1 },
  ], 'a missing/invalid weight becomes 1; a row with no itemId is dropped');
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npm test`
Expected: FAIL — `mode` is undefined and `kind: 'max'` rows are dropped by the unknown-kind branch.

- [ ] **Step 3: Implement**

Add `mode: 'targets'` to `DEFAULT_STATE`. In `sanitizeState`'s row loop, add a branch after the `want`/`have` one:

```js
    } else if (r.kind === 'max') {
      if (typeof r.itemId !== 'string' || !r.itemId) continue;
      const weight = Number(r.weight);
      rows.push({ kind: 'max', itemId: r.itemId, weight: Number.isFinite(weight) && weight > 0 ? weight : 1 });
    }
```

Before the `return`, add:

```js
  const mode = raw.mode === 'max' ? 'max' : 'targets';
```

and include `mode` in the returned object.

- [ ] **Step 4: Run to verify they pass**

Run: `npm test`
Expected: **253 pass, fail 0**. The existing `sanitizeState: null / garbage falls back to defaults` test compares against `DEFAULT_STATE`, so adding `mode` there keeps it passing — if it fails, you added `mode` to the return but not to `DEFAULT_STATE`.

- [ ] **Step 5: Commit**

```bash
git add js/ui/expansion.js test/ui/expansion.test.js
git commit -m "feat(ui): persist the Expansion solve mode and its maximize rows

mode accepts only 'max' or 'targets' and falls back to 'targets' for anything
else, so an older payload with no mode behaves exactly as it does today and
STATE_KEY doesn't need bumping. A max row keeps its itemId and a positive
weight, defaulting to 1, and is dropped without an itemId — same shape the
engine's maxTargets filter expects."
```

---

### Task 5: The mode toggle and the maximize readout

**Files:**
- Modify: `js/ui/expansion.js` (the mode select, the Maximize section, `recompute`, `computeExpansionResult`), `js/ui/expansion-render.js` (the headline), `css/styles.css` (append)
- Test: none new — this is DOM and the suite has no shim. Verified in the browser at Step 5.

**Interfaces:**
- Consumes: `mode` and `max` rows from Task 4; `plan.maximize` and `plan.mode` from Task 3.
- Produces: nothing later depends on. Final task.

- [ ] **Step 1: Add the mode select**

Mirror the Optimizer's pattern at `js/ui/inputs.js:441-452`. In `buildExpansion`, before the row sections:

```js
  const modeSelect = el('select');
  for (const [value, label] of [['targets', 'Target rates'], ['max', 'Maximize']]) {
    const opt = el('option');
    opt.value = value;
    opt.textContent = label;
    modeSelect.appendChild(opt);
  }
  modeSelect.value = saved.mode === 'max' ? 'max' : 'targets';
  const modeRow = el('div', 'exp-mode');
  const modeLabel = el('span', 'target-row__label');
  modeLabel.textContent = 'Mode';
  modeRow.append(modeLabel, modeSelect);
  container.appendChild(modeRow);
```

- [ ] **Step 2: Add the Maximize section and toggle visibility**

`buildRowSection(parent, heading, hint, addLabel, makeRow, scheduleRecompute)` is at `js/ui/expansion.js:289`. **It returns `{ addRow, readAll }` only — there is no `el`**, because it appends its heading, hint, row list and Add button directly onto `parent`. So there is no single node to hide, and each toggleable section needs its own wrapper passed in as `parent` (Step 2b below). Add a row factory beside `makeRateRow` (`:250`):

```js
/** One maximize target: item picker plus an optional relative weight. */
function makeMaxRow(itemOpts, initial, onChange) {
  const row = el('div', 'target-row');
  const picker = createSearchSelect({ options: itemOpts, placeholder: 'Item…', showIcon: true });
  picker.el.style.width = '100%';
  row.appendChild(picker.el);

  const foot = el('div', 'target-row__foot');
  const label = el('span', 'target-row__label');
  label.textContent = 'Weight';
  const weightInput = numberInput({ value: initial?.weight ?? 1, min: 1, step: 1, width: '4rem' });
  const removeBtn = el('button');
  removeBtn.type = 'button';
  removeBtn.textContent = 'Remove';
  removeBtn.style.marginLeft = 'auto';
  foot.append(label, weightInput, removeBtn);
  row.appendChild(foot);

  picker.onSelect(onChange);
  weightInput.addEventListener('input', onChange);
  if (initial?.itemId) picker.setValue(initial.itemId);

  return {
    el: row,
    removeBtn,
    read: () => ({ kind: 'max', itemId: picker.getValue(), weight: clampTo(MAX_MACHINES, weightInput.value) || 1 }),
  };
}
```

- [ ] **Step 2b: Give the toggleable sections wrappers, then toggle those**

Because `buildRowSection` has no returned element, create a wrapper per toggleable section and pass it as `parent`. The existing want section currently receives `rowsPane` directly — change it to receive `wantWrap`. Toggle the **wrappers**, never the rows, so the user's input survives a mode switch:

```js
  const wantWrap = el('div');
  rowsPane.appendChild(wantWrap);
  const wantSection = buildRowSection(
    wantWrap,
    'Want',
    'Flat extra demand for an item, on top of whatever the blocks above consume.',
    '+ Add want',
    (initial, onChange) => makeRateRow('want', itemOpts, initial, onChange),
    scheduleRecompute,
  );

  const maxWrap = el('div');
  rowsPane.appendChild(maxWrap);
  const maxSection = buildRowSection(
    maxWrap,
    'Maximize',
    'Make as much of this as your declared lines allow. Weight sets the ratio when you pick more than one.',
    '+ Add target',
    (initial, onChange) => makeMaxRow(itemOpts, initial, onChange),
    scheduleRecompute,
  );

  const goalsWrap = el('div');
  rowsPane.appendChild(goalsWrap);
  const goalsNote = el('p', 'hint');
  goalsNote.textContent = 'Goals plan a fixed milestone cost, so they apply in Target rates mode.';
  rowsPane.appendChild(goalsNote);

  function applyMode() {
    const isMax = modeSelect.value === 'max';
    wantWrap.hidden = isMax;
    maxWrap.hidden = !isMax;
    goalsWrap.hidden = isMax;
    goalsNote.hidden = !isMax;
  }
  modeSelect.addEventListener('change', () => { applyMode(); scheduleRecompute(); });
```

The heading, hint and button strings above are copied verbatim from the current want-section call at `js/ui/expansion.js:525-532` — this task is not changing that copy, so if your edit produces anything different you've drifted. The goals section is built by `buildGoalsSection(parent, catalog, initial, scheduleRecompute)` (`:331`) and is currently called with `rowsPane` at `:543`; pass it `goalsWrap` instead.

Current DOM order in `rowsPane` is **blocks, want, have, goals**. Insert maximize directly after want, giving **blocks, want, maximize, have, goals (+ note)**. Keep `have` where it is — it applies in both modes (a have row is a floor you can draw on either way), so it must not be inside a toggled wrapper.

- [ ] **Step 3: Thread mode through the compute**

`computeExpansionResult` is at `js/ui/expansion.js:409`. Add `mode` to its destructured params and pass it to `planExpansion`. In `recompute`, read the mode and include the max rows:

```js
    const rows = [...blockSection.readAll(), ...wantSection.readAll(), ...maxSection.readAll(), ...haveSection.readAll()];
    const mode = modeSelect.value === 'max' ? 'max' : 'targets';
```

Pass `mode` into `computeExpansionResult` and add it to the `saveState` call, which must stay **after** the `if (!result.ok) return` guard:

```js
    saveState({ rows, goals, fillMinutes, alts: [...altPicker.getEnabledIds()], mode });
```

Restore on boot: `modeSelect.value = saved.mode === 'max' ? 'max' : 'targets';` then `applyMode();` before the initial `recompute()`.

- [ ] **Step 4: Render the maximize headline**

In `js/ui/expansion-render.js`'s `renderPlan`, before the tiles panel:

```js
  if (plan.mode === 'max' && plan.maximize) {
    wrap.appendChild(renderMaximizePanel(plan.maximize));
  }
```

and add the builder beside the other panels:

```js
/**
 * The maximize headline. An unexplained maximum isn't actionable, so it names
 * what bound the answer — and when nothing did, it refuses to print a rate at
 * all rather than showing a number the raw clamp invented.
 */
function renderMaximizePanel(m) {
  const section = panel('Most you can make');
  if (!m.bounded) {
    const p = el('p', 'hint');
    p.textContent = m.perPart.length === 0
      ? 'Pick something to maximize.'
      : `Your declared lines don't feed ${m.perPart.map((x) => x.name).join(' or ')} — there's nothing here to bound the answer. Add a block or a have row it depends on.`;
    section.appendChild(p);
    return section;
  }
  const list = el('ul', 'belt-list');
  for (const p of m.perPart) {
    const li = el('li');
    li.appendChild(icon(p.slug, p.fluid ? 'fluid' : 'item', p.name));
    const nameSpan = el('span');
    nameSpan.textContent = p.name;
    li.appendChild(nameSpan);
    const rateSpan = el('span');
    rateSpan.textContent = `${fmt1(p.rate)}${p.fluid ? ' m³' : ''}/min`;
    li.appendChild(rateSpan);
    list.appendChild(li);
  }
  section.appendChild(list);
  const bound = el('p', 'hint');
  bound.textContent = `Bound by ${m.bindingItems.map((b) => `${b.name} ${fmt1(b.rate)}/min`).join(', ')} — your line, fully used.`;
  section.appendChild(bound);
  return section;
}
```

- [ ] **Step 5: Style and verify in the browser**

Append to `css/styles.css`:

```css
.exp-mode {
  display: flex;
  gap: 0.5rem;
  align-items: center;
  margin: 0 0 0.6rem;
}
```

Then serve and drive it:

```bash
python3 -m http.server 8791 >/tmp/httpd.log 2>&1 &
sleep 2
```

Write a throwaway `_probe.html` at the repo root that loads `/` in an iframe, clicks `#tab-expansion`, seeds a Built block plus a max row via `localStorage` with `mode: 'max'`, and reports the headline text, then screenshot it:

```bash
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --disable-gpu \
  --virtual-time-budget=20000 --window-size=1500,2400 \
  --screenshot=/tmp/max-mode.png 'http://localhost:8791/_probe.html'
```

**Read the PNG.** Confirm: the Mode select shows Maximize; the "Most you can make" panel shows a rate and a "Bound by …" line; the Want section is hidden and Maximize is visible; the Goals note appears instead of the Goals checkboxes; no console or window errors.

Then do the two things a seeded probe can't: switch the select to **Target rates** and confirm the Want section and Goals come back with their rows intact, and remove the block so nothing is declared and confirm the unbounded message appears **with no rate**.

Delete `_probe.html`, kill the server, and confirm `git status --short` is clean.

- [ ] **Step 6: Run the suite and commit**

Run: `npm test` — expected **253 pass, fail 0**, unchanged from Task 4.

```bash
git add js/ui/expansion.js js/ui/expansion-render.js css/styles.css
git commit -m "feat(ui): Maximize / Target rates toggle for the Expansion view

Mirrors the Optimizer's own mode select. In Maximize the Want section becomes
Maximize targets — an item and a relative weight, no rate box — and the headline
names what bound the answer, because an unexplained maximum isn't actionable.
When nothing bounds it, it says so instead of printing the number the raw clamp
invented.

Goals stays a Target-rates feature with a one-line note saying why, rather than
vanishing: a milestone is a fixed cost, not something to maximize. Switching
modes hides a section rather than rebuilding it, so your rows survive the round
trip."
```

---

## Post-plan

Update the ledger at `.superpowers/sdd/2026-08-05-expansion-maximize-mode/progress.md`, then run a final whole-branch review before this is considered shippable. Update `README.md`'s Expansion section — it currently describes only the target-rates behaviour.

Note for the final review: `js/ui/**` still has no automated coverage, so Task 5 is browser-verified only. Two earlier rounds on this feature found that delivered tests didn't discriminate what they claimed to pin, so mutation-test this plan's new tests specifically — particularly Task 3's exclusion test, which is the one guarding against the 21-million bug.

Deferred, unchanged from the spec: ore caps in Expansion; a build-budget bound; Goals in max mode; shard-budget / belt-tier / pipe-tier controls; alternate *suggestions* in Expansion.
