# Alternate-Recipe Improvement Suggestions — Design Spec

Date: 2026-07-23
Status: Approved for planning
Depends on: `2026-07-22-satisfactory-optimizer-design.md` (base architecture),
`2026-07-23-resource-requirements-diagnostics-design.md` (callout/rendering pattern this mirrors)

## 1. Overview

Alternate recipes ship **disabled by default** (you must unlock them in-game). When
some are off, the optimizer is solving with a restricted recipe set and may be
leaving output/efficiency on the table. This feature analyzes which *disabled*
alternates would improve the current build and surfaces them as actionable
suggestions with a one-click **Enable**:

> 💡 Enable **Cast Screw** → −4 machines (12 → 8)
> 💡 Enable **Steel Rotor** → +6 Rotor/min (+18%)

The optimizer/LP itself is unchanged; this is an analysis layer that re-runs the
existing solver with extra recipes enabled and diffs the result.

## 2. Goals / Non-goals

**Goals**
- Suggest the specific disabled alternates that would improve *this* build.
- Quantify each suggestion's benefit and let the user enable it in one click.
- Keep the analysis in a pure, unit-tested engine module.

**Non-goals**
- No change to the LP model / solver / optimize / physical / belt engine internals.
- No power-only suggestions (not a selected metric).
- No unlock-state awareness — the tool has no data on what the player has unlocked;
  the existing alt-panel warning already says "enable the ones you've unlocked."
- No combination suggestions in v1 (rank by *individual* marginal benefit).

## 3. Improvement metrics (per the selected triggers)

A suggestion is shown only when enabling the alternate yields a real gain in one of:

- **Higher output** — *Maximize* mode: more balanced sets / more of the target part.
- **Fewer machines** — same result, fewer buildings (the Cast Screw case).
- **Meets targets / less raw** — *Target-rates* mode: reduces/eliminates a shortfall,
  or hits the same targets using less raw resource.

Power draw is **not** a trigger.

### Mode framing
- **Maximize:** output is the objective, so suggestions surface **output gains**
  (`+X part/min (+P%)`). Machine/raw counts are side effects of the min-raw pass in
  this mode and are not used as the ranking metric here.
- **Target-rates:** output is fixed by the targets, so suggestions surface, in
  priority order: **meets/reduces shortfall** → **fewer machines** → **less raw**.

## 4. New pure engine module — `js/engine/suggestions.js`

No DOM. Imports `maxSets`/`hitTargets` from `optimize.js` and `realize` from
`physical-layer.js` (same composition `view-model.js` already uses). Deterministic.

```
suggestAlternates(
  { dataset, caps, enabledRecipeIds, mode, targets, noWaste = false, shardBudget = 0 },
  { maxSuggestions = 4, maxCandidates = 12 } = {}
) → {
  suggestions: [
    { recipeId, recipeName, outputItemId,
      benefit: { kind: 'output'|'machines'|'raw'|'targets', label: string,
                 /* numeric fields per kind, see §4.3 */ } }
  ],
  evaluatedCount: number,
  capped: boolean,   // true if candidate count exceeded maxCandidates
}
```

### 4.1 Helpers used
- `solveFor(recipeIds)` — runs `maxSets({...})` (mode `max`) or `hitTargets({...})`
  (mode `targets`) with the given enabled-recipe set; returns `{ recipeRates, sets,
  perPart, shortfallTotal, feasible }`. `sets`/`perPart` from maxSets (Maximize;
  `perPart` gives the per-target `{itemId, weight, rate}` used for the single-part
  label); `shortfallTotal` = sum of the `hitTargets` shortfalls Map values
  (Target-rates). Fields not relevant to the active mode are left undefined.
- `metricsFor(recipeRates)` — `realize({ dataset, recipeRates, shardBudget })` for
  `totalMachines`; `rawTotal` = Σ over `recipeRates` of positive raw-resource
  consumption (`inp.perMin * x` for inputs whose itemId ∈ `dataset.rawResourceIds`,
  minus raw outputs), i.e. the same net-raw computation `view-model.rawUsage` does.

### 4.2 Algorithm
1. `disabledAlts` = `dataset.recipes.filter(r => r.alternate && !enabledRecipeIds.has(r.id))`.
   If empty → return `{ suggestions: [], evaluatedCount: 0, capped: false }`.
2. **Baseline:** `base = solveFor(enabledRecipeIds)`, `baseMetrics = metricsFor(base.recipeRates)`.
3. **Upper bound:** `all = solveFor(enabledRecipeIds ∪ disabledAlts)`. **Candidates** =
   disabled alternates that appear in `all.recipeRates` with rate > 1e-9 (only recipes
   the global optimum actually uses can help). Sort candidates by their `all.recipeRates`
   value desc; if more than `maxCandidates`, keep the top `maxCandidates` and set
   `capped = true`.
4. For each candidate `C`: `plus = solveFor(enabledRecipeIds ∪ {C})`,
   `plusMetrics = metricsFor(plus.recipeRates)`. Adding a recipe never shrinks the
   feasible region, so output ≥, shortfall ≤, raw ≤ baseline (weakly); machines may
   move either way (min-raw ≠ min-machines), so a machine gain is claimed only when
   observed. Compute the benefit (§4.3); drop `C` if no real gain (all deltas within ε).
5. Rank the surviving candidates (§4.4) and return the top `maxSuggestions`.

Cost: 1 baseline + 1 all-on + ≤`maxCandidates` solves, all small LPs, behind the
existing 150 ms debounce (~tens of ms on the real 276-recipe dataset). `maxSets`
runs two passes internally; that is unchanged.

### 4.3 Benefit per candidate
- **Maximize** (`kind: 'output'`): `deltaSets = plus.sets − base.sets`.
  - `base.sets ≈ 0 && plus.sets > ε` → label `"builds this (0 → {rate}/min)"`.
  - else → `"+{Δrate} {partName}/min (+{pct}%)"` for a single part, or
    `"+{pct}% output ({Δsets} sets/min)"` for multiple. (Rate/part derived from
    `perPart`/`sets`; `pct = deltaSets / base.sets`.)
  - Kept iff `deltaSets > ε`.
- **Target-rates:** evaluate in this precedence and assign the first that applies:
  - `kind: 'targets'` if `base.shortfallTotal > ε && plus.shortfallTotal < base.shortfallTotal − ε`:
    label `"meets all targets (was short {base.shortfallTotal}/min)"` when
    `plus.shortfallTotal ≈ 0`, else `"reduces shortfall by {Δ}/min"`.
  - `kind: 'machines'` if `plusMetrics.totalMachines < baseMetrics.totalMachines`:
    label `"−{Δ} machines ({base} → {plus})"`.
  - `kind: 'raw'` if `plusMetrics.rawTotal < baseMetrics.rawTotal − ε`:
    label `"−{Δ}/min raw ({pct}% less)"`.
  - Kept iff one of the above applies.

Numeric fields (e.g. `deltaMachines`, `deltaSets`, `pct`) are included on `benefit`
alongside `label` so tests assert on numbers, not string formatting. Rates rounded
with the existing `fmt1`/`fmt2` helpers when shaped for display.

### 4.4 Ranking
- Maximize: by `deltaSets` desc.
- Target-rates: `targets` kind first (by shortfall reduction desc), then `machines`
  (by machines saved desc), then `raw` (by raw saved desc).

## 5. Integration — `js/ui/view-model.js`

`computePlan` calls `suggestAlternates` with the request it already holds and attaches
a render-ready `suggestions` array to the `PlanView`, shaping each entry with the
recipe name and its primary output item's slug (for the icon), plus the `benefit`:

```
suggestions: [ { recipeId, recipeName, outputSlug, benefit: { kind, label, ... } } ]
```

`suggestAlternates` does its own solves, so `computePlan` stays a thin caller. When
there are no disabled alternates the array is empty. This is independent of and does
not alter the existing `requirements` / `hasProduction` fields.

## 6. Rendering + one-click Enable

### 6.1 `js/ui/render.js`
- New `renderSuggestions(suggestions, onEnable)`: an **accent**-colored `.suggestions`
  callout (visually distinct from the red `.requirements--critical` / amber
  `--warning` callouts). Each row: the output-item icon (`makeIcon`), recipe name,
  the benefit label, and an **Enable** button. All dataset strings via `textContent`.
  The Enable button calls `onEnable(recipeId)` (no-op safe if `onEnable` is absent).
- `renderResults(rootEl, planView, handlers = {})` gains an optional `handlers`
  argument; `handlers.onEnableAlternate` is threaded to `renderSuggestions`.
- **Order** (important): headline → requirements callouts → **suggestions** →
  `if (!hasProduction) return` → tiles/meters/build/belts/diagram/refinements.
  Suggestions render **before** the hide-empty-plan early return so that "enable X to
  build this at all" still shows when the base recipes produce nothing. When a target
  is flagged impossible under the current recipes but an alternate would build it, the
  red requirement callout and the accent suggestion appear together — complementary,
  not contradictory.

### 6.2 `js/ui/inputs.js`
- `buildInputs` returns a new `enableAlternate(recipeId)`: finds the matching entry in
  `altRowEntries`, sets its checkbox `checked = true`, `altChecked.set(recipeId, true)`,
  calls `updateSummary()`, and `emitChange()` (which persists state and fires the live
  recompute). No-op if the id isn't an alternate. Reuses existing machinery; no change
  to `readRequest`, `restoreState`, or the checkbox handlers.

### 6.3 `js/main.js`
- Pass `{ onEnableAlternate: (id) => inputs.enableAlternate(id) }` as the `handlers`
  arg to `renderResults`. Clicking Enable ticks the alternate on → debounced recompute
  → the now-enabled alternate drops out of the suggestions and the improved plan renders.
  `inputs` is the object returned by `buildInputs` (destructure to keep `enableAlternate`).

## 7. Testing (TDD, `node --test`)

- **`test/engine/suggestions.test.js`** (new) — inline hand-built datasets (fixtures
  have no alternates; `mini-data.js` must stay unchanged):
  - Maximize: base `ore→ingot` (1:1) + a higher-yield alternate (`ore→ingot` 1:2) →
    suggests the alt, `benefit.kind === 'output'`, `deltaSets` positive and correct.
  - Target-rates, machines: a base chain needing N machines for the target + a
    Cast-Screw-style alt that hits the same target with fewer → `kind:'machines'`,
    `deltaMachines` equals the real reduction.
  - Target-rates, shortfall: base can't meet the target from the added raw, an alt can →
    `kind:'targets'`, shortfall reduced to ~0.
  - No disabled alternates → `[]`. An alternate the all-on optimum never uses → not a
    candidate, not suggested. `maxCandidates` cap → `capped === true` and length bounded.
  - Adding an alternate never lowers max output / never raises shortfall (monotonicity
    sanity on a fixture).
- **`test/ui/view-model.test.js`** (extend): `computePlan` attaches a correctly-shaped
  `suggestions` array for a scenario with a beneficial disabled alternate, and an empty
  array when all alternates are enabled.
- **Render + Enable wiring:** verified via the headless-Chrome screenshot pass (no jsdom),
  consistent with prior phases; `enableAlternate` behavior confirmed by driving the UI.
- Full `npm test` stays green.

## 8. Files touched

| File | Change |
|---|---|
| `js/engine/suggestions.js` | **new** — `suggestAlternates` analysis (§4) |
| `js/ui/view-model.js` | call `suggestAlternates`, attach shaped `suggestions` (§5) |
| `js/ui/render.js` | `renderSuggestions` + `handlers` arg + render order (§6.1) |
| `js/ui/inputs.js` | `enableAlternate(recipeId)` on the `buildInputs` return (§6.2) |
| `js/main.js` | pass `onEnableAlternate` into `renderResults` (§6.3) |
| `css/styles.css` | `.suggestions` accent callout + Enable-button styling |
| `test/engine/suggestions.test.js` | **new** — unit tests (§7) |
| `test/ui/view-model.test.js` | extend for `suggestions` (§7) |

## 9. Phasing

Single implementation plan, tests-first:
1. `suggestions.js` + `suggestions.test.js` (pure, TDD).
2. `view-model.js` integration + extended view-model tests.
3. `render.js` `renderSuggestions` + order + `handlers`; `inputs.js` `enableAlternate`;
   `main.js` wiring; `css` — verified by screenshot + live Enable click.
4. Full `npm test`, README note, local commit to a `phase-7` branch.

## 10. Out of scope / deferred

- Power-only suggestions; unlock-state filtering; multi-alternate combination advice.
- Reusing `computePlan`'s baseline solve inside `suggestAlternates` (a possible perf
  optimization; v1 keeps the module self-contained and re-solves the baseline).
