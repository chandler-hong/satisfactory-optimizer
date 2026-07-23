# Resource Requirements & Feasibility Diagnostics — Design Spec

Date: 2026-07-23
Status: Approved for planning
Depends on: `2026-07-22-satisfactory-optimizer-design.md` (base architecture)

## 1. Overview

Four focused UX improvements to the Factory Optimizer, none of which touch the
LP/solver:

1. **Default-vein note** — a line under Resources telling the player that veins
   are Normal purity by default.
2. **Missing-resource hint** — when a target can't be built from the resources
   you've added, list the raw resources it needs, marked added (✓) / missing (✗).
3. **Impossible-scenario error** — when the resources you added can't feed the
   target at all (e.g. Crude Oil → Modular Frame), show a clear error and hide
   the otherwise-empty plan.
4. **Target row + dropdown layout fix** — the Maximize/Target picker rows crimp
   the item name and the dropdown wraps long option names; widen the popup and
   stack the row.

Features 2 and 3 are two severities of a single computation: *does what you
added actually produce the target, and if not, why?*

### Motivating problem (current behavior)

- **Maximize** mode, only Crude Oil added, target Modular Frame: the LP is
  feasible at zero output, so the UI silently prints `"0 Modular Frame/min"`
  plus empty tiles / "No production required" / empty meters — no explanation.
- **Target-rates** mode, same inputs: a shortfall is reported ("short by N/min")
  but never says *why* (missing Iron Ore).

The fix adds the "why" and turns the genuinely-impossible case into a clear,
actionable error.

## 2. Goals / Non-goals

**Goals**
- Tell the user which raw resources a target requires, and which they're missing.
- Distinguish "you're missing some inputs" (helpful, amber) from "these
  resources fundamentally can't make this" (error, red).
- Keep the new logic in a pure, unit-tested engine module, consistent with
  `resource-model.js` / `lp-builder.js`.
- Fix the cramped target picker rows and wrapping dropdown.

**Non-goals**
- No change to the LP model, solver, or the optimize/physical/belt layers.
- Not addressing the latent unclamped raw-coefficient risk (tracked separately).
- Not minimizing the dependency list under alternate recipes — v1 lists the full
  union of raw ancestors; with the default base-recipe set this is already exact
  (see §5.4).

## 3. Feature 1 — Default-vein note

Purely informational text; **no change** to input defaults (Impure / Normal /
Pure counts stay 0).

- In `js/ui/inputs.js`, append a second `.hint` line under the existing
  Resources hint (currently: *"Add ore, water, oil, or gas — each row adapts to
  how the resource is extracted."*).
- Text: **"New veins default to Normal purity — set Impure/Pure to match your map."**
- Reuses the existing `.hint` style; no CSS change.

## 4. Feature 4 — Target row + dropdown layout fix

### 4.1 Dropdown option wrapping (all comboboxes)

`.search-list` is absolutely positioned with the input's width (`left:0;
right:0`), so long item names ("Adaptive Control Unit") wrap onto 2–3 lines.
CSS-only fix in `css/styles.css`:

- `.search-list`: add `min-width: 18rem;` and `max-width: min(24rem, 90vw);`.
  When `min-width` exceeds the input width, the over-constrained `right:0` is
  ignored (LTR) and the popup grows rightward, floating over the panel (it
  already has `z-index:20`, a `--surface` background, and a shadow).
- `.search-option`: add `white-space: nowrap;`.
- The option's label `<span>` gets `overflow: hidden; text-overflow: ellipsis;`
  as a safety net for pathologically long names.

Applies to the resource picker and both target pickers (shared
`createSearchSelect`). No JS change required for this part.

### 4.2 Cramped target rows (both builders)

The picker (`flex: 1 1 9rem`) shares one line with the weight/rate box and the
Remove button, squeezing the selected name to "Heavy M…". Restructure both
`makeMaxTargetRow` and `makeTargetRow` in `js/ui/inputs.js` to a two-line
layout, mirroring the roomier `.res-card`:

- Line 1: the item picker at full width.
- Line 2: a small label + the weight box (Maximize) or rate box (Target rates),
  with the Remove button right-aligned (`margin-left: auto`).

CSS: `.target-row` becomes `display: flex; flex-direction: column; gap`. Add a
`.target-row__foot` row (flex, align center) and a `.target-row__label`
(`--ink-2`, small). `makeTargetRow` currently uses inline flex styles — replace
them with the shared `.target-row` class so both modes match.

Visible labels ("Weight", "Rate /min") are added now that the row affords the
space (improves readability; the weight `title` tooltip stays).

No logic change; verified via the headless-Chrome screenshot pass.

## 5. Features 2 + 3 — Requirements analysis

### 5.1 New pure module — `js/engine/requirements.js`

No DOM, no solver; depends only on the dataset shape (`recipes` with
`inputs`/`outputs` of `{itemId, perMin}`, `items`, `rawResourceIds`). Unit-
tested like the other engine modules.

```
analyzeRequirements(dataset, enabledRecipeIds, availableRawIds, userAddedRawIds, targetItemIds)
  → {
      perTarget: [
        {
          itemId,
          status: 'ok' | 'missing' | 'impossible',
          reason: 'partial' | 'no-resources' | 'wrong-resources' | 'no-recipe',
          deps: [ { itemId, added: boolean } ],   // raw ancestors, sorted by name
        }
      ],
      anyImpossible: boolean,
      anyMissing: boolean,
    }
```

- `availableRawIds` — every raw resource with cap > 0, **including** auto-water
  (drives buildability + the ✓/✗ flag; auto-water always shows ✓).
- `userAddedRawIds` — raws the user *explicitly* added (finite cap > 0),
  **excluding** auto-unlimited water (drives the overlap severity test in §5.3).

### 5.2 Core helper — producible closure

```
producibleClosure(dataset, enabledRecipeIds, seedIds)
  → { producible: Set<itemId>, firedRecipeIds: Set<recipeId> }
```

Fixpoint: start with `producible = new Set(seedIds)`. Repeatedly, for every
enabled recipe whose inputs are **all** in `producible`, add its outputs (and
record it in `firedRecipeIds`); loop until no change. Monotonic, so cycles
(e.g. recycled plastic/rubber) terminate safely. A recipe with no inputs fires
immediately (none exist in the real data, but the rule is well-defined).

### 5.3 Per-target analysis

Let `A` = `availableRawIds`, `U` = `userAddedRawIds`, and `R` =
`dataset.rawResourceIds`.

1. **Buildable check.** `buildable = producibleClosure(A).producible.has(T)`.
2. **Dependency set.** Compute `firedAll =
   producibleClosure(R).firedRecipeIds` once (shared across targets). `deps` =
   raw resources reachable by walking **backward** from `T` over recipes in
   `firedAll` (for each item, follow the inputs of every fired recipe that
   outputs it; collect items in `R`). Restricting to `firedAll` means we never
   name a raw via a recipe that can't actually run. `deps` empty ⇔ no
   production path exists for `T` at all.
3. **Status:**

   ```
   if T ∈ R:                       # target is itself a raw resource
       status = A.has(T) ? 'ok' : 'missing'  (reason 'no-resources'; deps=[{T, added:false}])
   elif buildable:
       status = 'ok'
   elif deps.size == 0:
       status = 'impossible', reason = 'no-recipe'      # enable alternates?
   else:
       overlap = deps ∩ U
       if overlap.size > 0:
           status = 'missing', reason = 'partial'        # have some, need the rest
       elif U.size == 0:
           status = 'missing', reason = 'no-resources'  # haven't added anything relevant yet
       else:
           status = 'impossible', reason = 'wrong-resources'  # added resources don't feed T
   ```

4. `deps` entries carry `added = A.has(dep)` (so auto-water reads ✓). Sorted by
   item name for stable display.

`anyImpossible` / `anyMissing` summarize `perTarget`.

### 5.4 Alternate-recipe caveat (documented, accepted for v1)

`deps` is the **union** of raw ancestors across all enabled recipes. With the
default base-recipe set, each item's path is effectively unique, so `deps` is
the true required set. With alternates enabled, `deps` may list raws that are
only needed by *one* alternative path (shown as ✗ even though another path
avoids them). Adding all ✗ raws is always *sufficient* to make the target
buildable, so the guidance is safe, just not minimal. Marking "required on every
path" vs "one of several alternatives" is deferred.

## 6. Integration — `js/ui/view-model.js`

`computePlan` gains a requirements step alongside the existing LP call (no
ordering dependency on the solver):

- Derive the target item ids: Maximize mode → `perPart.map(p => p.itemId)`;
  Target-rates mode → `Object.keys(req.targets)`.
- Build `availableRawIds` = `new Set([...caps].filter(([,c]) => c > 0).map(([id]) => id))`
  and `userAddedRawIds` = the subset with a **finite** cap > 0.
- Call `analyzeRequirements(...)`; shape a render-ready `requirements` object,
  adding `name` / `slug` / `fluid` per item (same shaping helpers already used
  for meters/perPart):

  ```
  requirements = {
    hasIssues: boolean,
    impossible: [ { itemId, name, slug, reason, deps: [{itemId,name,slug,added,fluid}] } ],
    missing:    [ { itemId, name, slug, reason, deps: [ … ] } ],
  }
  ```

- Add `hasProduction = recipeRates.size > 0` to the returned `PlanView`.
- Existing fields (`feasible`, `headline`, `shortfalls`, `perPart`, tiles, …)
  are unchanged. When `anyImpossible`, `headline` is set to a short
  "Can't build target" string; the callout carries the detail.

## 7. Rendering — `js/ui/render.js`

- New `renderRequirements(requirements)`:
  - One **red `.critical`** callout per impossible target:
    - `reason: 'wrong-resources'` → "**{name}** can't be made from the resources
      you've added. It requires: {deps ✓/✗}. Recheck your resources or target."
    - `reason: 'no-recipe'` → "No enabled recipe produces **{name}**. Try
      enabling the alternate recipe it needs."
  - One **amber `.warning`** callout per missing target: "To make **{name}** you
    need: {deps ✓/✗}." (`no-resources` reason omits the "still".)
  - `deps` render as small chips: ✓ added (muted) / ✗ missing (emphasized),
    with icon + name. All names via `textContent` (never `innerHTML`) — matches
    the existing XSS-safe pattern; reuses `.chip` / `.warning` / `.critical`,
    with a minimal new `.req-*` rule only if the ✓/✗ chips need it.
  - Rendered directly under the headline (before the existing shortfalls box).
- **Hide the empty plan:** when `!planView.hasProduction`, skip tiles, meters,
  build table, belts, diagram, and refinements (today they render as zeros /
  "No production required"). The headline + requirement callouts stand alone.
- When there *is* production (e.g. Target-rates mode with one good target and one
  impossible one), the plan renders as usual with the callouts on top.

## 8. Testing (TDD, `node --test`)

- **`test/engine/requirements.test.js`** (new), against `test/fixtures/mini-data.js`
  (disjoint branches: Iron Ore → Iron Ingot; Crude Oil → Plastic + Heavy Oil
  Residue):
  - Iron Ingot with `availableRawIds = {Iron Ore}` → `ok`.
  - Iron Ingot with `availableRawIds = {Crude Oil}`, `userAdded = {Crude Oil}` →
    `impossible`, reason `wrong-resources`, `deps = [{Iron Ore, added:false}]`
    (the crude-oil-can't-make-iron analog).
  - Iron Ingot with nothing added (`userAdded = {}`) → `missing`, reason
    `no-resources`, deps list Iron Ore ✗.
  - Plastic with `{Crude Oil}` → `ok`; Plastic with `{Iron Ore}` → `impossible`.
  - Target that is itself raw (Iron Ore): added → `ok`; not added → `missing`.
  - Alternate-recipe toggle: an item producible only via an alternate flips
    `impossible` (alt off) ↔ buildable (alt on) purely through
    `enabledRecipeIds`. (Extend `mini-data` with a small alternate recipe if the
    current fixture lacks one.)
  - `producibleClosure` cycle-safety: a two-recipe A↔B loop terminates and
    excludes both unless seeded.
- **`test/ui/view-model.test.js`** (extend):
  - `computePlan` returns the expected `requirements` shape + `hasProduction:
    false` for an impossible and for a missing scenario.
  - Existing feasible iron-chain cases still return `hasProduction: true` and an
    empty/`hasIssues:false` requirements object (no regression).
- `render.js` DOM output verified via the headless-Chrome screenshot pass (no
  jsdom in the suite), consistent with prior UI phases.
- Full `npm test` stays green (currently 65/65).

## 9. Files touched

| File | Change |
|---|---|
| `js/engine/requirements.js` | **new** — pure analysis module (§5) |
| `js/ui/view-model.js` | call `analyzeRequirements`, shape `requirements`, add `hasProduction` (§6) |
| `js/ui/render.js` | `renderRequirements`, hide-empty-plan gating (§7) |
| `js/ui/inputs.js` | vein hint line (§3); two-row target rows (§4.2) |
| `css/styles.css` | dropdown width (§4.1); target-row column + foot/label; optional `.req-*` chip rule |
| `test/engine/requirements.test.js` | **new** — unit tests (§8) |
| `test/ui/view-model.test.js` | extend for requirements + `hasProduction` (§8) |
| `test/fixtures/mini-data.js` | small alternate recipe if needed for the alt-toggle test |

## 10. Phasing

Single implementation plan, ordered so tests precede code:

1. `requirements.js` + `requirements.test.js` (pure, TDD).
2. `view-model.js` integration + extended view-model tests.
3. `render.js` callouts + hide-empty-plan; screenshot verification.
4. `inputs.js` + `styles.css` layout fixes (vein hint, dropdown, target rows);
   screenshot verification.
5. Full `npm test`, README/backlog note, local commit to `main`.

## 11. Out of scope / deferred

- Minimal dependency set under alternates (§5.4).
- Any LP/solver change or the unclamped raw-coefficient risk.
- Combobox ARIA/keyboard accessibility (already tracked in the base spec §21).
