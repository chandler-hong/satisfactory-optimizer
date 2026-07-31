# Codex — In-Game-Style Recipe Reference — Design Spec

Date: 2026-07-31
Status: Awaiting user review
Depends on: `2026-07-22-satisfactory-optimizer-design.md` (base architecture, view tabs,
icon + theming conventions)

## 1. Overview

A third top-level view — **📖 Codex** — alongside Factory Optimizer and Power
Generation. It is a browsable, searchable reference for every item in the game:
what it is, how it's made, what it's used for, and how the recipe is unlocked.
It answers the questions the optimizer doesn't: *"what does Heavy Modular Frame
actually need?"*, *"what can I do with Polymer Resin?"*, *"which tier gives me
Steel Screws?"*

Layout is two-pane, like the in-game Codex: an alphabetical, searchable item list
on the left; the selected item's entry on the right.

```
┌─ Search items… ──┐  ┌─────────────────────────────────────────────┐
│ ▸ Alumina Solution│  │ 🔧 Reinforced Iron Plate                    │
│ ▸ Aluminum Casing │  │ Used for crafting. A sturdier iron plate.   │
│ ▪ Reinforced Iron │  │ Stack 100 · 120 points                      │
│ ▸ Rotor           │  │ MADE IN                                     │
│ ▸ Rubber          │  │  Reinforced Iron Plate      Tier 1 · …      │
│ …                 │  │  6× Iron Plate + 12× Screw → 1× RIP         │
│                   │  │  Assembler · 12s                            │
│                   │  │  Stitched Iron Plate  [Alternate] Hard Drive│
│                   │  │ USED IN                                     │
│                   │  │  Modular Frame · Assembler · 60s            │
└───────────────────┘  └─────────────────────────────────────────────┘
```

This is a read-only reference. It reuses the already-loaded, already-cached
dataset — no new network requests, no engine or solver changes.

## 2. Goals / Non-goals

**Goals**
- Look up any item and see its game description, stack size, sink points, and fuel
  energy value.
- See every machine recipe that **makes** it and every recipe that **uses** it, with
  per-craft amounts, the building, and the craft time — the way the game shows them.
- See how each recipe is unlocked (tier + milestone / MAM / hard drive).
- Cross-link: click any ingredient or product to jump to that item's entry.
- Keep all derivation in a pure, unit-tested module; keep the DOM layer dumb.

**Non-goals**
- No buildings or generators as their own Codex entries (items only).
- No second "browse all recipes" mode and no per-building filter.
- No machine power draw or per-minute rates on recipe rows — the Codex mirrors the
  game's per-craft framing; per-minute rates are the optimizer's job.
- No integration with the optimizer (no "plan this" button, no shared state). The
  two views stay independent.
- No URL deep-linking / sharing (that's an existing whole-app backlog item, §11).
- No change to the LP engine, solver, physical layer, belt layer, or Power view.

## 3. Data the dataset already has (and we currently discard)

Verified against the pinned dataset (`DATASET_COMMIT 2bd1646…`, 177 items, 276
machine recipes after normalization, 454 schematics):

| Raw field | Value | Codex use |
|---|---|---|
| `items[].description` | present for all 177 items, may contain `\n` | item blurb |
| `items[].stackSize` | e.g. Iron Ore 100 | stat line (solids only) |
| `items[].sinkPoints` | >0 for 151 items | stat line (solids only) |
| `items[].energyValue` | >0 for 26 items | stat line, as MJ |
| `recipes[].time` | seconds per craft | recipe row craft time |
| `recipes[].ingredients[].amount` | per-craft amount | recipe row amounts |
| `schematics[]` | `type`, `tier`, `name`, `unlock.recipes` | unlock label |

`normalize.js` keeps only `perMin`, so per-craft amounts and craft time have to be
added (§4). Everything else is a passthrough.

### 3.1 Unlock coverage (measured)

Of the 276 machine recipes, **240 map to an unlocking schematic**: 108
`EST_Alternate` (hard drives), 79 `EST_Milestone`, 45 `EST_MAM`, 8 `EST_Tutorial`
(HUB upgrades). `EST_HardDrive`, `EST_Customization` and `EST_ResourceSink`
schematics never unlock a machine recipe.

**36 recipes have no unlock schematic in the data** — the starting recipes (Iron
Plate, Iron Rod, Iron Ingot) and the Converter / alternate-resource recipes
(Bauxite (Caterium), Ficsite Ingot (Aluminum), …). For those the Codex shows **no
unlock chip at all**. It does not invent "available from the start", which would be
wrong for the Converter recipes.

**4 recipes list more than one unlocking schematic** (SAM Fluctuator, Reanimated
SAM, Packaged Turbofuel, Unpackage Turbofuel), so a deterministic pick rule is
needed (§5.3).

## 4. Data layer — `js/data/normalize.js` (additive only)

Three additions. All are passthroughs with safe defaults, so existing fixtures
(which carry none of these fields) and all current tests keep passing.
`test/fixtures/mini-data.js` is **not** modified.

1. **Item** gains `description` (`''` default), `stackSize` (`0`), `sinkPoints`
   (`0`). `energyValue` already exists.
2. **Recipe** gains `timeSec` (from `r.time`), and each `inputs`/`outputs` entry
   gains `amount` (the raw per-craft amount) alongside the existing `perMin`.
   Nothing reads `amount`/`timeSec` today, so no engine behavior changes.
3. **Dataset** gains `recipeUnlocks: Map<recipeId, UnlockSource[]>` where
   `UnlockSource = { name, type, tier }`, built by inverting
   `raw.schematics[].unlock.recipes`. Every unlocking schematic is kept — the
   adapter stays dumb, and choosing between them is the Codex's job (§5.3).
   Missing/absent `raw.schematics` yields an empty Map.

## 5. Pure module — `js/domain/codex.js` (new)

No DOM, no engine imports. One export, deterministic, called once after load:

```
buildCodexModel(dataset) → {
  items: CodexItem[],            // alphabetical by name
  byId: Map<itemId, CodexItem>,
}

CodexItem = {
  id, name, slug, liquid, raw,   // raw = itemId ∈ dataset.rawResourceIds
  description, stackSize, sinkPoints, energyValue,
  madeIn: CodexRecipe[],         // recipes with this item as an output
  usedIn: CodexRecipe[],         // recipes with this item as an input
}

CodexRecipe = {
  id, name, alternate,
  buildingName, buildingSlug,
  timeSec,
  inputs:  CodexIO[],
  outputs: CodexIO[],            // may be >1: 37 recipes have byproducts
  unlock: { kind, tier, name, label } | null,
}

CodexIO = { itemId, name, slug, liquid, amount }   // amount = per craft
```

Recipes inside `madeIn`/`usedIn` are sorted: non-alternates first, then by name.
Both lists may be empty.

### 5.1 Item selection

Items whose id starts with `special__` are excluded. These are the two
pseudo-items in the dataset — "Sink point" (`special__sinkPoint`) and "Power"
(`special__power`) — which are not real items and are also the only two items with
no vendored icon. That leaves **175 entries**.

Items that appear in no machine recipe are still included (23 of them: hand-crafted
equipment, foraged food, collectibles like Somersloop). They get an empty `madeIn`,
and the UI says so (§6.3).

### 5.2 Building lookup

`buildingName`/`buildingSlug` come from `dataset.buildings.get(recipe.buildingId)`,
falling back to the raw id for the name and `undefined` for the slug (which the
existing icon helper already degrades to an emoji).

### 5.3 Unlock selection and label

From `dataset.recipeUnlocks.get(recipeId)` (may be absent or empty → `unlock: null`),
pick one source deterministically:

1. Sort by kind priority: `milestone` → `mam` → `tutorial` → `alternate` → `other`.
2. Then by `tier` ascending, then by `name` ascending (stable, data-order independent).

Raw `type` maps to `kind`: `EST_Milestone`→`milestone`, `EST_MAM`→`mam`,
`EST_Alternate`→`alternate`, `EST_Tutorial`→`tutorial`, anything else→`other`.

This rule gives the right answer on all 4 multi-source recipes: Packaged Turbofuel →
MAM "Turbofuel" (not one of the two alternates that also grant it), SAM Fluctuator →
Milestone "Matter Conversion", Unpackage Turbofuel → its alternate.

Label text (`kind`, `tier`, and `name` are also returned so tests assert on data,
not formatting):

| kind | label |
|---|---|
| `milestone` | `Tier 2 · Part Assembly` |
| `mam` | `MAM · Rocket Fuel · Tier 3` (tier segment only when `tier > 0`) |
| `tutorial` | `Onboarding · HUB Upgrade 3` |
| `alternate` | `Hard Drive · Tier 4` (tier segment only when `tier > 0`) |
| `other` | the schematic name |

For `alternate` the schematic name is always `"Alternate: <recipe name>"`, which
would just repeat the recipe name next to it, so the label drops it and the row's
`Alternate` chip carries that meaning instead.

## 6. View module — `js/ui/codex.js` (new)

Exports `buildCodex(dataset, container)`, mirroring `buildPower(dataset, container)`:
it owns its DOM, is called once at boot, and manages its own state. All text via
`textContent`; icons via the existing `iconUrl` helper with the same
`.icon` / `.icon-fallback` degradation used in `render.js`. Amounts and craft time
are formatted with the existing `fmt1` from `view-model.js`.

### 6.1 Structure

```
.codex                      (grid: 320px | 1fr, collapses to 1 column ≤800px)
  .codex-list               (left pane)
    input[type=search]      "Search items…"
    p.hint                  "175 items" / "12 matches"
    .codex-items            (scrollable, max-height with overflow-y:auto)
      button.codex-item     (icon + name; .is-selected + aria-current on the active one)
  .codex-detail             (right pane, rebuilt on selection)
```

### 6.2 Left pane

- Live filter on `input`: case-insensitive substring match on the item name. No
  match → a `.search-empty`-style "No matches" row.
- Full list rendered once (175 buttons, no virtualization needed); filtering
  toggles row visibility.
- Clicking a row selects that item and rebuilds the detail pane. Selection does not
  clear the search box.

### 6.3 Detail pane

1. **Header** — 64px icon, item name, and chips: `Fluid` when `liquid`,
   `Raw resource` when `raw`.
2. **Description** — the game blurb, rendered with `white-space: pre-line` since
   descriptions contain newlines.
3. **Stat line** — `Stack size N` and `N sink points`, both **solids only** (fluid
   `stackSize`/`sinkPoints` in the dataset describe pipe buffers, not real stacks or
   sinkable items) and each shown only when `> 0`; `N MJ` when `energyValue > 0`
   (`MJ/m³` for fluids).
4. **Made in** — one recipe card per `madeIn` entry. When `madeIn` is empty:
   "No machine recipe — made by hand, at the Equipment Workshop, or found in the
   world."
5. **Used in** — one recipe card per `usedIn` entry. Section omitted entirely when
   empty.

### 6.4 Recipe card

Three lines:

1. Recipe name, an `Alternate` chip when `alternate`, and the unlock chip when
   `unlock` is non-null.
2. Ingredient chips → `→` → product chips. Each chip is `icon + "6× Iron Plate"`,
   or `icon + "3 m³ Crude Oil"` for fluids (matching how the optimizer units fluids).
   Chips for *other* items are `<button>`s that select that item (the cross-link);
   the chip for the item being viewed is a plain `<span>` with a `--self` modifier
   (subtle accent tint) so there's no pointless self-navigation.
3. Building icon + name + `12s`.

### 6.5 State

The selected item id persists in `localStorage` under `sat-optimizer:codex:v1`
(same try/catch-guarded pattern as `power.js` / `inputs.js`). On boot: the persisted
id if it still resolves, otherwise the first item alphabetically. The active view
tab itself is not persisted — unchanged from today, the app always boots to Factory.

## 7. Wiring

### 7.1 `index.html`
- Third tab button: `<button id="tab-codex" class="viewtab">📖 Codex</button>`.
- Third view container: `<div class="codex-view" id="view-codex" hidden></div>`.

### 7.2 `js/main.js`
- `showView(view)` currently toggles two hardcoded ids. Replace with a small
  table of `{ view → { viewEl, tabEl } }` and a loop, so three (or more) views work
  without repeated conditionals. Behavior for the existing two views is unchanged.
- After `buildPower`, call `buildCodex(dataset, document.getElementById('view-codex'))`
  inside the same `if (el)` guard style. The Codex is built once at boot from the
  already-loaded dataset (a Map build over 276 recipes — microseconds; not worth
  lazy-loading).

### 7.3 `css/styles.css`
- Append a `.codex*` block using existing tokens only (`--surface`, `--surface-2`,
  `--border`, `--ink`, `--ink-2`, `--ink-muted`, `--accent`), matching the panel
  look of `.sidebar` / `.results` / `.power-panel`.
- Add `.codex-view` to the three existing shared control-styling selector groups
  (`input[type="search"]` / hover / `:focus-visible`), which are currently scoped to
  `.app` and `.power-view`. Without this the search field would be unstyled — this is
  the one edit inside existing CSS rules; everything else is appended.

## 8. Testing (TDD, `node --test`)

- **`test/fixtures/codex-data.js`** (new) — a small raw dataset exercising the cases
  the existing fixtures can't: a `special__` pseudo-item, an alternate recipe with an
  `EST_Alternate` schematic, a recipe unlocked by two schematics (milestone + MAM), a
  multi-product recipe, a fluid, a raw resource, and an item with no recipe at all.
  `mini-data.js` stays untouched (`normalize.test.js` asserts `recipes.length === 2`).
- **`test/domain/codex.test.js`** (new):
  - `special__` items excluded; remaining items sorted alphabetically.
  - `madeIn` / `usedIn` correct, including a byproduct-only producer and an item that
    is both consumed and produced.
  - Per-craft `amount` and `timeSec` carried through as per-craft values, *not*
    per-minute: the fixture's 3-in / 2-out recipe must read 3 and 2, not 30 and 20.
  - `liquid` / `raw` flags propagate; building name and slug resolve, and fall back
    when the building is unknown.
  - Unlock: milestone wins over MAM for a two-source recipe; tier omitted from the
    label when `0`; `null` when the recipe has no schematic; alternate label has no
    redundant name.
  - Recipe ordering within a list: non-alternates before alternates.
- **`test/data/normalize.test.js`** (extend): description / stackSize / sinkPoints
  passthrough with defaults; `timeSec` and per-entry `amount` present alongside
  `perMin`; `recipeUnlocks` inverts schematics and is an empty Map when
  `raw.schematics` is absent.
- **Rendering** verified the established way: `python3 -m http.server`, headless
  Chrome screenshot of the Codex tab (both themes), read the PNG. Checks: two-pane
  layout, search filtering, a cross-link click, an item with no machine recipe, and a
  fluid entry.
- Full `npm test` green. Baseline is 104 passing; no existing test should change
  behavior.

## 9. Files touched

| File | Change |
|---|---|
| `js/data/normalize.js` | item description/stack/sink, recipe `timeSec` + per-entry `amount`, `recipeUnlocks` map (§4) |
| `js/domain/codex.js` | **new** — `buildCodexModel` (§5) |
| `js/ui/codex.js` | **new** — `buildCodex` two-pane view (§6) |
| `index.html` | Codex tab button + `#view-codex` container (§7.1) |
| `js/main.js` | table-driven `showView`, build the Codex at boot (§7.2) |
| `css/styles.css` | `.codex*` block; `.codex-view` added to shared input styling (§7.3) |
| `test/fixtures/codex-data.js` | **new** — codex-specific raw fixture (§8) |
| `test/domain/codex.test.js` | **new** — unit tests (§8) |
| `test/data/normalize.test.js` | extend for the new passthroughs (§8) |
| `README.md` | note the Codex view |

## 10. Phasing

One implementation plan, tests first:

1. `normalize.js` additions + extended `normalize.test.js` → verify: new fields
   present, existing 104 tests still green.
2. `codex-data.js` fixture + `codex.test.js` + `js/domain/codex.js` → verify: new
   unit tests green (RED first), no regressions.
3. `js/ui/codex.js` + `index.html` + `js/main.js` + CSS → verify: headless screenshot
   in both themes, search filters, cross-link navigates, other two tabs unaffected.
4. Full `npm test`, README note, commit on a `phase-8-codex` branch.

## 11. Out of scope / deferred

- Buildings and generators as Codex entries; a recipe-first browse mode with a
  per-building filter.
- Deep links (`#codex/iron-plate`) — folded into the existing app-wide URL-state
  sharing backlog item.
- Full combobox-grade keyboard/ARIA support for the item list. The list is native
  `<button>`s (tab + Enter work, `aria-current` marks the selection); richer
  roving-focus behavior stays with the existing app-wide accessibility backlog item.
- **Pre-existing, untouched:** the two `special__` pseudo-items are currently
  selectable in the optimizer's own item pickers (nothing filters them there). The
  Codex filters them for itself; fixing the optimizer pickers is a separate change.
