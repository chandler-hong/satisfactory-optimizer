# Factory Expansion Mode — Design Spec

Date: 2026-08-03
Status: Awaiting user review
Depends on: `2026-07-22-satisfactory-optimizer-design.md` (base architecture, view tabs,
icon + theming conventions), `2026-07-23-resource-requirements-diagnostics-design.md`
(`analyzeRequirements`), `2026-07-31-codex-recipe-reference-design.md` (pure-module /
DOM-module split, `localStorage` state convention)

## 1. Overview

A fourth top-level view — **🧱 Expansion** — alongside Factory Optimizer, Power
Generation, and Codex.

The Factory Optimizer answers *"given these ore nodes, what's the most I can
make?"*. That framing forces you to model your whole factory from the ore up
every time you want to bolt something onto it. Expansion answers the question an
established save actually asks: *"I've decided to build 6 Assemblers on Motors and
8 on Smart Plating, and I already have 300 Rubber/min on the bus — what do I need
to add upstream?"*

You declare what you want at whatever tier you happen to be thinking at, declare
what you already have coming in, and the view reports the machines to build.

```
┌─ WANT (build this) ─────────────┐  ┌─ TO BUILD ───────────────────────────┐
│ [ 6]× Assembler  Motor   [100]% │  │  38 machines · 1,204 MW · 0 shards   │
│ [ 8]× Assembler  Smart P.[100]% │  │  12× Constructor   Iron Rod          │
│ [45]/min         Rubber         │  │   8× Constructor   Steel Pipe        │
│                        [+ row]  │  │   6× Assembler     Stator            │
├─ HAVE (already supplied) ───────┤  │   6× Constructor   Rotor             │
│ [300]/min        Rubber         │  │   4× Refinery      Residual Rubber   │
│ [480]/min        Iron Ore       │  │  …                                   │
│                        [+ row]  │  ├─ TOTALS ─────────────────────────────┤
├─ GOALS ─────────────────────────┤  │  26× Constructor · 6× Assembler ·    │
│ ☑ T5 · Petroleum Power          │  │   4× Refinery · 2× Manufacturer      │
│ ☑ Phase 2 · Construction Dock   │  ├─ SUPPLY USED ────────────────────────┤
│              fill in [10] min   │  │  Rubber    260 of 300/min            │
└─────────────────────────────────┘  ├─ RAW NEEDED (uncapped) ──────────────┤
                                     │  Iron Ore 720/min, 480 supplied      │
                                     │      → 240 new = 2× Mk.2 normal      │
                                     │  Copper   180/min                    │
                                     │      → 180 new = 2× Mk.2 normal      │
                                     └──────────────────────────────────────┘
```

Note that the `Iron Ore` HAVE row is netted off in the raw footer rather than
appearing under SUPPLY USED — raws take a different path through the plan for the
reason given in §3.3.

It reuses the already-loaded dataset and the existing LP engine, physical layer,
belt layer, and requirements analysis. The only engine change is one additive
primitive in `lp-builder.js` (§5.2).

## 2. Goals / Non-goals

**Goals**
- Declare production as **machine counts on a recipe** (`6× Assembler → Motor`), not
  only as rates — that's how players actually think about a build.
- Declare existing supply (`Rubber @ 300/min`) so the explosion stops there instead
  of walking down to ore.
- Report the upstream machines to build, per recipe and per machine type, in whole
  machines.
- Credit block byproducts and block-to-block feeding automatically.
- Report ore/min at the bottom with miner counts, so you can see whether an
  expansion needs a new node before committing to it.
- Cross-reference against milestone and Space Elevator phase costs in both
  directions: what your plan already covers, ETA for the rest, and a one-click
  path from a goal's shortfall into WANT rows.
- Keep all derivation pure and unit-tested; keep the DOM layer dumb.

**Non-goals**
- No ore caps and no node/purity/overclock planning for raws — that's the
  Optimizer tab. Raws here are uncapped and reported, not budgeted.
- No MAM research goals (§7.1 explains why).
- No power-plant sizing for the added draw — the view reports added MW; the Power
  tab sizes generators.
- No URL sharing / deep links (existing whole-app backlog item).
- No changes to the Optimizer, Power, or Codex views' behaviour. The only shared
  code that moves is `buildGraph` (§8), and it moves without behaviour change.

## 3. Input model

Three row kinds. All are optional; the view renders an empty-state hint until
there is at least one WANT row.

### 3.1 Block row — `{ kind: 'block', recipeId, machines, clock }`

A recipe picker (reusing the existing combobox pattern from `js/ui/inputs.js`), a
machine count, and a clock percentage defaulting to 100. The machine *type* is
derived from `recipe.buildingId` and displayed, never chosen — picking "Motor"
already determines "Assembler".

Clock is included because overclocked blocks are common and the cost is one
multiplication: the block's machine-equivalent load is `machines × clock`.

### 3.2 Want-rate row — `{ kind: 'want', itemId, rate }`

A flat `rate`/min of an item, for demand that isn't naturally a machine count
(`Rubber @ 45/min`), and the shape the Goals panel writes into (§7.3).

### 3.3 Have row — `{ kind: 'have', itemId, rate }`

`rate`/min of an item already available. Stops the explosion at that item — up to
`rate`. Beyond `rate`, the overflow is built normally and flagged (§5.2, §6.2–6.8).

**A HAVE row naming a raw resource behaves differently.** Raws are already
unbounded here (§5.3), so a supply variable for one would change nothing except to
double-report it: the supply panel would say `Iron Ore 480 of 480 ⚠ capped` while
the raw footer simultaneously said `Iron Ore 720/min`. Instead, a raw HAVE row is
excluded from the LP entirely and subtracted in the raw footer, which is the
question actually being asked — *how much new extraction do I need?*

```
Iron Ore  720/min needed · 480/min already supplied
          → 240/min new = 2× Mk.2 normal
```

Raw HAVE rows therefore never appear in `supplyUsage`; they appear only as the
`supplied` term in `rawNeeded` (§5.4).

### 3.4 State

Persisted to `localStorage` under `sat-optimizer:expansion:v1` as
`{ rows: Row[], goals: string[], fillMinutes: number }`, wrapped in the same
try/catch the Power and Codex views use. A malformed or partial payload degrades
to defaults rather than throwing; unknown `kind` values are dropped on load.

## 4. Pure module — `js/engine/expansion.js` (new)

```js
planExpansion({
  dataset, rows, enabledRecipeIds,
  shardBudget = 0, beltTier = 'Mk4', pipeTier = 'Mk2',
}) -> ExpansionPlan
```

No DOM, no `localStorage`, deterministic. Returns a render-ready shape (§6).

## 5. How the plan is computed

### 5.1 Pin the blocks, then split by sign

Blocks are **pinned** production — the user has already decided them — not
something to solve for. Compute the net per-minute balance across every block row:

```
netPinned[itemId] = Σ over block rows  (machines × clock) × netPerMin(recipe, itemId)
```

`netPerMin` is the existing helper in `js/domain/model.js`. Split the result by
sign, and note both sides land on the same mechanism:

| Sign | Meaning | Becomes |
|---|---|---|
| negative, non-raw | blocks consume it | a **target** for the residual solve |
| negative, **raw** | blocks consume ore directly | added straight to `rawNeeded` (§5.4) |
| positive | blocks produce it (incl. byproducts) | a **free capped supply** |
| zero | perfectly internally balanced | nothing |

The raw case matters: a block that eats ore directly (a Smelter on Iron Ingot) has
no upstream to build, so routing it through the LP as a target would be wrong —
`hitTargets` would report it as satisfied by the ore constraint and it would then be
missing from the raw footer entirely. It bypasses the LP and is summed with the LP's
own raw draw in `rawNeeded`.

This makes block-to-block feeding fall out of the arithmetic rather than needing
its own pass: `6× Constructor → Rotor` alongside `6× Assembler → Motor` nets Rotor
to zero, and over- or under-supply is handled by the same sign rule. Block
byproducts (e.g. the Polymer Resin off a fuel block) become supply, so the
upstream never rebuilds what the blocks already emit.

WANT-rate rows are added to the target set. Non-raw HAVE rows are added to the
supply set (raw HAVE rows: see §3.3).

### 5.2 The one engine addition — supply variables

`js/engine/lp-builder.js` gains an optional `supplies` argument on
`buildTargetRatesModel`, and `hitTargets` in `js/engine/optimize.js` threads it
through. It is a list, not a map, because the two supply *kinds* must stay
distinguishable:

```js
supplies = [{ itemId, rate, kind: 'pinned' | 'have' }]
```

For each entry, keyed by both item and kind so the two never collide:

```js
const key = `_supply_${kind}_${itemId}`;
variables[key] = { [itemId]: 1, [RAWCOST]: cost, [`_supcap_${kind}_${itemId}`]: 1 };
constraints[`_supcap_${kind}_${itemId}`] = { max: rate };
```

A near-zero `RAWCOST` coefficient means the minimiser always drains free supply
before building anything. The `max` cap means demand beyond `rate` spills into real
machines instead of silently vanishing.

`cost` is `1e-9` for `pinned` and `1e-6` for `have`. The ordering makes the solver
consume what your own blocks already emit before pulling from the bus, which is both
the physically sensible order and the one that keeps `supplyUsage` honest. Both are
≥9 orders of magnitude below the `1e6` slack penalty and far below any real raw
cost, so neither can change feasibility or machine counts — only the attribution
between two otherwise identical sources.

**Both costs must be strictly positive.** A cost of exactly `0` leaves the draw
degenerate: pulling the full cap and wasting the excess is feasible at an identical
objective value, so the solver may report `used` as the whole supply regardless of
what was actually consumed, corrupting both `supplyUsage` and `netOutput`. A
strictly positive cost makes the draw exactly the amount consumed. Verified: with
`have` supply 300 against demand 120, `used` is 120, not 300; and an unused `pinned`
supply reports 0, not its cap.

**Why the kinds must stay separate.** A single merged supply variable per item
would make §6's `netOutput` unrecoverable: with `netPinned = +320` Smart Plating and
a HAVE row of 300, a merged draw of 260 gives no way to tell how much came from the
blocks' own surplus (which is expansion output that did *not* leave) and how much
came from the bus (which was never expansion output at all).

**Why not a pseudo-raw.** Adding the item to `rawResourceIds` with `cap = rate` is
the obvious move and is wrong: it hard-caps the item, so demand above the supply
surfaces as a phantom shortfall via the slack variable instead of building the
extra 100/min. The supply variable leaves the item's own recipes enabled and merely
makes the first `rate`/min effectively free.

Existing callers pass no `supplies` and get an identical model — the argument
defaults to `[]` and the loop is a no-op.

### 5.3 Solve, then realize

1. True raw resources get an unbounded cap. `rawConstraints` already clamps a
   non-finite cap to `1e9`, so `caps` is built as `Infinity` for every raw the
   enabled recipes touch. No user-facing cap fields exist in this view.
2. `hitTargets({ dataset, caps, enabledRecipeIds, targets, supplies })` → the
   upstream `recipeRates`. Its slack variables surface any genuinely unreachable
   target as a shortfall.
3. `realize({ dataset, recipeRates, shardBudget })` → whole machines, clocks,
   shards, power for the **upstream only**.
4. `beltReport({ dataset, recipeRates, beltTier, pipeTier })` for the upstream
   flows.
5. `analyzeRequirements(...)` over the target items for the "no recipe path"
   diagnostic callout, reusing the existing shaping from `view-model.js`.

Block rows are *not* passed through `realize` — the user declared their machine
counts, so re-deriving them would be both redundant and capable of disagreeing
with what was typed. Blocks are echoed as declared, via `blockRows` (§6).

### 5.4 Raw footer

For each raw with non-zero usage, report `needed`, `supplied` (from any raw HAVE
row, §3.3), and `newRate = max(0, needed - supplied)`, plus the extractor count
needed to cover `newRate`.

`needed` is the sum of two sources: the LP's own raw draw (computed exactly as
`rawUsage` in `view-model.js` already does) **plus** any negative raw `netPinned`
from blocks that consume ore directly (§5.1).

Rates come from the existing constants in `js/engine/resource-model.js`
(`MINER_RATES`, `OIL_EXTRACTOR_RATES`, `WELL_SATELLITE_RATES`,
`WATER_EXTRACTOR_RATE`) rather than being re-derived from `dataset.miners` — the
dataset's miner entries use the raw ×1000 fluid convention and would need unpicking
for no benefit.

Solids report `Math.ceil(newRate / MINER_RATES[tier][purity])` for Mk.1/2/3 on
normal and pure. Water reports Water Extractors. Crude Oil reports Oil Extractors;
Nitrogen Gas reports Well Satellites. A raw fully covered by a HAVE row reports
`newRate === 0` and shows no extractor line.

## 6. Output shape

`ExpansionPlan`:

| Field | Contents |
|---|---|
| `tiles` | `{ machines, powerMW, shards }` for the upstream build |
| `buildRows` | per-recipe: `machines`, `recipeName`, `buildingName`/`Slug`, `itemName`/`Slug`, `clockPct`, `shards`, `powerMW` — sorted by `machines` desc |
| `machineTotals` | per building type, sorted desc |
| `blockRows` | the declared blocks, echoed with derived building + net output |
| `netOutput` | per item, what actually leaves the expansion (§6.1) |
| `supplyUsage` | per **declared** (HAVE) non-raw supply: `itemId`, `kind`, `rate`, `used`, `capped`. A block's own `pinned` byproduct surplus is excluded — it isn't something the user declared, and `netOutput` already reports it in full. |
| `rawNeeded` | per raw: `needed`, `supplied`, `newRate` + extractor options |
| `beltRows` | reuses the existing `beltReport` row shape |
| `requirements` | reuses the existing diagnostics shape |
| `shortfalls` | unreachable targets from the LP slack |
| `graph` | tiered flow graph — added by task 8 only; absent (and the diagram unrendered) until then |
| `goals` | §7 |

`buildRows`, `machineTotals`, `beltRows`, and `requirements` deliberately reuse the
field names `js/ui/render.js` already renders, so the row-building helpers can be
shared rather than reimplemented.

### 6.1 `netOutput`, defined exactly

`netOutput` drives the Goals panel's ETA maths (§7.2), so an approximate definition
here becomes a wrong number there. Per item:

```
netOutput[item] = netPinned[item]                  // blocks' own net (§5.1)
                + netFromLPRecipes[item]            // upstream machines' net, inputs included
                + drawn['have'][item]               // bus supply pulled in from outside
```

`netFromLPRecipes` sums `netPerMin` over every running recipe, so an upstream
machine's *consumption* of a block's surplus is already counted there.

**`drawn['pinned']` must not be subtracted.** It is tempting — the block surplus did
get eaten — but it double-counts: the eating already appears as a negative term in
`netFromLPRecipes`. Concretely, with blocks netting +130 Rod and new Screw machines
consuming 30 Rod, the correct answer is `130 - 30 = 100` Rod leaving; subtracting the
30 drawn as well gives 70.

`drawn['have']` *is* added, because bus supply is an inflow from outside the
expansion that `netPinned` and `netFromLPRecipes` know nothing about.

Worked examples, all verified against the solver:

| Case | Result |
|---|---|
| 2 blocks on Reinforced Plate, nothing else | `rip: 10` leaves |
| Blocks net +130 Rod; new Screw machines eat 30 | `rod: 100` leaves |
| Blocks net +60 Screw **and** a WANT row of 200 Screw | `screw: 200` leaves — the surplus counts toward the want rather than being deducted from it |
| HAVE Screw 300, demand 120 | nothing leaves; `used` is 120, not 300 |

Items with `netOutput <= 1e-6` are omitted from the panel.

### 6.2–6.8 Panel order

Tiles → **To build** table → machine-type totals → your blocks → net output →
supply used → raw needed → belts/pipes. The requirements callout renders above the
tiles when it has issues, matching the Optimizer's placement.

`supplyUsage` rows show `used of rate/min`, with a warning chip when
`used >= rate - 1e-6` **and** the plan also built machines for that item — the
signal that the declared supply ran out and the overflow is being manufactured.

## 7. Goals panel — `js/domain/goals.js` (new)

```js
buildGoalCatalog(dataset) -> Goal[]
evaluateGoals(catalog, selectedIds, netRates, fillMinutes) -> GoalView[]
```

Pure, no DOM, no engine imports — same shape as `js/domain/codex.js`.

### 7.1 Catalog sources

**HUB milestones (42)** come straight from the dataset. Measured against the
pinned commit: 42 `EST_Milestone` schematics spanning tiers 1–9, and every one of
their `cost` item ids resolves to a real item. They need §9's data-layer change to
survive normalization.

**Space Elevator phases (5)** are hand-authored. They are *not* in the dataset —
`Recipe_SpaceElevator_C` carries only the elevator building's own construction
cost (500 Concrete, 250 Iron Plate, 400 Iron Rod, 1500 Wire), and no schematic's
`cost` references any `Desc_SpaceElevatorPart_*`. Verified against
`satisfactory.wiki.gg/wiki/Space_Elevator` and `/wiki/Project_Assembly`, which
agree; both describe Satisfactory 1.0, matching the pinned dataset. The table
carries a source comment and these initial (not cumulative) per-phase costs:

| Phase | Name | Cost |
|---|---|---|
| 1 | Distribution Platform | 50 Smart Plating |
| 2 | Construction Dock | 1,000 Smart Plating · 1,000 Versatile Framework · 100 Automated Wiring |
| 3 | Main Body | 2,500 Versatile Framework · 500 Modular Engine · 100 Adaptive Control Unit |
| 4 | Propulsion | 500 Assembly Director System · 500 Magnetic Field Generator · 250 Thermal Propulsion Rocket · 100 Nuclear Pasta |
| 5 | Assembly | 1,000 Nuclear Pasta · 1,000 Biochemical Sculptor · 256 AI Expansion Server · 200 Ballistic Warp Drive |

Item ids, all confirmed present: Smart Plating `Desc_SpaceElevatorPart_1_C`,
Versatile Framework `_2_`, Automated Wiring `_3_`, Modular Engine `_4_`, Adaptive
Control Unit `_5_`, Magnetic Field Generator `_6_`, Assembly Director System `_7_`,
Thermal Propulsion Rocket `_8_`, Nuclear Pasta `_9_`, Biochemical Sculptor `_10_`,
Ballistic Warp Drive `_11_`, AI Expansion Server `_12_`.

An id in the hardcoded table that is missing from `dataset.items` after a dataset
bump is dropped with a `console.warn`, not thrown — one renamed part must not take
the panel down.

**MAM research (97) is excluded.** Its `cost` entries are research inputs (e.g. 10
Sulfur to unlock a scanner resource), which answers a different question from
"what parts do I need to build". Including it would trade a focused panel for 139
mostly-irrelevant rows.

### 7.2 Evaluation

For each part of each selected goal:

- `netRate` = that item's net rate leaving the plan (from `netOutput`).
- `covered` = `netRate > 1e-6`.
- `etaMinutes` = `amount / netRate`, or `null` when not covered.

Goal ETA is the **max** across its parts — the slowest part gates delivery, so a
sum or an average would both understate it. Goals with no covered part show "not
produced" rather than an ETA.

Goals are ordered milestones-by-tier then phases, and the catalog is built once at
view construction.

### 7.3 Goal → WANT rows

`Add shortfall as WANT rows` converts each uncovered part into a want-rate row.
A milestone cost is a **stock** (200 Reinforced Iron Plate) and a WANT row is a
**flow** (/min), so the conversion needs an explicit horizon: a `fill in [N] min`
field, default 10. The row's rate is `ceil(amount / N * 100) / 100`.

Only uncovered parts are added, and the button's label states the count so the
action is never a surprise.

## 8. Refactors

### 8.1 Extract `createSearchSelect` (required, not optional)

Both new row types need a picker over a few hundred options — 300+ machine recipes
for block rows, 175 items for want/have rows. A plain `<select>` at that size is
unusable, and the searchable combobox that solves it already exists as
`createSearchSelect` in `js/ui/inputs.js:78-222` — but as a module-private
function.

It moves verbatim to `js/ui/search-select.js` and is imported by both `inputs.js`
and `expansion.js`. This is the same extraction the icon helper already went
through in `aa006a9`, and it is a **prerequisite** for the view task, not a
nice-to-have: the alternative is duplicating ~145 lines of focus/blur/mousedown
sequencing that took care to get right.

`iconUrl` (already exported from `js/ui/icons.js`) is the only import it needs.

### 8.2 Extract `buildGraph` (optional)

`buildGraph` is ~105 of `js/ui/view-model.js`'s 345 lines, is already pure, and is
exactly what a diagram for this view needs. It moves verbatim to
`js/engine/graph.js` and is imported by both `view-model.js` and `expansion.js`,
with the existing `renderDiagram` in `js/ui/diagram.js` consuming the same shape
unchanged.

This is a move, not a rewrite: no behaviour change, and the existing Optimizer
tests are the regression net. Sequenced last (§11) so it can be dropped without
blocking any other task.

## 9. Data layer — `js/data/normalize.js` (additive only)

`normalize` currently discards every schematic field except those feeding
`recipeUnlocks`. It gains `dataset.goals`:

```js
{ id, name, tier, cost: [{ itemId, amount }], timeSec }
```

for `EST_Milestone` schematics only, with the same defensive coercion the recent
`name`/`type` fix established: `name` and `tier` coerced, `cost` entries with a
non-string `item` or a non-finite `amount` dropped, a schematic left out entirely
if its cost list ends up empty. `recipeUnlocks` and every existing field are
untouched, so no existing consumer changes.

`js/domain/model.js` typedefs gain a `Goal` entry and a `goals` field on `Dataset`.

## 10. Wiring

- **`index.html`** — `#tab-expansion` button (`🧱 Expansion`) after `#tab-codex`,
  and a `<div class="expansion-view" id="view-expansion" hidden>`.
- **`js/main.js`** — one entry in the `VIEWS` map and one
  `buildSecondaryView(dataset, 'view-expansion', 'Expansion', buildExpansion)`
  call. The table-driven `showView` and the existing per-view failure isolation
  mean a throw inside the Expansion view degrades to a message in its own pane and
  leaves the Optimizer working.
- **`css/styles.css`** — an appended `.exp*` block using the existing
  `--accent`/`--surface`/`--border`/`--ink`/`--ink-2` tokens. Reuses `.hint`,
  `.icon`, and the tile/table classes. Any rule overriding `.icon` size must use
  the `:is(.icon, .icon-fallback)` form the icon cleanup established, so a failed
  image load keeps row layout. Inputs keep the 44px minimum tap target.

## 11. Phasing (one commit per task, TDD)

| # | Task | Files |
|---|---|---|
| 1 | `dataset.goals` + typedefs | `normalize.js`, `model.js`, `normalize.test.js` |
| 2 | `supplies` in the target-rates model, threaded through `hitTargets` | `lp-builder.js`, `optimize.js`, `lp-builder.test.js`, `optimize.test.js` |
| 3 | `planExpansion` — pin/split/solve/realize, incl. `netOutput` (§6.1) | `engine/expansion.js`, `expansion.test.js` |
| 4 | Raw footer: `needed`/`supplied`/`newRate` + extractor options | `engine/expansion.js`, `expansion.test.js` |
| 5 | Goal catalog + evaluation | `domain/goals.js`, `goals.test.js` |
| 6 | Extract `createSearchSelect` (§8.1) | `ui/search-select.js`, `inputs.js` |
| 7 | The view | `ui/expansion.js`, `index.html`, `main.js`, `styles.css` |
| 8 | Goals panel + `Add shortfall` wiring | `ui/expansion.js` |
| 9 | Extract `buildGraph`, add the diagram (§8.2, droppable) | `engine/graph.js`, `view-model.js`, `ui/expansion.js` |

## 12. Testing (TDD, `node --test`)

`test/engine/expansion.test.js`, `test/domain/goals.test.js`, plus extensions to
`test/data/normalize.test.js` and `test/engine/lp-builder.test.js`.

`test/fixtures/mini-data.js` **must not** be modified (`normalize.test.js` asserts
`recipes.length === 2`), so goals get `test/fixtures/goal-data.js`, following the
precedent set by `codex-data.js`.

Anchor cases:

1. One block explodes to the right upstream demand (hand-checked against the
   iron-chain fixture).
2. Block A feeds block B → zero residual demand for the intermediate, no upstream
   machines for it.
3. Block A *partly* feeds block B → upstream covers exactly the deficit.
4. A block byproduct is credited, reducing upstream machines for that item.
5. A HAVE row fully covering demand → zero upstream machines for that item.
6. A HAVE row partly covering demand → overflow machines built, `capped` flagged.
7. A HAVE row larger than demand → `used < rate`, not flagged.
8. A **raw** HAVE row never appears in `supplyUsage`, and reduces `rawNeeded`
   `newRate` by its rate (§3.3); a raw HAVE row exceeding demand gives
   `newRate === 0` and no extractor line.
9. Clock scaling: `4 machines @ 150%` demands the same as `6 @ 100%`.
9b. A block consuming a **raw** directly contributes to `rawNeeded` and produces no
    LP target and no upstream machines (§5.1).
10. Unreachable target surfaces as a shortfall, not a throw.
11. Raw footer extractor counts for a solid, for water, and for oil.
12. `netOutput` per §6.1's four worked cases, including the two that catch the
    double-count: a block surplus partly eaten upstream reports only the remainder
    (130 − 30 = 100, not 70), and a block surplus under a larger WANT row counts
    toward it (200, not 140).
12b. A `have` supply larger than demand reports `used` equal to demand, not to its
    cap; an unused `pinned` supply reports `used === 0`. (Guards the zero-cost
    degeneracy in §5.2.)
13. Goal ETA = max across parts; uncovered part → `etaMinutes === null`.
14. `Add shortfall` rate conversion honours `fillMinutes`.
15. Existing callers of `buildTargetRatesModel` without `supplies` produce a
    byte-identical model.
16. A hardcoded phase part id missing from `dataset.items` is dropped, not thrown.
17. Malformed persisted state (unknown `kind`, non-numeric rate) degrades to
    defaults rather than throwing (§3.4).

## 13. Out of scope / deferred

- Ore caps, node purity, and miner overclocking as *inputs* (Optimizer's job).
- MAM research goals (§7.1).
- Sizing generators for the added power draw (Power view's job).
- Cumulative phase totals — the panel shows each phase's own cost, not the
  "1,625 Modular Engines overall" roll-up, which depends on a chosen build order.
- Marking a block as "already built" vs "planned" — every block is treated as
  decided, and the upstream is what gets reported as to-build.
- URL state / deep links (existing whole-app backlog item).
- Variable-power buildings still under-report power (existing `physical-layer.js`
  limitation, inherited unchanged).

### 13.1 Raised by the final review, deliberately not built

- **An alternates picker for this view.** The LP here solves with every alternate
  unlocked, which can prescribe a recipe the player doesn't have. Shipped with a
  disclosure hint instead; a real picker (per-alternate enable/disable, mirroring
  the Optimizer sidebar, or reading the Optimizer's own enabled set) is a feature,
  not a patch.
- **Shard-budget, belt-tier and pipe-tier controls for this view.** `planExpansion`
  is called without them, so the engine defaults hold permanently: the SHARDS tile
  and the To-build table's Shards column are always 0, and belt line counts always
  assume Mk4 regardless of what the Optimizer sidebar is set to. Spec-consistent,
  but the belt counts are quietly wrong for a Mk1 or Mk6 player.
- **Direct test coverage for the render layer.** There is no DOM shim anywhere in
  the suite, so every `js/ui/**` test exercises only pure exports. That means
  `renderPlan`, `renderResults` and `recompute` have no direct coverage, and a
  deletion inside them can pass CI — which is how the final review found two fixes
  that were reintroducible while green. A minimal hand-rolled `document` shim (the
  repo takes no dependencies) would pin all three, and is the single highest-value
  test investment left.
