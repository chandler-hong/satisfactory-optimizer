# Codex Recipe Reference Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a third top-level view — 📖 **Codex** — a two-pane, searchable, in-game-style reference showing every item's description, stats, the recipes that make it, the recipes that use it, and how each recipe is unlocked.

**Architecture:** `normalize.js` gains three additive passthroughs it currently discards (item description/stack/sink, recipe craft time + per-craft amounts, and a `recipeUnlocks` map inverted from the dataset's schematics). A new pure module `js/domain/codex.js` turns the dataset into a render-ready model (`items[]` with `madeIn`/`usedIn` recipe rows and a chosen unlock label). A new DOM module `js/ui/codex.js` renders it, mirroring how `js/ui/power.js` owns the Power view. No engine, solver, view-model, or optimizer code is touched.

**Tech Stack:** Vanilla ES modules, zero build step, no dependencies. Tests via `node --test` (node ≥ 21). Static app served by `python3 -m http.server`; UI verified with headless-Chrome screenshots.

## Global Constraints

- **No new dependencies; no build step.** Vanilla ES modules only.
- **Do NOT modify** `js/engine/*`, `js/ui/view-model.js`, `js/ui/render.js`, `js/ui/inputs.js`, `js/ui/diagram.js`, or `js/ui/power.js`. This feature is additive.
- **`js/domain/codex.js` must be PURE** — no DOM, no imports from `js/ui/*`, no imports from `js/engine/*`.
- **All dataset-derived strings rendered via `textContent`, never `innerHTML`.**
- **Reuse existing CSS tokens** (`--surface`, `--surface-2`, `--border`, `--ink`, `--ink-2`, `--ink-muted`, `--accent`) and existing classes (`.chip`, `.icon`, `.icon-fallback`, `.hint`, `.search-empty`) so light + dark both work. No new tokens.
- **Do NOT modify `test/fixtures/mini-data.js`** (`test/data/normalize.test.js` asserts `recipes.length === 2`). New cases go in the new `test/fixtures/codex-data.js`.
- **Tests:** `npm test` runs `node --test "test/**/*.test.js"`; single file `node --test test/<path>.test.js`. Suite is currently **104 pass / 0 fail** and must stay green.
- **Commits:** conventional-commit style, one per task, ending with the trailer:
  `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`
- Work on branch `phase-8-codex` (already created; spec committed at `0cbada4`).

## Data-shape reference (do not re-derive)

- **Raw dataset** (`greeny/SatisfactoryTools` `data.json`, pinned by `js/data/constants.js`): `raw.items[key] = { className, name, slug, liquid, description, stackSize, sinkPoints, energyValue }`; `raw.recipes[key] = { className, name, alternate, inMachine, time, ingredients: [{item, amount}], products: [{item, amount}], producedIn: [buildingClassName] }`; `raw.buildings[key] = { className, name, slug, metadata: { powerConsumption, powerConsumptionExponent } }`; `raw.schematics[key] = { className, name, type, tier, unlock: { recipes: [recipeClassName] } }`; `raw.resources[key] = { item }`.
- **Normalized dataset** (today, before this plan): `{ items: Map<id,{id,name,slug,liquid,energyValue}>, buildings: Map<id,{id,name,slug,basePowerMW,powerExponent}>, recipes: [{id,name,buildingId,alternate,inputs:[{itemId,perMin}],outputs:[{itemId,perMin}]}], rawResourceIds: Set<id>, generators: [...] }`.
- `normalize()` keeps a recipe only when `inMachine` is true **and** some entry in `producedIn` exists in `buildings`. On the real dataset that is 276 of 825 recipes.
- Schematic `type` values that unlock machine recipes: `EST_Milestone`, `EST_MAM`, `EST_Alternate`, `EST_Tutorial`.
- `fmt1` (round to 1 decimal) is exported from `js/ui/view-model.js`; `iconUrl(slug)` from `js/ui/icons.js`.
- Global CSS already has `[hidden] { display: none !important; }`, so setting `.hidden = true` on any element reliably hides it.

## File Structure

| File | Responsibility |
|---|---|
| `js/data/normalize.js` | adapter: add item description/stack/sink, recipe `timeSec` + per-entry `amount`, `recipeUnlocks` map. |
| `js/domain/codex.js` | **new** — pure `buildCodexModel(dataset)` → the Codex view model. |
| `js/ui/codex.js` | **new** — `buildCodex(dataset, container)`: two-pane DOM, search, selection, cross-links. |
| `index.html` | Codex tab button + `#view-codex` container. |
| `js/main.js` | table-driven `showView`; build the Codex at boot. |
| `css/styles.css` | `.codex*` block; `.codex-view` added to shared input styling. |
| `test/fixtures/codex-data.js` | **new** — raw-shaped fixture with descriptions, amounts, schematics, a pseudo-item. |
| `test/data/normalize.test.js` | extend: new passthroughs + `recipeUnlocks`. |
| `test/domain/codex.test.js` | **new** — unit tests for the model. |
| `README.md` | note the Codex view. |

---

## Task 1: dataset passthroughs (`normalize.js`) + Codex fixture

**Files:**
- Create: `test/fixtures/codex-data.js`
- Modify: `js/data/normalize.js`
- Test: `test/data/normalize.test.js`

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces:
  - `dataset.items` entries gain `description: string` (default `''`), `stackSize: number` (default `0`), `sinkPoints: number` (default `0`).
  - `dataset.recipes` entries gain `timeSec: number`; each `inputs`/`outputs` entry gains `amount: number` (per craft) next to the existing `perMin`.
  - `dataset.recipeUnlocks: Map<recipeId, Array<{ name: string, type: string, tier: number }>>` — every schematic that unlocks the recipe, unfiltered and unsorted. Empty `Map` when `raw.schematics` is absent.
  - `export const codexRaw` from `test/fixtures/codex-data.js` (raw `data.json` shape).

- [ ] **Step 1: Create the fixture**

Create `test/fixtures/codex-data.js`:

```js
// Raw dataset (greeny/SatisfactoryTools shape) for Codex tests. Covers what
// mini-data.js deliberately doesn't: item metadata (description / stack / sink /
// energy), per-craft amounts + craft time, schematic unlocks (milestone, MAM,
// hard-drive alternate with and without a tier), a recipe unlocked by two
// schematics, a byproduct, a fluid, a raw resource, an item with no machine
// recipe, and one of the `special__` pseudo-items the Codex must exclude.
export const codexRaw = {
  items: {
    Desc_OreIron_C:         { className: 'Desc_OreIron_C',         name: 'Iron Ore',          slug: 'iron-ore',          liquid: false, description: 'The most essential basic resource.',   stackSize: 100,   sinkPoints: 1,     energyValue: 0 },
    Desc_IronIngot_C:       { className: 'Desc_IronIngot_C',       name: 'Iron Ingot',        slug: 'iron-ingot',        liquid: false, description: 'Used for crafting.\nSmelted from Iron Ore.', stackSize: 100, sinkPoints: 2, energyValue: 0 },
    Desc_IronPlate_C:       { className: 'Desc_IronPlate_C',       name: 'Iron Plate',        slug: 'iron-plate',        liquid: false, description: 'One of the most basic parts.',         stackSize: 200,   sinkPoints: 6,     energyValue: 0 },
    Desc_LiquidOil_C:       { className: 'Desc_LiquidOil_C',       name: 'Crude Oil',         slug: 'crude-oil',         liquid: true,  description: 'Refined into Oil-based resources.',    stackSize: 50000, sinkPoints: 30000, energyValue: 320 },
    Desc_Plastic_C:         { className: 'Desc_Plastic_C',         name: 'Plastic',           slug: 'plastic',           liquid: false, description: 'A versatile polymer.',                 stackSize: 200,   sinkPoints: 75,    energyValue: 0 },
    Desc_HeavyOilResidue_C: { className: 'Desc_HeavyOilResidue_C', name: 'Heavy Oil Residue', slug: 'heavy-oil-residue', liquid: true,  description: 'A byproduct of oil refining.',         stackSize: 50000, sinkPoints: 0,     energyValue: 400 },
    Desc_Somersloop_C:      { className: 'Desc_Somersloop_C',      name: 'Somersloop',        slug: 'somersloop',        liquid: false, description: 'An alien artifact.',                   stackSize: 50,    sinkPoints: 0,     energyValue: 0 },
    special__power:         { className: 'special__power',         name: 'Power',             slug: 'power',             liquid: false, description: 'Power',                                stackSize: 1,     sinkPoints: 0,     energyValue: 0 },
  },
  buildings: {
    Desc_SmelterMk1_C:     { className: 'Desc_SmelterMk1_C',     name: 'Smelter',     slug: 'smelter',     metadata: { powerConsumption: 4 } },
    Desc_ConstructorMk1_C: { className: 'Desc_ConstructorMk1_C', name: 'Constructor', slug: 'constructor', metadata: { powerConsumption: 4 } },
    Desc_OilRefinery_C:    { className: 'Desc_OilRefinery_C',    name: 'Refinery',    slug: 'refinery',    metadata: { powerConsumption: 30 } },
  },
  resources: {
    Desc_OreIron_C:   { item: 'Desc_OreIron_C',   speed: 1 },
    Desc_LiquidOil_C: { item: 'Desc_LiquidOil_C', speed: 1 },
  },
  miners: {},
  generators: {},
  schematics: {
    // Iron Plate is granted by a tier-1 milestone AND (redundantly) by a MAM
    // research — the two-source case the Codex has to disambiguate.
    'Schematic_1-1_C':   { className: 'Schematic_1-1_C',   name: 'Base Building', type: 'EST_Milestone', tier: 1, unlock: { recipes: ['Recipe_IronPlate_C'] } },
    Research_Plastic_C:  { className: 'Research_Plastic_C', name: 'Polymers',     type: 'EST_MAM',       tier: 3, unlock: { recipes: ['Recipe_Plastic_C', 'Recipe_IronPlate_C'] } },
    Schematic_Alternate_CastPlate_C: { className: 'Schematic_Alternate_CastPlate_C', name: 'Alternate: Cast Plate', type: 'EST_Alternate', tier: 4, unlock: { recipes: ['Recipe_Alternate_CastPlate_C'] } },
    Schematic_Alternate_PureIngot_C: { className: 'Schematic_Alternate_PureIngot_C', name: 'Alternate: Pure Iron Ingot', type: 'EST_Alternate', tier: 0, unlock: { recipes: ['Recipe_Alternate_PureIngot_C'] } },
    // Unlocks nothing that survives normalize — must not break the inversion.
    Schematic_Cosmetic_C: { className: 'Schematic_Cosmetic_C', name: 'Paint', type: 'EST_Customization', tier: 2, unlock: { recipes: [] } },
  },
  recipes: {
    Recipe_IngotIron_C: {
      className: 'Recipe_IngotIron_C', name: 'Iron Ingot', slug: 'iron-ingot',
      alternate: false, inMachine: true, time: 2,
      ingredients: [{ item: 'Desc_OreIron_C', amount: 1 }],
      products:    [{ item: 'Desc_IronIngot_C', amount: 1 }],
      producedIn:  ['Desc_SmelterMk1_C'],
    },
    Recipe_Alternate_PureIngot_C: {
      className: 'Recipe_Alternate_PureIngot_C', name: 'Pure Iron Ingot', slug: 'pure-iron-ingot',
      alternate: true, inMachine: true, time: 12,
      ingredients: [{ item: 'Desc_OreIron_C', amount: 7 }],
      products:    [{ item: 'Desc_IronIngot_C', amount: 13 }],
      producedIn:  ['Desc_SmelterMk1_C'],
    },
    Recipe_IronPlate_C: {
      className: 'Recipe_IronPlate_C', name: 'Iron Plate', slug: 'iron-plate',
      alternate: false, inMachine: true, time: 6,
      ingredients: [{ item: 'Desc_IronIngot_C', amount: 3 }],
      products:    [{ item: 'Desc_IronPlate_C', amount: 2 }],
      producedIn:  ['Desc_ConstructorMk1_C'],
    },
    Recipe_Alternate_CastPlate_C: {
      className: 'Recipe_Alternate_CastPlate_C', name: 'Cast Plate', slug: 'cast-plate',
      alternate: true, inMachine: true, time: 16,
      ingredients: [{ item: 'Desc_IronIngot_C', amount: 1 }],
      products:    [{ item: 'Desc_IronPlate_C', amount: 2 }],
      producedIn:  ['Desc_ConstructorMk1_C'],
    },
    Recipe_Plastic_C: {
      className: 'Recipe_Plastic_C', name: 'Plastic', slug: 'plastic',
      alternate: false, inMachine: true, time: 6,
      ingredients: [{ item: 'Desc_LiquidOil_C', amount: 3 }],
      products:    [
        { item: 'Desc_Plastic_C', amount: 2 },
        { item: 'Desc_HeavyOilResidue_C', amount: 1 },
      ],
      producedIn: ['Desc_OilRefinery_C'],
    },
  },
};
```

- [ ] **Step 2: Write the failing tests**

Append to `test/data/normalize.test.js` (the `normalize` + `miniRaw` imports already exist at the top; add the `codexRaw` import next to them):

```js
import { codexRaw } from '../fixtures/codex-data.js';

test('carries item description, stack size and sink points', () => {
  const ds = normalize(codexRaw);
  const ingot = ds.items.get('Desc_IronIngot_C');
  assert.equal(ingot.description, 'Used for crafting.\nSmelted from Iron Ore.');
  assert.equal(ingot.stackSize, 100);
  assert.equal(ingot.sinkPoints, 2);
  assert.equal(ds.items.get('Desc_LiquidOil_C').energyValue, 320);
});

test('item description/stack/sink default when the raw data omits them', () => {
  const ds = normalize(miniRaw); // mini fixture has none of these fields
  const ore = ds.items.get('Desc_OreIron_C');
  assert.equal(ore.description, '');
  assert.equal(ore.stackSize, 0);
  assert.equal(ore.sinkPoints, 0);
});

test('keeps craft time and per-craft amounts alongside per-minute rates', () => {
  const ds = normalize(codexRaw);
  const plate = ds.recipes.find((r) => r.id === 'Recipe_IronPlate_C');
  assert.equal(plate.timeSec, 6);
  assert.equal(plate.inputs[0].amount, 3);
  assert.equal(plate.inputs[0].perMin, 30);  // 3 / 6s * 60
  assert.equal(plate.outputs[0].amount, 2);
  assert.equal(plate.outputs[0].perMin, 20); // 2 / 6s * 60
});

test('inverts schematics into recipeUnlocks, keeping every source', () => {
  const ds = normalize(codexRaw);
  const plateSources = ds.recipeUnlocks.get('Recipe_IronPlate_C');
  assert.equal(plateSources.length, 2);
  assert.deepEqual(
    [...plateSources].map((s) => s.type).sort(),
    ['EST_MAM', 'EST_Milestone'],
  );
  const milestone = plateSources.find((s) => s.type === 'EST_Milestone');
  assert.equal(milestone.name, 'Base Building');
  assert.equal(milestone.tier, 1);
  assert.equal(ds.recipeUnlocks.has('Recipe_IngotIron_C'), false);
});

test('recipeUnlocks is an empty Map when the dataset has no schematics', () => {
  const ds = normalize({ items: {}, buildings: {}, recipes: {}, resources: {} });
  assert.ok(ds.recipeUnlocks instanceof Map);
  assert.equal(ds.recipeUnlocks.size, 0);
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `node --test test/data/normalize.test.js`
Expected: FAIL — the new assertions fail (`description` undefined, `timeSec` undefined, `ds.recipeUnlocks` undefined). The 7 pre-existing tests in the file still pass.

- [ ] **Step 4: Implement the item passthroughs**

In `js/data/normalize.js`, replace the `items.set(...)` call inside the items loop:

```js
    items.set(it.className, {
      id: it.className,
      name: it.name,
      slug: it.slug,
      liquid: !!it.liquid,
      energyValue: typeof it.energyValue === 'number' ? it.energyValue : 0, // MJ; used for power-generator fuel rates
    });
```

with:

```js
    items.set(it.className, {
      id: it.className,
      name: it.name,
      slug: it.slug,
      liquid: !!it.liquid,
      energyValue: typeof it.energyValue === 'number' ? it.energyValue : 0, // MJ; used for power-generator fuel rates
      // Reference metadata for the Codex view; unused by the optimizer.
      description: typeof it.description === 'string' ? it.description : '',
      stackSize: typeof it.stackSize === 'number' ? it.stackSize : 0,
      sinkPoints: typeof it.sinkPoints === 'number' ? it.sinkPoints : 0,
    });
```

- [ ] **Step 5: Implement craft time + per-craft amounts**

In `js/data/normalize.js`, replace:

```js
  // greeny/SatisfactoryTools stores all recipe amounts already in per-item
  // units (fluids in m³, not the raw x1000 game value), so no fluid scaling.
  const amountToPerMin = (entry, timeSec) => (entry.amount / timeSec) * 60;
```

with:

```js
  // greeny/SatisfactoryTools stores all recipe amounts already in per-item
  // units (fluids in m³, not the raw x1000 game value), so no fluid scaling.
  const amountToPerMin = (entry, timeSec) => (entry.amount / timeSec) * 60;
  // The per-craft `amount` and the recipe's craft time are what the Codex shows
  // (the game states recipes per craft); the optimizer uses `perMin`.
  const ioEntry = (entry, timeSec) => ({
    itemId: entry.item,
    perMin: amountToPerMin(entry, timeSec),
    amount: Number(entry.amount) || 0,
  });
```

Then replace the `recipes.push({...})` call:

```js
    recipes.push({
      id: r.className,
      name: r.name,
      buildingId,
      alternate: !!r.alternate,
      inputs: (r.ingredients || []).map((e) => ({ itemId: e.item, perMin: amountToPerMin(e, r.time) })),
      outputs: (r.products || []).map((e) => ({ itemId: e.item, perMin: amountToPerMin(e, r.time) })),
    });
```

with:

```js
    recipes.push({
      id: r.className,
      name: r.name,
      buildingId,
      alternate: !!r.alternate,
      timeSec: Number(r.time) || 0,
      inputs: (r.ingredients || []).map((e) => ioEntry(e, r.time)),
      outputs: (r.products || []).map((e) => ioEntry(e, r.time)),
    });
```

- [ ] **Step 6: Implement the `recipeUnlocks` inversion**

In `js/data/normalize.js`, insert this block immediately BEFORE the `return { items, buildings, recipes, rawResourceIds, generators };` statement:

```js
  // Recipe → the schematics that unlock it (tier milestone, MAM research,
  // hard-drive alternate, HUB tutorial). Kept as a list because a recipe can be
  // granted by several; choosing which one to show is presentation (see
  // js/domain/codex.js). Recipes with no entry simply aren't in the map.
  const recipeUnlocks = new Map();
  for (const key of Object.keys(raw.schematics || {})) {
    const s = raw.schematics[key];
    for (const recipeId of s.unlock?.recipes || []) {
      if (!recipeUnlocks.has(recipeId)) recipeUnlocks.set(recipeId, []);
      recipeUnlocks.get(recipeId).push({
        name: s.name,
        type: s.type,
        tier: typeof s.tier === 'number' ? s.tier : 0,
      });
    }
  }
```

Then change the return statement to:

```js
  return { items, buildings, recipes, rawResourceIds, generators, recipeUnlocks };
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `node --test test/data/normalize.test.js`
Expected: PASS — 12 tests (7 pre-existing + 5 new), 0 fail.

- [ ] **Step 8: Run the full suite (no regression)**

Run: `npm test`
Expected: PASS — 0 failures, 109 tests (104 baseline + 5 new).

- [ ] **Step 9: Commit**

```bash
git add js/data/normalize.js test/data/normalize.test.js test/fixtures/codex-data.js
git commit -m "feat(data): keep item metadata, craft time, per-craft amounts and recipe unlocks

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 2: Codex model (`js/domain/codex.js`, pure)

**Files:**
- Create: `js/domain/codex.js`
- Test: `test/domain/codex.test.js`

**Interfaces:**
- Consumes: the normalized dataset shape from Task 1 (`items[].description/stackSize/sinkPoints`, `recipes[].timeSec`, io `amount`, `dataset.recipeUnlocks`) and `codexRaw` from `test/fixtures/codex-data.js`.
- Produces:
  ```
  buildCodexModel(dataset) → { items: CodexItem[], byId: Map<string, CodexItem> }

  CodexItem  = { id, name, slug, liquid, raw, description, stackSize, sinkPoints,
                 energyValue, madeIn: CodexRecipe[], usedIn: CodexRecipe[] }
  CodexRecipe = { id, name, alternate, buildingName, buildingSlug, timeSec,
                  inputs: CodexIO[], outputs: CodexIO[],
                  unlock: { kind, tier, name, label } | null }
  CodexIO    = { itemId, name, slug, liquid, amount }
  ```
  `items` is sorted by name; `madeIn`/`usedIn` are sorted standard-before-alternate then by name. `kind` is one of `'milestone' | 'mam' | 'tutorial' | 'alternate' | 'other'`.

- [ ] **Step 1: Write the failing tests**

Create `test/domain/codex.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { normalize } from '../../js/data/normalize.js';
import { buildCodexModel } from '../../js/domain/codex.js';
import { codexRaw } from '../fixtures/codex-data.js';

const model = () => buildCodexModel(normalize(codexRaw));
const find = (m, name) => m.items.find((i) => i.name === name);

test('excludes special__ pseudo-items and sorts the rest alphabetically', () => {
  const m = model();
  assert.equal(m.items.some((i) => i.id.startsWith('special__')), false);
  assert.deepEqual(m.items.map((i) => i.name), [
    'Crude Oil', 'Heavy Oil Residue', 'Iron Ingot', 'Iron Ore', 'Iron Plate', 'Plastic', 'Somersloop',
  ]);
  assert.equal(m.byId.has('special__power'), false);
});

test('madeIn lists producers, standard recipes before alternates', () => {
  const plate = find(model(), 'Iron Plate');
  assert.deepEqual(plate.madeIn.map((r) => r.name), ['Iron Plate', 'Cast Plate']);
  assert.equal(plate.madeIn[0].alternate, false);
  assert.equal(plate.madeIn[1].alternate, true);
});

test('usedIn lists consumers; an item can be both made and used', () => {
  const ingot = find(model(), 'Iron Ingot');
  assert.deepEqual(ingot.madeIn.map((r) => r.name), ['Iron Ingot', 'Pure Iron Ingot']);
  assert.deepEqual(ingot.usedIn.map((r) => r.name), ['Iron Plate', 'Cast Plate']);
});

test('a byproduct-only product still lists its producer', () => {
  const residue = find(model(), 'Heavy Oil Residue');
  assert.deepEqual(residue.madeIn.map((r) => r.name), ['Plastic']);
  assert.deepEqual(residue.usedIn, []);
});

test('an item with no machine recipe has empty madeIn and usedIn', () => {
  const sloop = find(model(), 'Somersloop');
  assert.deepEqual(sloop.madeIn, []);
  assert.deepEqual(sloop.usedIn, []);
});

test('recipe rows carry per-craft amounts and craft time, not per-minute rates', () => {
  const r = find(model(), 'Iron Plate').madeIn[0];
  assert.equal(r.timeSec, 6);
  assert.equal(r.inputs[0].amount, 3);   // per craft; perMin would be 30
  assert.equal(r.outputs[0].amount, 2);  // per craft; perMin would be 20
  assert.equal(r.buildingName, 'Constructor');
  assert.equal(r.buildingSlug, 'constructor');
});

test('multi-product recipes keep every product', () => {
  const r = find(model(), 'Plastic').madeIn[0];
  assert.deepEqual(r.outputs.map((o) => o.name), ['Plastic', 'Heavy Oil Residue']);
  assert.deepEqual(r.outputs.map((o) => o.amount), [2, 1]);
});

test('fluid and raw flags propagate to items and to recipe io', () => {
  const m = model();
  const oil = find(m, 'Crude Oil');
  assert.equal(oil.liquid, true);
  assert.equal(oil.raw, true);
  assert.equal(oil.energyValue, 320);
  assert.equal(find(m, 'Iron Plate').raw, false);
  const input = find(m, 'Plastic').madeIn[0].inputs[0];
  assert.equal(input.name, 'Crude Oil');
  assert.equal(input.liquid, true);
  assert.equal(input.slug, 'crude-oil');
});

test('item description and stats come through', () => {
  const ingot = find(model(), 'Iron Ingot');
  assert.equal(ingot.stackSize, 100);
  assert.equal(ingot.sinkPoints, 2);
  assert.match(ingot.description, /Smelted from Iron Ore/);
});

test('unlock: a milestone source wins over a MAM source for the same recipe', () => {
  const r = find(model(), 'Iron Plate').madeIn.find((x) => x.name === 'Iron Plate');
  assert.equal(r.unlock.kind, 'milestone');
  assert.equal(r.unlock.tier, 1);
  assert.equal(r.unlock.label, 'Tier 1 · Base Building');
});

test('unlock: a MAM label carries its research name and tier', () => {
  const r = find(model(), 'Plastic').madeIn[0];
  assert.equal(r.unlock.kind, 'mam');
  assert.equal(r.unlock.label, 'MAM · Polymers · Tier 3');
});

test('unlock: hard-drive alternates drop the redundant name; tier 0 is omitted', () => {
  const m = model();
  const cast = find(m, 'Iron Plate').madeIn.find((r) => r.name === 'Cast Plate');
  assert.equal(cast.unlock.kind, 'alternate');
  assert.equal(cast.unlock.label, 'Hard Drive · Tier 4');
  const pure = find(m, 'Iron Ingot').madeIn.find((r) => r.name === 'Pure Iron Ingot');
  assert.equal(pure.unlock.label, 'Hard Drive');
});

test('unlock is null when no schematic grants the recipe', () => {
  const r = find(model(), 'Iron Ingot').madeIn.find((x) => x.name === 'Iron Ingot');
  assert.equal(r.unlock, null);
});

test('building name falls back to the raw id when the building is unknown', () => {
  const ds = {
    items: new Map([['a', { id: 'a', name: 'A', slug: 'a', liquid: false }]]),
    buildings: new Map(),
    rawResourceIds: new Set(),
    recipeUnlocks: new Map(),
    recipes: [{
      id: 'r', name: 'R', buildingId: 'Desc_Missing_C', alternate: false, timeSec: 4,
      inputs: [], outputs: [{ itemId: 'a', perMin: 60, amount: 4 }],
    }],
  };
  const r = buildCodexModel(ds).byId.get('a').madeIn[0];
  assert.equal(r.buildingName, 'Desc_Missing_C');
  assert.equal(r.buildingSlug, undefined);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/domain/codex.test.js`
Expected: FAIL — `Cannot find module .../js/domain/codex.js`.

- [ ] **Step 3: Write the implementation**

Create `js/domain/codex.js`:

```js
/**
 * Codex view model: every item paired with the machine recipes that make it,
 * the recipes that use it, and how each recipe is unlocked. Pure — no DOM, no
 * engine imports, deterministic.
 */

// The dataset carries two `special__` pseudo-entries ("Power", "Sink point")
// that aren't real items — no icon, no recipes, nothing to reference.
const isPseudoItem = (id) => id.startsWith('special__');

const UNLOCK_KIND = {
  EST_Milestone: 'milestone',
  EST_MAM: 'mam',
  EST_Alternate: 'alternate',
  EST_Tutorial: 'tutorial',
};

// Lower sorts first. A few recipes are granted by several schematics (e.g.
// Packaged Turbofuel comes with a MAM research and with two hard-drive
// alternates); the most informative source wins.
const KIND_ORDER = { milestone: 0, mam: 1, tutorial: 2, alternate: 3, other: 4 };

/** Human label for an unlock source. Tier is shown only when the data has one. */
function unlockLabel({ kind, tier, name }) {
  const withTier = (text) => (tier > 0 ? `${text} · Tier ${tier}` : text);
  switch (kind) {
    case 'milestone':
      return tier > 0 ? `Tier ${tier} · ${name}` : name;
    case 'mam':
      return withTier(`MAM · ${name}`);
    case 'tutorial':
      return `Onboarding · ${name}`;
    case 'alternate':
      // The schematic name is always "Alternate: <recipe name>", which the row's
      // recipe name and Alternate chip already say.
      return withTier('Hard Drive');
    default:
      return name;
  }
}

/** The single unlock source to show for a recipe, or null when data has none. */
function pickUnlock(sources) {
  if (!sources || sources.length === 0) return null;
  const best = sources
    .map((s) => ({ kind: UNLOCK_KIND[s.type] || 'other', tier: s.tier || 0, name: s.name }))
    .sort((a, b) => (
      KIND_ORDER[a.kind] - KIND_ORDER[b.kind]
      || a.tier - b.tier
      || a.name.localeCompare(b.name)
    ))[0];
  return { ...best, label: unlockLabel(best) };
}

function ioOf(dataset, entry) {
  const item = dataset.items.get(entry.itemId);
  return {
    itemId: entry.itemId,
    name: item?.name ?? entry.itemId,
    slug: item?.slug,
    liquid: !!item?.liquid,
    amount: entry.amount ?? 0,
  };
}

function recipeRowOf(dataset, recipe) {
  const building = dataset.buildings.get(recipe.buildingId);
  return {
    id: recipe.id,
    name: recipe.name,
    alternate: !!recipe.alternate,
    buildingName: building?.name ?? recipe.buildingId,
    buildingSlug: building?.slug,
    timeSec: recipe.timeSec ?? 0,
    inputs: recipe.inputs.map((e) => ioOf(dataset, e)),
    outputs: recipe.outputs.map((e) => ioOf(dataset, e)),
    unlock: pickUnlock(dataset.recipeUnlocks?.get(recipe.id)),
  };
}

/** Standard recipes before alternates, alphabetical within each group. */
function byRecipeOrder(a, b) {
  return (a.alternate ? 1 : 0) - (b.alternate ? 1 : 0) || a.name.localeCompare(b.name);
}

/**
 * Build the Codex model from a normalized dataset.
 * @param {import('./model.js').Dataset} dataset
 * @returns {{items: object[], byId: Map<string, object>}}
 */
export function buildCodexModel(dataset) {
  const byId = new Map();
  for (const item of dataset.items.values()) {
    if (isPseudoItem(item.id)) continue;
    byId.set(item.id, {
      id: item.id,
      name: item.name,
      slug: item.slug,
      liquid: !!item.liquid,
      raw: dataset.rawResourceIds.has(item.id),
      description: item.description ?? '',
      stackSize: item.stackSize ?? 0,
      sinkPoints: item.sinkPoints ?? 0,
      energyValue: item.energyValue ?? 0,
      madeIn: [],
      usedIn: [],
    });
  }

  for (const recipe of dataset.recipes) {
    const row = recipeRowOf(dataset, recipe);
    // Sets: a recipe may list the same item twice, and unpackaging recipes have
    // an item as both input and output — one row per list either way.
    for (const itemId of new Set(recipe.outputs.map((o) => o.itemId))) {
      byId.get(itemId)?.madeIn.push(row);
    }
    for (const itemId of new Set(recipe.inputs.map((i) => i.itemId))) {
      byId.get(itemId)?.usedIn.push(row);
    }
  }

  for (const entry of byId.values()) {
    entry.madeIn.sort(byRecipeOrder);
    entry.usedIn.sort(byRecipeOrder);
  }

  const items = [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
  return { items, byId };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/domain/codex.test.js`
Expected: PASS — 14 tests, 0 fail.

- [ ] **Step 5: Run the full suite (no regression)**

Run: `npm test`
Expected: PASS — 0 failures, 123 tests (109 after Task 1 + 14 new).

- [ ] **Step 6: Commit**

```bash
git add js/domain/codex.js test/domain/codex.test.js
git commit -m "feat(domain): buildCodexModel — items with made-in/used-in recipes and unlocks

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 3: Codex view (`js/ui/codex.js` + wiring + CSS)

**Files:**
- Create: `js/ui/codex.js`
- Modify: `index.html`, `js/main.js`, `css/styles.css`

**Interfaces:**
- Consumes: `buildCodexModel` from `../domain/codex.js` (Task 2), `iconUrl` from `./icons.js`, `fmt1` from `./view-model.js`.
- Produces: `buildCodex(dataset, container)` — builds the whole Codex view into `container`. Called once from `js/main.js` after the dataset loads.

- [ ] **Step 1: Write the view module**

Create `js/ui/codex.js`:

```js
import { iconUrl } from './icons.js';
import { fmt1 } from './view-model.js';
import { buildCodexModel } from '../domain/codex.js';

const CODEX_STATE_KEY = 'sat-optimizer:codex:v1'; // last-viewed item (survives refresh)

function el(tag, className) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  return node;
}

function fallbackIcon(kind) {
  const span = el('span', 'icon-fallback');
  span.textContent = kind === 'building' ? '⚙' : kind === 'fluid' ? '💧' : '📦';
  return span;
}

/** `<img class="icon">` for a slug, degrading to an emoji when it can't load. */
function icon(slug, kind) {
  const url = iconUrl(slug);
  if (!url) return fallbackIcon(kind);
  const img = el('img', 'icon');
  img.loading = 'lazy';
  img.src = url;
  img.alt = '';
  img.onerror = () => img.replaceWith(fallbackIcon(kind));
  return img;
}

const itemKind = (entry) => (entry.liquid ? 'fluid' : 'item');

/** Per-craft amount: "3× Iron Plate", or "3 m³ Crude Oil" for fluids. */
function amountLabel(io) {
  return io.liquid ? `${fmt1(io.amount)} m³ ${io.name}` : `${fmt1(io.amount)}× ${io.name}`;
}

/**
 * One ingredient/product chip. Chips for other items are buttons that jump to
 * that item's entry; the chip for the item being viewed is inert.
 */
function ioChip(io, currentItemId, onSelect) {
  const isSelf = io.itemId === currentItemId;
  const node = isSelf ? el('span', 'codex-io codex-io--self') : el('button', 'codex-io');
  if (!isSelf) {
    node.type = 'button';
    node.addEventListener('click', () => onSelect(io.itemId));
  }
  node.appendChild(icon(io.slug, itemKind(io)));
  const label = el('span');
  label.textContent = amountLabel(io);
  node.appendChild(label);
  return node;
}

/** A recipe as the game states it: ingredients → products, building, craft time. */
function recipeCard(recipe, currentItemId, onSelect) {
  const card = el('div', 'codex-recipe');

  const head = el('div', 'codex-recipe__head');
  const name = el('span', 'codex-recipe__name');
  name.textContent = recipe.name;
  head.appendChild(name);
  if (recipe.alternate) {
    const chip = el('span', 'chip codex-chip--alt');
    chip.textContent = 'Alternate';
    head.appendChild(chip);
  }
  if (recipe.unlock) {
    const chip = el('span', 'chip codex-chip--unlock');
    chip.textContent = recipe.unlock.label;
    head.appendChild(chip);
  }
  card.appendChild(head);

  const flow = el('div', 'codex-flow');
  for (const io of recipe.inputs) flow.appendChild(ioChip(io, currentItemId, onSelect));
  const arrow = el('span', 'codex-arrow');
  arrow.textContent = '→';
  flow.appendChild(arrow);
  for (const io of recipe.outputs) flow.appendChild(ioChip(io, currentItemId, onSelect));
  card.appendChild(flow);

  const foot = el('div', 'codex-recipe__foot');
  foot.appendChild(icon(recipe.buildingSlug, 'building'));
  const meta = el('span');
  meta.textContent = `${recipe.buildingName} · ${fmt1(recipe.timeSec)}s`;
  foot.appendChild(meta);
  card.appendChild(foot);

  return card;
}

/**
 * Stack size / sink points / fuel energy, omitting what doesn't apply. Fluid
 * stackSize and sinkPoints in the dataset describe pipe buffers rather than real
 * stacks or sinkable items, so those two are solids-only.
 */
function statLine(item) {
  const parts = [];
  if (!item.liquid && item.stackSize > 0) parts.push(`Stack size ${item.stackSize}`);
  if (!item.liquid && item.sinkPoints > 0) parts.push(`${item.sinkPoints} sink points`);
  if (item.energyValue > 0) parts.push(`${fmt1(item.energyValue)} MJ${item.liquid ? '/m³' : ''}`);
  if (parts.length === 0) return null;
  const p = el('p', 'codex-stats');
  p.textContent = parts.join(' · ');
  return p;
}

function section(title) {
  const wrap = el('section', 'codex-section');
  const h = el('h3');
  h.textContent = title;
  wrap.appendChild(h);
  return wrap;
}

/** Rebuild the right-hand pane for `item`. All strings via textContent. */
function renderDetail(wrap, item, onSelect) {
  wrap.replaceChildren();

  const head = el('div', 'codex-detail__head');
  head.appendChild(icon(item.slug, itemKind(item)));
  const title = el('h2', 'codex-detail__name');
  title.textContent = item.name;
  head.appendChild(title);
  if (item.liquid) {
    const chip = el('span', 'chip');
    chip.textContent = 'Fluid';
    head.appendChild(chip);
  }
  if (item.raw) {
    const chip = el('span', 'chip');
    chip.textContent = 'Raw resource';
    head.appendChild(chip);
  }
  wrap.appendChild(head);

  if (item.description) {
    const desc = el('p', 'codex-desc');
    desc.textContent = item.description;
    wrap.appendChild(desc);
  }
  const stats = statLine(item);
  if (stats) wrap.appendChild(stats);

  const made = section('Made in');
  if (item.madeIn.length === 0) {
    const p = el('p', 'codex-empty');
    p.textContent = 'No machine recipe — made by hand, at the Equipment Workshop, or found in the world.';
    made.appendChild(p);
  } else {
    for (const r of item.madeIn) made.appendChild(recipeCard(r, item.id, onSelect));
  }
  wrap.appendChild(made);

  if (item.usedIn.length > 0) {
    const used = section('Used in');
    for (const r of item.usedIn) used.appendChild(recipeCard(r, item.id, onSelect));
    wrap.appendChild(used);
  }
}

function restoreSelection(items) {
  try {
    const saved = localStorage.getItem(CODEX_STATE_KEY);
    if (saved && items.some((i) => i.id === saved)) return saved;
  } catch {
    // Storage unavailable (sandboxed / disabled): fall through to the default.
  }
  return items[0].id;
}

function saveSelection(itemId) {
  try {
    localStorage.setItem(CODEX_STATE_KEY, itemId);
  } catch {
    // Storage unavailable: the selection just won't survive a refresh.
  }
}

/**
 * Build the standalone Codex reference into `container`: an alphabetical,
 * searchable item list on the left, and the selected item's entry on the right
 * (description, stats, the recipes that make it and the recipes that use it).
 * Ingredient/product chips cross-link to their own entries. Selection persists.
 */
export function buildCodex(dataset, container) {
  container.replaceChildren();
  const { items, byId } = buildCodexModel(dataset);
  if (items.length === 0) return;

  const panel = el('div', 'codex');
  container.appendChild(panel);

  const listPane = el('div', 'codex-list');
  const detailPane = el('div', 'codex-detail');
  panel.append(listPane, detailPane);

  const search = el('input');
  search.type = 'search';
  search.placeholder = 'Search items…';
  search.autocomplete = 'off';
  search.setAttribute('aria-label', 'Search items');
  listPane.appendChild(search);

  const count = el('p', 'hint');
  listPane.appendChild(count);

  const listEl = el('div', 'codex-items');
  listPane.appendChild(listEl);

  const noMatches = el('p', 'search-empty');
  noMatches.textContent = 'No matches';
  noMatches.hidden = true;
  listPane.appendChild(noMatches);

  const rows = new Map();

  function select(itemId) {
    const item = byId.get(itemId);
    if (!item) return;
    for (const [id, row] of rows) {
      const active = id === itemId;
      row.classList.toggle('is-selected', active);
      if (active) row.setAttribute('aria-current', 'true');
      else row.removeAttribute('aria-current');
    }
    renderDetail(detailPane, item, select);
    saveSelection(itemId);
  }

  for (const item of items) {
    const row = el('button', 'codex-item');
    row.type = 'button';
    row.appendChild(icon(item.slug, itemKind(item)));
    const label = el('span');
    label.textContent = item.name;
    row.appendChild(label);
    row.addEventListener('click', () => select(item.id));
    rows.set(item.id, row);
    listEl.appendChild(row);
  }

  function filter() {
    const q = search.value.trim().toLowerCase();
    let shown = 0;
    for (const item of items) {
      const match = !q || item.name.toLowerCase().includes(q);
      rows.get(item.id).hidden = !match;
      if (match) shown += 1;
    }
    count.textContent = q
      ? `${shown} ${shown === 1 ? 'match' : 'matches'}`
      : `${items.length} items`;
    noMatches.hidden = shown > 0;
  }
  search.addEventListener('input', filter);

  filter();
  select(restoreSelection(items));
}
```

- [ ] **Step 2: Add the tab and container to `index.html`**

In `index.html`, replace the `<nav class="viewtabs">` block:

```html
  <nav class="viewtabs" aria-label="Views">
    <button id="tab-factory" class="viewtab is-active" type="button">🏭 Factory Optimizer</button>
    <button id="tab-power" class="viewtab" type="button">⚡ Power Generation</button>
  </nav>
```

with:

```html
  <nav class="viewtabs" aria-label="Views">
    <button id="tab-factory" class="viewtab is-active" type="button">🏭 Factory Optimizer</button>
    <button id="tab-power" class="viewtab" type="button">⚡ Power Generation</button>
    <button id="tab-codex" class="viewtab" type="button">📖 Codex</button>
  </nav>
```

Then, immediately AFTER the existing power-view container:

```html
  <div class="power-view" id="view-power" hidden>
    <!-- power generation calculator (js/ui/power.js) -->
  </div>
```

insert:

```html
  <div class="codex-view" id="view-codex" hidden>
    <!-- item/recipe reference (js/ui/codex.js) -->
  </div>
```

- [ ] **Step 3: Wire the view in `js/main.js`**

In `js/main.js`, add the import after the existing `buildPower` import:

```js
import { buildCodex } from './ui/codex.js';
```

Replace the view-tab block (currently lines 47–58):

```js
// View tabs: Factory optimizer vs the standalone Power generation calculator.
function showView(view) {
  const isPower = view === 'power';
  const factory = document.getElementById('view-factory');
  const power = document.getElementById('view-power');
  if (factory) factory.hidden = isPower;
  if (power) power.hidden = !isPower;
  document.getElementById('tab-factory')?.classList.toggle('is-active', !isPower);
  document.getElementById('tab-power')?.classList.toggle('is-active', isPower);
}
document.getElementById('tab-factory')?.addEventListener('click', () => showView('factory'));
document.getElementById('tab-power')?.addEventListener('click', () => showView('power'));
```

with:

```js
// View tabs: the Factory optimizer, the standalone Power generation calculator,
// and the Codex item/recipe reference.
const VIEWS = {
  factory: { viewId: 'view-factory', tabId: 'tab-factory' },
  power: { viewId: 'view-power', tabId: 'tab-power' },
  codex: { viewId: 'view-codex', tabId: 'tab-codex' },
};

function showView(active) {
  for (const [name, ids] of Object.entries(VIEWS)) {
    const isActive = name === active;
    const viewEl = document.getElementById(ids.viewId);
    if (viewEl) viewEl.hidden = !isActive;
    document.getElementById(ids.tabId)?.classList.toggle('is-active', isActive);
  }
}

for (const [name, ids] of Object.entries(VIEWS)) {
  document.getElementById(ids.tabId)?.addEventListener('click', () => showView(name));
}
```

Then, in `boot()`, replace:

```js
  const powerEl = document.getElementById('view-power');
  if (powerEl) buildPower(dataset, powerEl);
```

with:

```js
  const powerEl = document.getElementById('view-power');
  if (powerEl) buildPower(dataset, powerEl);

  const codexEl = document.getElementById('view-codex');
  if (codexEl) buildCodex(dataset, codexEl);
```

- [ ] **Step 4: Extend the shared control styling to `.codex-view`**

In `css/styles.css`, four existing rules currently scope form-control styling to `.app` and `.power-view`. Add the Codex search input to each.

Replace:

```css
.app input[type="text"],
.app input[type="number"],
.app input[type="search"],
.app select,
.power-view input[type="number"],
.power-view select {
```

with:

```css
.app input[type="text"],
.app input[type="number"],
.app input[type="search"],
.app select,
.power-view input[type="number"],
.power-view select,
.codex-view input[type="search"] {
```

Replace:

```css
.app input::placeholder { color: var(--ink-muted); }
```

with:

```css
.app input::placeholder,
.codex-view input::placeholder { color: var(--ink-muted); }
```

Replace:

```css
.app input[type="text"]:hover,
.app input[type="number"]:hover,
.app input[type="search"]:hover,
.app select:hover,
.power-view input[type="number"]:hover,
.power-view select:hover { border-color: var(--ink-muted); }
```

with:

```css
.app input[type="text"]:hover,
.app input[type="number"]:hover,
.app input[type="search"]:hover,
.app select:hover,
.power-view input[type="number"]:hover,
.power-view select:hover,
.codex-view input[type="search"]:hover { border-color: var(--ink-muted); }
```

Replace:

```css
.app input[type="text"]:focus-visible,
.app input[type="number"]:focus-visible,
.app input[type="search"]:focus-visible,
.app select:focus-visible,
.power-view input[type="number"]:focus-visible,
.power-view select:focus-visible {
```

with:

```css
.app input[type="text"]:focus-visible,
.app input[type="number"]:focus-visible,
.app input[type="search"]:focus-visible,
.app select:focus-visible,
.power-view input[type="number"]:focus-visible,
.power-view select:focus-visible,
.codex-view input[type="search"]:focus-visible {
```

- [ ] **Step 5: Append the Codex CSS**

Append to the END of `css/styles.css` (after the `.suggestion__enable:hover` rule):

```css
/* ==========================================================================
   Codex — item/recipe reference (two-pane: item list | entry)
   ========================================================================== */

.codex-view {
  max-width: 1400px;
  margin: 0 auto;
  padding: 1rem 1.5rem 2rem;
}

.codex {
  display: grid;
  grid-template-columns: 320px 1fr;
  gap: 1rem;
  align-items: start;
}

@media (max-width: 800px) {
  .codex { grid-template-columns: 1fr; }
}

.codex-list,
.codex-detail {
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: 0.75rem;
  padding: 1rem;
}

.codex-list input[type="search"] { width: 100%; }

.codex-list .hint { margin: 0.5rem 0 0.35rem; }

.codex-items {
  display: flex;
  flex-direction: column;
  gap: 0.1rem;
  max-height: 70vh;
  overflow-y: auto;
}

.codex-item {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  width: 100%;
  padding: 0.4rem 0.5rem;
  border: none;
  border-radius: 0.4rem;
  background: transparent;
  color: var(--ink-2);
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.codex-item:hover {
  background: color-mix(in srgb, var(--accent) 14%, transparent);
  color: var(--ink);
}

.codex-item.is-selected {
  background: color-mix(in srgb, var(--accent) 20%, transparent);
  color: var(--ink);
  font-weight: 700;
}

.codex-item:focus-visible {
  outline: none;
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 28%, transparent);
}

.codex-item .icon { width: 1.35rem; height: 1.35rem; }

.codex-detail__head {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  flex-wrap: wrap;
}

.codex-detail__head .icon { width: 2.5rem; height: 2.5rem; }

.codex-detail__name { margin: 0; }

/* Game descriptions carry their own newlines. */
.codex-desc {
  margin: 0.6rem 0 0.35rem;
  white-space: pre-line;
  color: var(--ink-2);
}

.codex-stats {
  margin: 0;
  color: var(--ink-muted);
  font-size: 0.85rem;
}

.codex-section { margin-top: 1.5rem; }

.codex-section h3 {
  margin: 0 0 0.6rem;
  padding-bottom: 0.4rem;
  border-bottom: 1px solid var(--border);
  font-size: 0.8rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--ink-muted);
}

.codex-recipe {
  margin-bottom: 0.6rem;
  padding: 0.7rem 0.85rem;
  border: 1px solid var(--border);
  border-radius: 0.5rem;
  background: var(--surface);
}

.codex-recipe__head {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  flex-wrap: wrap;
  margin-bottom: 0.55rem;
}

.codex-recipe__name { color: var(--ink); font-weight: 700; }

.codex-chip--alt { border-color: var(--accent); color: var(--ink); }

.codex-chip--unlock { background: var(--surface-2); }

.codex-flow {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  flex-wrap: wrap;
}

.codex-arrow { color: var(--ink-muted); font-weight: 700; }

.codex-io {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  padding: 0.25rem 0.5rem;
  border: 1px solid var(--border);
  border-radius: 0.4rem;
  background: var(--surface-2);
  color: var(--ink-2);
  font: inherit;
  font-size: 0.85rem;
}

button.codex-io { cursor: pointer; }

button.codex-io:hover { border-color: var(--accent); color: var(--ink); }

button.codex-io:focus-visible {
  outline: none;
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 28%, transparent);
}

.codex-io--self {
  border-color: var(--accent);
  background: color-mix(in srgb, var(--accent) 14%, var(--surface-2));
  color: var(--ink);
}

.codex-io .icon { width: 1.1rem; height: 1.1rem; }

.codex-recipe__foot {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  margin-top: 0.55rem;
  color: var(--ink-muted);
  font-size: 0.85rem;
}

.codex-recipe__foot .icon { width: 1.2rem; height: 1.2rem; }

.codex-empty { color: var(--ink-muted); }
```

- [ ] **Step 6: Verify syntax and the test suite**

Run: `node --check js/ui/codex.js && node --check js/main.js && echo OK`
Expected: `OK`.

Run: `npm test`
Expected: PASS — 0 failures, 123 tests (unchanged from Task 2; `codex.js` DOM code and `main.js` have no unit tests).

- [ ] **Step 7: Commit**

```bash
git add js/ui/codex.js index.html js/main.js css/styles.css
git commit -m "feat(ui): Codex view — searchable item/recipe reference

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 4: visual verification + docs

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Serve the app**

Run (background):

```bash
python3 -m http.server 8765 --directory . > /tmp/codex-server.log 2>&1 &
```

Confirm with: `curl -s -o /dev/null -w '%{http_code}\n' http://localhost:8765/index.html`
Expected: `200`.

- [ ] **Step 2: Temporarily default to the Codex tab so a headless screenshot can see it**

Headless Chrome can't click, so make the Codex view the initially-visible one. In `index.html`, temporarily change:

```html
  <div class="codex-view" id="view-codex" hidden>
```

to:

```html
  <div class="codex-view" id="view-codex">
```

and temporarily change:

```html
  <div class="app" id="view-factory">
```

to:

```html
  <div class="app" id="view-factory" hidden>
```

- [ ] **Step 3: Screenshot both themes and read them**

Run:

```bash
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --disable-gpu \
  --window-size=1440,1800 --virtual-time-budget=8000 \
  --screenshot=/tmp/codex-dark.png http://localhost:8765/index.html
```

Then read `/tmp/codex-dark.png` and confirm:
- Two panes: item list (with the search box and an "N items" count) on the left, entry on the right.
- The entry shows a large icon, the item name, its description, a stat line, and a **MADE IN** section with at least one recipe card.
- Recipe cards read `N× Ingredient → N× Product`, with a building name + craft time under them, and an unlock chip where the data has one.
- Nothing overflows its pane; icons load (not emoji fallbacks).

For light mode, temporarily change `<html lang="en" data-theme="dark">` to `data-theme="light"` in `index.html`, screenshot to `/tmp/codex-light.png`, read it, confirm text/chips/borders are legible, then revert that one attribute.

- [ ] **Step 4: Revert the temporary markup changes**

Run: `git checkout index.html && git diff --exit-code index.html && echo REVERTED`
Expected: `REVERTED` (the file matches the Task 3 commit — no temporary `hidden`/theme edits left).

- [ ] **Step 5: Interactive smoke check in a real browser**

With the server still running, open `http://localhost:8765/index.html`, click **📖 Codex**, and confirm:
- Typing `plate` filters the list and the count reads "N matches"; clearing it restores "175 items"; a nonsense query shows "No matches".
- Clicking a list row switches the entry; clicking an ingredient chip navigates to that item (and the chip for the item you're viewing is not clickable).
- An item with no machine recipe (search `Somersloop`) shows the "No machine recipe" line.
- A fluid (search `Crude Oil`) shows the `Fluid` + `Raw resource` chips and `m³` amounts in the recipes that use it.
- The **Factory Optimizer** and **Power Generation** tabs still switch correctly and their contents are unchanged.
- Reloading the page and reopening the Codex restores the last item you viewed.

Stop the server when done: `kill %1` (or `pkill -f "http.server 8765"`).

- [ ] **Step 6: Update the README**

In `README.md`, add a short bullet in the same voice as the existing feature notes, describing the Codex view (searchable item reference: description, stats, made-in/used-in recipes with per-craft amounts, unlock tier, cross-links).

- [ ] **Step 7: Commit and report**

```bash
git add README.md
git commit -m "docs: note the Codex reference view in README

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

Then stop and report: branch `phase-8-codex` ready for the final whole-branch review before local merge. Do **not** push (the user tests locally first).

---

## Self-Review

**Spec coverage:**
- §3 / §4 dataset passthroughs (description, stack, sink, `timeSec`, per-craft `amount`, `recipeUnlocks`) → Task 1. ✅
- §5 `buildCodexModel` shape, pseudo-item exclusion, sorting, building fallback → Task 2 Step 3. ✅
- §5.3 unlock pick rule (kind priority → tier → name) and label formats incl. tier-0 omission and the alternate-name drop → Task 2 Step 3 (`pickUnlock`, `unlockLabel`), tested in Step 1. ✅
- §6.1 structure, §6.2 left pane (search, count, no-matches), §6.3 detail pane (header chips, `pre-line` description, solids-only stats, Made in / Used in, empty-state copy), §6.4 recipe card (3 lines, fluid `m³` chips, inert self chip), §6.5 persistence + default → Task 3 Step 1 + Step 5 CSS. ✅
- §7.1 tab + container → Task 3 Step 2. §7.2 table-driven `showView` + boot call → Step 3. §7.3 four shared-input selector groups + appended `.codex*` block → Steps 4–5. ✅
- §8 tests (fixture, model unit tests, normalize extensions, screenshot pass both themes) → Tasks 1, 2, 4. ✅
- §9 files touched — all ten appear in the plan. ✅
- §10 phasing (4 tasks in the spec's order) → matches. ✅
- §2 non-goals respected: no buildings-as-entries, no recipe-browse mode, no per-minute rates or power on recipe rows, no optimizer integration, no deep links.

**Placeholder scan:** No TBD/TODO. Every code step contains complete code; every run step has a command and an expected result. The README bullet (Task 4 Step 6) is discretionary prose, not a code placeholder.

**Type consistency:** `normalize` produces `items[].{description,stackSize,sinkPoints}`, `recipes[].timeSec`, io `.amount`, and `recipeUnlocks: Map<recipeId, {name,type,tier}[]>` (Task 1) — exactly what `buildCodexModel` reads (Task 2: `item.description`, `item.stackSize`, `item.sinkPoints`, `recipe.timeSec`, `entry.amount`, `dataset.recipeUnlocks?.get(...)`). `buildCodexModel` returns `{ items, byId }` with `CodexItem.{id,name,slug,liquid,raw,description,stackSize,sinkPoints,energyValue,madeIn,usedIn}` and `CodexRecipe.{id,name,alternate,buildingName,buildingSlug,timeSec,inputs,outputs,unlock{kind,tier,name,label}}` — and Task 3 consumes exactly those names (`item.raw`, `item.energyValue`, `recipe.unlock.label`, `recipe.buildingSlug`, `io.amount`, `io.liquid`). `buildCodex(dataset, container)` matches the `main.js` call site. Test counts chain consistently: 104 → 109 (Task 1) → 123 (Task 2) → 123 (Task 3).
