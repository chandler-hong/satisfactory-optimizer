# Satisfactory Resource Optimizer — Design Spec

- **Date:** 2026-07-22
- **Status:** Approved design → pending spec review
- **Target game version:** Satisfactory v1.2
- **Repo:** `/Users/chong/Documents/GitHub/satisfactory-optimizer` (GitHub Pages, public)

## 1. Overview

A browser-based, static production planner for Satisfactory. The user specifies the
raw resources available to them (ore nodes by purity and miner tier, plus fluids), an
optional power-shard budget, and a belt/pipe tier. The tool computes **optimal factory
builds** in two modes — maximize a single target part, or hit specific target rates —
choosing the best recipes (including alternates) via **linear programming**, then
converts the optimal rates into a concrete build (machines, clocks, power, belts) and
spends the shard budget to **minimize building count**.

Hosted on GitHub Pages: zero build step, vanilla ES modules.

## 2. Goals / Non-goals

**Goals**
- Two optimization modes (max-one-part, target-rates) from day one.
- Full recipe coverage incl. alternates, from a vetted community dataset.
- Shard-budget-aware physical build (machines / clocks / power).
- Belt/pipe line counts + saturation flags per major flow.
- Friendly UI with machine/material icons.
- Early/mid/endgame part browsing.
- Deployable to GitHub Pages with no build pipeline.

**Non-goals (v1)**
- Somersloop production amplification (breaks the "clock doesn't change rates"
  assumption) — future.
- Full belt/pipe routing/layout or blueprint generation — counts only.
- Power *generation* planning (fuel/coal/nuclear) — report demand only.
- Save/load/share of plans, presets — future phase (URL-state is a stretch goal).
- Multiplayer/accounts/backend — none; fully client-side.

## 3. Primary use cases

1. "I have these iron/copper/etc. nodes — what's the max Modular Frames/min I can make,
   and how?" (**Mode A**)
2. "I need 30 Motors/min and 15 Heavy Modular Frames/min — is it feasible with my nodes,
   and what's the build?" (**Mode B**)
3. "Browse endgame parts and see what my current resources can support."

## 4. Tech stack & hosting

- Vanilla JavaScript ES modules; **no framework, no bundler, no build step**.
- One vendored LP solver library (`javascript-lp-solver`, MIT), committed under
  `js/vendor/`.
- Hand-written HTML/CSS; responsive, light/dark friendly.
- GitHub Pages, public repo, served from repo root (or `/docs`, decided at deploy).
  `.nojekyll` at publish root.
- Local dev: `python3 -m http.server` (ES modules + `fetch` require HTTP, not `file://`).

## 5. Data & assets

### 5.1 Recipe / item / building dataset
- Source: **greeny/SatisfactoryTools `data.json`** (the dataset behind
  satisfactorytools.com), served via **jsDelivr, pinned to a specific tag/commit**.
- Candidate URL (verify in first task):
  `https://cdn.jsdelivr.net/gh/greeny/SatisfactoryTools@<pinned>/data/data.json`.
- **First implementation task ("data adapter"):** verify URL + game version, document
  the source schema, and write `normalize(raw) → Dataset` with unit tests. Ship a
  trimmed **embedded fallback snapshot** so the app degrades gracefully if the CDN or
  schema changes.
- Caching: after first successful load, store the normalized dataset in `localStorage`
  keyed by version; load from cache on later visits; expose a "refresh data" action.

- **Fluids:** greeny's `data.json` stores fluid amounts already in **m³** (per-item units), NOT the raw ×1000 game value — the normalizer does **not** divide by 1000. (Verified 2026-07-22 by the Phase 1 real-data smoke; the initial "×1000" assumption in §Global Constraints of the Phase 1 plan was wrong and has been corrected in code.)

### 5.2 Icons
- **Hotlinked** from a community CDN (jsDelivr; SatisfactoryTools asset set or the
  Satisfactory wiki), mapped per item/building via its slug/className.
- Lazy-loaded (`loading="lazy"`), with an emoji/text fallback via `onerror` so a missing
  icon never breaks layout.
- Attribution + "fan-made, not affiliated with Coffee Stain Studios" note in the footer.
  Exact icon URL pattern locked in the data-adapter task alongside the dataset.

## 6. Domain model (internal, normalized)

JSDoc typedefs; **all rates are per-minute**.

- `Item { id, name, slug, iconUrl, phase }`  — `phase ∈ {early, mid, endgame}`
- `Building { id, name, basePowerMW }`
- `Recipe { id, name, buildingId, alternate:boolean,
    inputs:[{itemId, perMin}], outputs:[{itemId, perMin}] }`
  (`perMin` already normalized from amount ÷ craft time)
- `Dataset { items:Map, buildings:Map, recipes:Recipe[], rawResourceIds:Set }`
- Helper: `netPerMin(recipe, itemId) = output − input` for one machine @100%.

## 7. Resource model — `engine/resource-model.js` (pure)

Input: per-solid-resource `{impure, normal, pure}` node counts + miner tier; per-fluid
extractor/well config. Output: `caps: Map<resourceId, ratePerMin>`.

Reference tables (items/min @100%):

| Miner | Impure | Normal | Pure |
|-------|--------|--------|------|
| Mk.1  | 30     | 60     | 120  |
| Mk.2  | 60     | 120    | 240  |
| Mk.3  | 120    | 240    | 480  |

- Water Extractor: 120 m³/min. Oil Extractor: 60 / 120 / 240 (impure/normal/pure).
  Resource Well satellite nodes: 30 / 60 / 120 each by purity.
- Optional miner overclocking (×clock, ≤2.5) with belt-saturation note.
- All caps overridable by the user.

## 8. Optimizer — `engine/lp-builder.js` + `engine/solver.js` (pure)

**Decision variables:** `x_r ≥ 0` = number of machines running recipe *r* at 100%
(continuous). Only *enabled* recipes are included.

**Item flow:** `flow(i) = Σ_r x_r · netPerMin(r, i)`.

**Constraints**
- Raw caps: `Σ_r x_r · input(r, res) ≤ caps[res]` for each raw resource.
- Intermediate balance: `flow(i) ≥ 0` for every non-raw, non-target item (surplus
  allowed; unconsumed byproducts flagged; optional "no-waste" toggle forces `= 0`).

**Modes**
- **A — Max one part `t`:** maximize `flow(t)`. Two-pass **lexicographic**: (1) find max
  `M*`; (2) fix `flow(t) ≥ M*` and minimize Σ raw usage (avoids wasteful optima).
- **B — Target rates `{d_t}`:** `flow(t) + slack_t ≥ d_t`, `slack_t ≥ 0`; minimize
  `bigM·Σ slack_t + Σ(raw-usage weights)`. `slack_t > 0` ⇒ shortfall reported; also
  report which raw caps are **binding** (at 100%).

**Solver:** vendored `javascript-lp-solver`. Pure LP (continuous), ~O(300) vars — well
within range. Documented fallback to `glpk.js` (WASM) if scale/accuracy require.

## 9. Physical + shard layer — `engine/physical-layer.js` (pure)

Input: `recipeRates: Map<recipeId, x_r>`, dataset, `shardBudget`.

- Machines for recipe *r*: `floor(x_r)` @100% + one remainder machine underclocked to
  the fractional part.
- **Shard optimizer:** overclocking (1/2/3 shards → 150/200/250%) lets fewer machines
  carry `x_r`. Precompute each recipe's (machines, shards) trade-off curve; DP/greedy
  allocate the global budget to the moves that remove the most machines per shard.
  Output per recipe: machine count, clock plan, shards used, power.
- Power: `machinePower = basePowerMW · clock^1.321928`, summed.
- Report: total power, total shards used, buildings saved vs the no-shard baseline.

## 10. Belt / pipe layer — `engine/belt-layer.js` (pure)

Input: item flows (from the LP), belt tier, pipe tier.

- Belt caps (items/min): Mk1 60, Mk2 120, Mk3 270, Mk4 480, Mk5 780, Mk6 1200.
- Pipe caps (m³/min): Mk1 300, Mk2 600.
- Output per major flow: `{ item, ratePerMin, linesNeeded = ceil(rate/cap), saturated }`.
  Counts only; no routing.

## 11. UI / UX

Single page:
- **Inputs panel:** resource availability (solids: purity counts + miner tier; fluids),
  shard budget, belt/pipe tier, searchable alt-recipe toggle list (default all-on),
  no-waste toggle.
- **Mode switch:** Max part / Target rates.
- **Target selector:** searchable part picker with an early/mid/endgame browser (icons).
- **Results:**
  - Summary: achieved max or feasibility; total power; shards used; raw resources used
    vs available (bars).
  - Build table: per recipe → icon, building, count, clock, shards, power, in/out rates.
  - Belt/pipe report: lines per major flow + saturation flags.
  - Shortfalls (Mode B) + binding resources.
- Icons everywhere with text fallback. URL-state sharing is a phase-5 stretch.

## 12. Module architecture

```
index.html
css/styles.css
js/
  main.js                 // wiring
  data/loader.js          // fetch + cache + normalize
  domain/model.js         // typedefs + helpers
  engine/resource-model.js
  engine/lp-builder.js
  engine/solver.js
  engine/physical-layer.js
  engine/belt-layer.js
  ui/inputs.js
  ui/results.js
  ui/target-picker.js
  ui/icons.js
  vendor/solver.js        // javascript-lp-solver (MIT)
test/
  *.test.js               // node --test
docs/superpowers/specs/...
```

Engine modules are **pure** (no DOM), individually unit-testable. UI is the only DOM
layer.

## 13. Testing (TDD)

`node --test` on pure engine modules; **tests written first**. Known-answer anchors
(hand-computed):

- **resource-model:** 3 normal iron + Mk.2 → 360; pure → 720; 2 impure copper + Mk.1 → 60.
- **LP Mode A** (caps iron=360, standard recipes): max Modular Frame = **15/min**;
  max Rotor = **32/min**.
- **LP Mode B:** 16 Rotors + 7.5 Modular Frames → uses exactly **360** iron (feasible at
  cap 360, shortfall at 359).
- **physical-layer:** 16 Rotors/min, 0 shards → known machine counts; with a shard budget
  → fewer buildings, correct power via the exponent.
- **belt-layer:** 360/min → 3 lines on Mk.2, 1 line on Mk.4.

Spot-check a handful of full-plan outputs against satisfactorytools.com.

## 14. Deployment (GitHub Pages)

- Public repo; enable Pages on `main` (root) or `/docs`. `.nojekyll` at publish root.
- All runtime fetches are HTTPS (dataset + icons via jsDelivr) → no mixed-content/CORS.
- No Actions / build. Push = deploy.

## 15. Risks & mitigations

| Risk | Mitigation |
|------|------------|
| Dataset schema/version drift | Pin to commit; normalization adapter w/ tests; embedded fallback snapshot; "refresh data" + version display |
| LP degeneracy / wasteful optima | Lexicographic secondary objective |
| Solver performance / edge cases | Small pure LP; documented glpk.js fallback |
| Icon availability + licensing | CDN hotlink w/ fallback; attribution + fan-content disclaimer; vendoring as fallback |
| Byproduct handling (e.g. heavy oil residue) | Balance ≥0 with surplus flags + optional no-waste constraint |
| Fluid modeling nuances (wells/packaging) | Start with extractor/well caps; refine iteratively |

## 16. Phasing / milestones

1. **Data adapter + resource model** (tested) — lock dataset/icon URLs + version;
   normalize; caps.
2. **LP engine, both modes** (tested) — builder + solver + secondary objective +
   infeasibility.
3. **Physical/shard + belt layers** (tested).
4. **UI** — inputs, target picker + phase browser, results, icons.
5. **Pages deploy + polish** — caching, refresh, attribution, URL state (stretch).

## 17. Open questions

- Publish source: repo root vs `/docs` (decide at phase 5; no impact before then).
- Exact pinned dataset commit + icon URL pattern (locked in phase 1, data adapter).

## 18. Deferred from Phase 1 (tracked backlog)

Surfaced by the Phase 1 final review; deliberately deferred (not lost):

- **Embedded fallback dataset snapshot** (from §5.1): not built in Phase 1. Low
  risk today — the dataset is pinned to an immutable commit (jsDelivr caches
  pinned commits durably; schema cannot drift on a fixed commit) and there is no
  UI consumer until Phase 4. Revisit before public launch / when a live loader
  consumer exists.
- **resource-model input validation** (Phase 4, when config is UI-driven): throw
  on an unrecognized `kind` (currently returns 0); validate `minerTier` with a
  helpful message (currently a raw TypeError on e.g. `'Mk4'`); clamp `clock` to
  the ≤2.5 overclock ceiling (§7).
- **loader tidy:** move `normalize()` out of the corrupt-cache `catch` so a real
  `normalize()` bug can't be misread as a corrupt cache (low priority).
- **Phase 3 power note:** `basePowerMW` is 0 for variable-power buildings (e.g.
  Particle Accelerator) — their power lives on the recipe
  (`isVariablePower`/`minPower`/`maxPower`). Handle in the Phase 3 power layer.

## 19. Deferred from Phase 2 (tracked backlog)

Phase 2 (LP engine) final review: ready to merge, no Critical/Important. Cheap
follow-ups to fold in (ideally before Phase 4 wires these into the UI):

- **Consume `bounded` in `maxOutput`:** return `feasible:false` when the LP objective
  is unbounded, rather than reporting a bogus `maxRate`. Unreachable today (every chain
  roots in a capped raw; the real-data smoke returns a finite 15), so add it with a test
  when Phase 4 can exercise it.
- **Guard raw-resource targets in `buildTargetRatesModel`:** a target id that is a raw
  resource currently clobbers its `{max:cap}` with `{min:d}`. Reject it or document the
  precondition (Mode B targets parts, never raws).
- **`hitTargets` contract note:** an infeasible solve can return `feasible:false` with an
  empty `shortfalls` map — Phase 4 must not assume `!feasible ⇒ non-empty shortfalls`.
- **Edge-case tests** (cheap, high value for a math engine): targets-as-Map form, `noWaste`
  at the optimize layer, "item both input+output", "target that is also an intermediate".
- **Polish:** JSDoc on the lp-builder exports; comment the `bindingResources` `cap>0`
  guard; have `buildMaxModel` reuse a by-id map instead of `.find` (O(n²)); the vendored
  solver's dangling `sourceMappingURL` (harmless devtools 404).
- **Before public launch (Phase 5):** bundle the vendored solver's MIT license text
  (README records it; MIT wants the notice included in copies).

## 20. Deferred from Phase 3 (tracked backlog)

Phase 3 (physical/shard + belt) final review: ready to merge, no Critical. The one
Important is an explicit re-deferral (below), not a silent drop.

- **Variable-power buildings (re-deferred from §18):** `realize` computes power as
  `machines × basePowerMW × clock^exp`, but Particle Accelerator / Quantum Encoder /
  Converter etc. carry power on the recipe (`isVariablePower`/`minPower`/`maxPower`), not
  `basePowerMW` — so their power is currently **under-reported** (a `TODO` marks the spot
  in `physical-layer.js`). Proper fix: carry recipe variable-power through `normalize` +
  the `Recipe` typedef and report a min/max power **range**. Do before Phase 4 surfaces
  accurate power totals.
- **`realize` contract polish:** report "buildings saved vs the no-shard baseline" (today
  Phase 4 must call `realize` twice to show shards' benefit); document/normalize
  `perRecipe` ordering (currently reverse of `recipeRates` insertion order — Phase 4
  should sort for display).
- **Minor:** reconsider `saturated` (currently equals `lines > 1`); add tests for
  `realize`'s load≤0 / missing-building fallbacks; de-dup `EPS`/`round6`/
  `DEFAULT_POWER_EXPONENT` into a shared helper.
- **Done this phase (noted for completeness):** non-integer/NaN shard budget is floored;
  unknown belt/pipe tier now throws.

## 21. Deferred from Phase 4 (tracked backlog)

Phase 4 (browser UI) shipped: sidebar inputs + live results (stat tiles, resource meters,
build table, belt report) with icons, both modes, dark/light, responsive — rendering
verified via a headless screenshot. Deferred:

- **Fluid resources in the resource picker:** the picker is solids/miner-only today, so
  targets needing water/oil/etc. compute as infeasible. Add fluid resource inputs (the
  oil/water/well kinds — `capsFromInputs` already supports them).
- **Icons before public launch:** currently hotlinked from satisfactorytools.com (their
  bandwidth, and fragile if paths move). Vendor the icon set or use a proper image CDN.
- **Early/mid/endgame target catalog:** group the target picker by game phase (needs the
  schematics→tier data-layer extension deferred in Phase 4 planning).
- **Accessibility:** the hand-rolled searchable combobox lacks ARIA roles + keyboard-arrow
  navigation; the target dropdown caps at 50 matches; a manual rate override doesn't visually
  disable the count fields it supersedes.
- **URL-state sharing**; **variable-power accurate power** (carried from §20).
