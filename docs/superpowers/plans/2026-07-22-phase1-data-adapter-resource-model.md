# Phase 1: Data Adapter + Resource Model — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Load the pinned community dataset, normalize it into a clean internal model, and compute raw-resource capacity from a node/miner configuration — all pure, unit-tested JS.

**Architecture:** Vanilla ES modules under `js/`, one responsibility per file. A `normalize()` pure function converts greeny/SatisfactoryTools `data.json` into a `Dataset` (Maps of items/buildings, an array of machine recipes, a set of raw-resource ids). A thin `loadDataset()` wraps `fetch` + `localStorage` with injectable dependencies so it is testable offline. `capsFromInputs()` turns a node config into per-minute resource caps. Tests use Node's built-in runner against a small handcrafted fixture plus a real-data smoke script.

**Tech Stack:** JavaScript ES modules, Node's built-in test runner (`node --test`), no third-party dependencies in this phase.

## Global Constraints

- Target game version: **Satisfactory v1.2**.
- **No build step.** Vanilla ES modules only; `package.json` has `"type": "module"` so the same files run in Node and the browser.
- Tests use **`node --test`** (Node 18+); **no test-framework dependencies**.
- Dataset is **pinned to commit `2bd164690a29136365fcfda6f9adcaaf2d6de214`** of `greeny/SatisfactoryTools`, served via jsDelivr.
- **All rates are per-minute.** Fluid amounts in the source are stored **×1000**; divide by 1000 when the item's `liquid` flag is true.
- Default power exponent is **`1.321928`**.
- The repo already contains `README.md`, `.gitignore`, `.nojekyll`, and `docs/` from the initial commit — do not recreate them.
- One commit per task. Commit messages end with:
  `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`

### Source schema (greeny/SatisfactoryTools `data.json`, verified at the pinned commit)

`data.json` is an object with keys `items, recipes, schematics, generators, resources, miners, buildings`; each value is an **object keyed by className**.

- `items[className]` → `{ slug, name, className, stackSize, energyValue, liquid: boolean, ... }`
- `recipes[className]` → `{ slug, name, className, alternate, inMachine, isVariablePower, time /*sec*/, ingredients: [{item, amount}], products: [{item, amount}], producedIn: [buildingClassName], ... }`
- `resources[className]` → `{ item: className, pingColor, speed }`
- `buildings[className]` → `{ slug, name, className, categories, metadata: { powerConsumption?, powerConsumptionExponent?, ... }, size }`
- `schematics[className]` → `{ className, type, name, slug, tier, unlock: { recipes: [className], ... }, ... }` (used later, Phase 4)

### Target model

```js
Item     = { id, name, slug, liquid }                     // id = className
Building = { id, name, basePowerMW, powerExponent }
Recipe   = { id, name, buildingId, alternate, inputs:[{itemId,perMin}], outputs:[{itemId,perMin}] }
Dataset  = { items:Map, buildings:Map, recipes:Recipe[], rawResourceIds:Set }
```

---

## Task 1: Project setup + domain model

**Files:**
- Create: `package.json`
- Create: `js/domain/model.js`
- Test: `test/domain/model.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces: `netPerMin(recipe, itemId) → number` and the JSDoc typedefs (`Item`, `Building`, `Recipe`, `Dataset`, `IOEntry`) used by every later task.

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "satisfactory-optimizer",
  "version": "0.1.0",
  "type": "module",
  "private": true,
  "scripts": {
    "test": "node --test"
  }
}
```

- [ ] **Step 2: Write the failing test** — `test/domain/model.test.js`

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { netPerMin } from '../../js/domain/model.js';

test('netPerMin: positive for outputs, negative for inputs, 0 for absent', () => {
  const recipe = {
    id: 'r', name: 'r', buildingId: 'b', alternate: false,
    inputs: [{ itemId: 'ore', perMin: 30 }],
    outputs: [{ itemId: 'ingot', perMin: 30 }],
  };
  assert.equal(netPerMin(recipe, 'ingot'), 30);
  assert.equal(netPerMin(recipe, 'ore'), -30);
  assert.equal(netPerMin(recipe, 'other'), 0);
});

test('netPerMin: nets an item that is both input and output', () => {
  const recipe = {
    id: 'r', name: 'r', buildingId: 'b', alternate: false,
    inputs: [{ itemId: 'water', perMin: 20 }],
    outputs: [{ itemId: 'water', perMin: 50 }],
  };
  assert.equal(netPerMin(recipe, 'water'), 30);
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `node --test test/domain/model.test.js`
Expected: FAIL — `Cannot find module '.../js/domain/model.js'`.

- [ ] **Step 4: Write minimal implementation** — `js/domain/model.js`

```js
/**
 * @typedef {Object} Item
 * @property {string} id     className, e.g. "Desc_IronIngot_C"
 * @property {string} name
 * @property {string} slug
 * @property {boolean} liquid
 *
 * @typedef {Object} Building
 * @property {string} id
 * @property {string} name
 * @property {number} basePowerMW    // 0 if unknown
 * @property {number} powerExponent  // default 1.321928
 *
 * @typedef {Object} IOEntry
 * @property {string} itemId
 * @property {number} perMin
 *
 * @typedef {Object} Recipe
 * @property {string} id
 * @property {string} name
 * @property {string} buildingId
 * @property {boolean} alternate
 * @property {IOEntry[]} inputs
 * @property {IOEntry[]} outputs
 *
 * @typedef {Object} Dataset
 * @property {Map<string, Item>} items
 * @property {Map<string, Building>} buildings
 * @property {Recipe[]} recipes
 * @property {Set<string>} rawResourceIds
 */

/**
 * Net production per minute of `itemId` for one machine of `recipe` at 100%.
 * Positive = net produced, negative = net consumed.
 * @param {Recipe} recipe
 * @param {string} itemId
 * @returns {number}
 */
export function netPerMin(recipe, itemId) {
  let net = 0;
  for (const o of recipe.outputs) if (o.itemId === itemId) net += o.perMin;
  for (const i of recipe.inputs) if (i.itemId === itemId) net -= i.perMin;
  return net;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `node --test test/domain/model.test.js`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add package.json js/domain/model.js test/domain/model.test.js
git commit -m "feat(model): domain typedefs + netPerMin helper" \
  -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Dataset constants, fixture, and normalizer

**Files:**
- Create: `js/data/constants.js`
- Create: `js/data/normalize.js`
- Create: `test/fixtures/mini-data.js`
- Test: `test/data/normalize.test.js`

**Interfaces:**
- Consumes: the `Dataset`/`Recipe` shapes from Task 1.
- Produces:
  - `DATASET_URL`, `DATASET_COMMIT`, `CACHE_KEY` (strings).
  - `normalize(raw) → Dataset`.
  - `DEFAULT_POWER_EXPONENT = 1.321928`.
  - `miniRaw` fixture (raw-schema-shaped) for downstream tests.

- [ ] **Step 1: Create the pinned constants** — `js/data/constants.js`

```js
// Pinned community dataset (greeny/SatisfactoryTools) via jsDelivr.
// Pinned to a commit for reproducibility; bump deliberately.
export const DATASET_COMMIT = '2bd164690a29136365fcfda6f9adcaaf2d6de214';
export const DATASET_URL =
  `https://cdn.jsdelivr.net/gh/greeny/SatisfactoryTools@${DATASET_COMMIT}/data/data.json`;
// localStorage cache key; embeds the commit so a bump invalidates old cache.
export const CACHE_KEY = `sat-optimizer:dataset:${DATASET_COMMIT}`;
```

- [ ] **Step 2: Create the fixture** — `test/fixtures/mini-data.js`

```js
// Minimal raw dataset shaped like greeny/SatisfactoryTools data.json.
// Encodes: a solid recipe, a fluid recipe (amounts ×1000), a byproduct,
// a hand-only recipe (must be excluded), and building power.
export const miniRaw = {
  items: {
    Desc_OreIron_C:        { className: 'Desc_OreIron_C',        name: 'Iron Ore',          slug: 'iron-ore',           liquid: false },
    Desc_IronIngot_C:      { className: 'Desc_IronIngot_C',      name: 'Iron Ingot',        slug: 'iron-ingot',         liquid: false },
    Desc_LiquidOil_C:      { className: 'Desc_LiquidOil_C',      name: 'Crude Oil',         slug: 'crude-oil',          liquid: true  },
    Desc_Plastic_C:        { className: 'Desc_Plastic_C',        name: 'Plastic',           slug: 'plastic',            liquid: false },
    Desc_HeavyOilResidue_C:{ className: 'Desc_HeavyOilResidue_C',name: 'Heavy Oil Residue', slug: 'heavy-oil-residue',  liquid: true  },
  },
  buildings: {
    Desc_SmelterMk1_C:     { className: 'Desc_SmelterMk1_C',     name: 'Smelter',    metadata: { powerConsumption: 4,  powerConsumptionExponent: 1.321928 } },
    Desc_OilRefinery_C:    { className: 'Desc_OilRefinery_C',    name: 'Refinery',   metadata: { powerConsumption: 30, powerConsumptionExponent: 1.321928 } },
    Desc_ConstructorMk1_C: { className: 'Desc_ConstructorMk1_C', name: 'Constructor',metadata: { powerConsumption: 4 } },
  },
  resources: {
    Desc_OreIron_C:   { item: 'Desc_OreIron_C',   speed: 1 },
    Desc_LiquidOil_C: { item: 'Desc_LiquidOil_C', speed: 1 },
  },
  miners: {},
  generators: {},
  schematics: {},
  recipes: {
    Recipe_IngotIron_C: {
      className: 'Recipe_IngotIron_C', name: 'Iron Ingot', slug: 'iron-ingot',
      alternate: false, inMachine: true, time: 2,
      ingredients: [{ item: 'Desc_OreIron_C', amount: 1 }],
      products:    [{ item: 'Desc_IronIngot_C', amount: 1 }],
      producedIn:  ['Desc_SmelterMk1_C'],
    },
    Recipe_Plastic_C: {
      className: 'Recipe_Plastic_C', name: 'Plastic', slug: 'plastic',
      alternate: false, inMachine: true, time: 6,
      ingredients: [{ item: 'Desc_LiquidOil_C', amount: 3000 }],
      products:    [
        { item: 'Desc_Plastic_C', amount: 2 },
        { item: 'Desc_HeavyOilResidue_C', amount: 1000 },
      ],
      producedIn: ['Desc_OilRefinery_C'],
    },
    Recipe_Manual_Only_C: {
      className: 'Recipe_Manual_Only_C', name: 'Handcraft Thing', slug: 'handcraft',
      alternate: false, inMachine: false, time: 1,
      ingredients: [{ item: 'Desc_OreIron_C', amount: 1 }],
      products:    [{ item: 'Desc_IronIngot_C', amount: 1 }],
      producedIn:  ['BP_WorkBenchComponent_C'],
    },
  },
};
```

- [ ] **Step 3: Write the failing test** — `test/data/normalize.test.js`

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { normalize } from '../../js/data/normalize.js';
import { miniRaw } from '../fixtures/mini-data.js';

test('maps items with the liquid flag and name', () => {
  const ds = normalize(miniRaw);
  assert.equal(ds.items.get('Desc_LiquidOil_C').liquid, true);
  assert.equal(ds.items.get('Desc_IronIngot_C').liquid, false);
  assert.equal(ds.items.get('Desc_IronIngot_C').name, 'Iron Ingot');
});

test('computes solid per-minute rates and building', () => {
  const ds = normalize(miniRaw);
  const iron = ds.recipes.find((r) => r.id === 'Recipe_IngotIron_C');
  assert.equal(iron.inputs[0].perMin, 30);   // 1 ore / 2s * 60
  assert.equal(iron.outputs[0].perMin, 30);
  assert.equal(iron.buildingId, 'Desc_SmelterMk1_C');
});

test('divides fluid amounts by 1000 (ground truth: Plastic)', () => {
  const ds = normalize(miniRaw);
  const p = ds.recipes.find((r) => r.id === 'Recipe_Plastic_C');
  assert.equal(p.inputs.find((i) => i.itemId === 'Desc_LiquidOil_C').perMin, 30);   // 3000/1000=3 /6s*60
  assert.equal(p.outputs.find((o) => o.itemId === 'Desc_Plastic_C').perMin, 20);    // 2 /6s*60
  assert.equal(p.outputs.find((o) => o.itemId === 'Desc_HeavyOilResidue_C').perMin, 10); // 1000/1000=1 /6*60
});

test('excludes non-machine recipes', () => {
  const ds = normalize(miniRaw);
  assert.equal(ds.recipes.find((r) => r.id === 'Recipe_Manual_Only_C'), undefined);
  assert.equal(ds.recipes.length, 2);
});

test('collects raw resource ids from resources', () => {
  const ds = normalize(miniRaw);
  assert.ok(ds.rawResourceIds.has('Desc_OreIron_C'));
  assert.ok(ds.rawResourceIds.has('Desc_LiquidOil_C'));
  assert.equal(ds.rawResourceIds.has('Desc_IronIngot_C'), false);
});

test('maps building base power and exponent (with default)', () => {
  const ds = normalize(miniRaw);
  assert.equal(ds.buildings.get('Desc_OilRefinery_C').basePowerMW, 30);
  assert.equal(ds.buildings.get('Desc_SmelterMk1_C').powerExponent, 1.321928);
  assert.equal(ds.buildings.get('Desc_ConstructorMk1_C').powerExponent, 1.321928); // default
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `node --test test/data/normalize.test.js`
Expected: FAIL — `Cannot find module '.../js/data/normalize.js'`.

- [ ] **Step 5: Write minimal implementation** — `js/data/normalize.js`

```js
export const DEFAULT_POWER_EXPONENT = 1.321928;

/**
 * Convert a raw greeny/SatisfactoryTools data.json object into a Dataset.
 * @param {object} raw parsed data.json
 * @returns {import('../domain/model.js').Dataset}
 */
export function normalize(raw) {
  const items = new Map();
  for (const key of Object.keys(raw.items || {})) {
    const it = raw.items[key];
    items.set(it.className, {
      id: it.className,
      name: it.name,
      slug: it.slug,
      liquid: !!it.liquid,
    });
  }

  const buildings = new Map();
  for (const key of Object.keys(raw.buildings || {})) {
    const b = raw.buildings[key];
    const md = b.metadata || {};
    const basePowerMW =
      typeof md.powerConsumption === 'number' ? md.powerConsumption
        : typeof md.maxPowerConsumption === 'number' ? md.maxPowerConsumption
          : 0;
    buildings.set(b.className, {
      id: b.className,
      name: b.name,
      basePowerMW,
      powerExponent:
        typeof md.powerConsumptionExponent === 'number'
          ? md.powerConsumptionExponent
          : DEFAULT_POWER_EXPONENT,
    });
  }

  const rawResourceIds = new Set(
    Object.values(raw.resources || {}).map((r) => r.item)
  );

  const amountToPerMin = (entry, timeSec) => {
    const it = items.get(entry.item);
    const amount = it && it.liquid ? entry.amount / 1000 : entry.amount;
    return (amount / timeSec) * 60;
  };

  const recipes = [];
  for (const key of Object.keys(raw.recipes || {})) {
    const r = raw.recipes[key];
    if (!r.inMachine) continue;                          // skip hand/workshop/build-gun
    const buildingId = (r.producedIn || []).find((c) => buildings.has(c));
    if (!buildingId) continue;                           // no automated building
    recipes.push({
      id: r.className,
      name: r.name,
      buildingId,
      alternate: !!r.alternate,
      inputs: (r.ingredients || []).map((e) => ({ itemId: e.item, perMin: amountToPerMin(e, r.time) })),
      outputs: (r.products || []).map((e) => ({ itemId: e.item, perMin: amountToPerMin(e, r.time) })),
    });
  }

  return { items, buildings, recipes, rawResourceIds };
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `node --test test/data/normalize.test.js`
Expected: PASS (6 tests).

- [ ] **Step 7: Commit**

```bash
git add js/data/constants.js js/data/normalize.js test/fixtures/mini-data.js test/data/normalize.test.js
git commit -m "feat(data): normalizer + pinned constants + fixture" \
  -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Data loader (fetch + localStorage cache)

**Files:**
- Create: `js/data/loader.js`
- Test: `test/data/loader.test.js`

**Interfaces:**
- Consumes: `normalize` (Task 2), `DATASET_URL`, `CACHE_KEY` (Task 2).
- Produces: `loadDataset({ fetchImpl?, storage?, url?, cacheKey? }) → Promise<Dataset>`.
  Caches the **raw JSON text** (Maps/Sets do not JSON-serialize), normalizing on every read.

- [ ] **Step 1: Write the failing test** — `test/data/loader.test.js`

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadDataset } from '../../js/data/loader.js';
import { miniRaw } from '../fixtures/mini-data.js';

function fakeStorage(initial = {}) {
  const m = new Map(Object.entries(initial));
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, v),
    removeItem: (k) => m.delete(k),
  };
}

test('fetches, normalizes, and caches raw text', async () => {
  const storage = fakeStorage();
  let calls = 0;
  const fetchImpl = async () => {
    calls++;
    return { ok: true, status: 200, text: async () => JSON.stringify(miniRaw) };
  };
  const ds = await loadDataset({ fetchImpl, storage, url: 'x', cacheKey: 'k' });
  assert.equal(ds.items.get('Desc_IronIngot_C').name, 'Iron Ingot');
  assert.equal(calls, 1);
  assert.ok(storage.getItem('k'));
});

test('uses cache on second load (no fetch)', async () => {
  const storage = fakeStorage({ k: JSON.stringify(miniRaw) });
  let calls = 0;
  const fetchImpl = async () => { calls++; throw new Error('should not fetch'); };
  const ds = await loadDataset({ fetchImpl, storage, url: 'x', cacheKey: 'k' });
  assert.equal(calls, 0);
  assert.equal(ds.recipes.length, 2);
});

test('throws on non-ok response', async () => {
  const storage = fakeStorage();
  const fetchImpl = async () => ({ ok: false, status: 503, text: async () => '' });
  await assert.rejects(() => loadDataset({ fetchImpl, storage, url: 'x', cacheKey: 'k' }));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/data/loader.test.js`
Expected: FAIL — `Cannot find module '.../js/data/loader.js'`.

- [ ] **Step 3: Write minimal implementation** — `js/data/loader.js`

```js
import { DATASET_URL, CACHE_KEY } from './constants.js';
import { normalize } from './normalize.js';

/**
 * Load + normalize the dataset, preferring a localStorage cache.
 * Dependencies are injected so this runs in tests without network/browser.
 * @param {{fetchImpl?: typeof fetch, storage?: Storage, url?: string, cacheKey?: string}} [deps]
 * @returns {Promise<import('../domain/model.js').Dataset>}
 */
export async function loadDataset(deps = {}) {
  const {
    fetchImpl = fetch,
    storage = (typeof globalThis !== 'undefined' ? globalThis.localStorage : undefined),
    url = DATASET_URL,
    cacheKey = CACHE_KEY,
  } = deps;

  if (storage) {
    const cached = storage.getItem(cacheKey);
    if (cached) {
      try { return normalize(JSON.parse(cached)); } catch { /* corrupt cache: refetch */ }
    }
  }

  const res = await fetchImpl(url);
  if (!res.ok) throw new Error(`Dataset fetch failed: ${res.status}`);
  const text = await res.text();
  if (storage) {
    try { storage.setItem(cacheKey, text); } catch { /* over quota: skip cache */ }
  }
  return normalize(JSON.parse(text));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/data/loader.test.js`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add js/data/loader.js test/data/loader.test.js
git commit -m "feat(data): loader with fetch + localStorage cache" \
  -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Resource model (`capsFromInputs`)

**Files:**
- Create: `js/engine/resource-model.js`
- Test: `test/engine/resource-model.test.js`

**Interfaces:**
- Consumes: nothing (self-contained tables).
- Produces:
  - `MINER_RATES`, `OIL_EXTRACTOR_RATES`, `WATER_EXTRACTOR_RATE`, `WELL_SATELLITE_RATES`.
  - `capsFromInputs(config) → Map<resourceItemId, ratePerMin>`.
    `config` is keyed by raw-resource item id; each value:
    `{ kind?: 'miner'|'oil'|'water'|'well', minerTier?: 'Mk1'|'Mk2'|'Mk3',
       impure?, normal?, pure?, satellites?:{impure?,normal?,pure?}, count?, clock?, override? }`.

- [ ] **Step 1: Write the failing test** — `test/engine/resource-model.test.js`

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { capsFromInputs } from '../../js/engine/resource-model.js';

test('3 normal iron on Mk.2 = 360/min', () => {
  const caps = capsFromInputs({ Desc_OreIron_C: { kind: 'miner', minerTier: 'Mk2', normal: 3 } });
  assert.equal(caps.get('Desc_OreIron_C'), 360);
});

test('3 pure iron on Mk.2 = 720/min', () => {
  const caps = capsFromInputs({ Desc_OreIron_C: { kind: 'miner', minerTier: 'Mk2', pure: 3 } });
  assert.equal(caps.get('Desc_OreIron_C'), 720);
});

test('2 impure copper on Mk.1 = 60/min', () => {
  const caps = capsFromInputs({ Desc_OreCopper_C: { kind: 'miner', minerTier: 'Mk1', impure: 2 } });
  assert.equal(caps.get('Desc_OreCopper_C'), 60);
});

test('mixed purity sums (Mk.2: 1 imp + 2 norm + 1 pure = 540)', () => {
  const caps = capsFromInputs({ Desc_OreIron_C: { kind: 'miner', minerTier: 'Mk2', impure: 1, normal: 2, pure: 1 } });
  assert.equal(caps.get('Desc_OreIron_C'), 540);
});

test('clock scales output (Mk.2 normal @250% = 300)', () => {
  const caps = capsFromInputs({ Desc_OreIron_C: { kind: 'miner', minerTier: 'Mk2', normal: 1, clock: 2.5 } });
  assert.equal(caps.get('Desc_OreIron_C'), 300);
});

test('oil extractors use oil rates', () => {
  const caps = capsFromInputs({ Desc_LiquidOil_C: { kind: 'oil', normal: 2 } });
  assert.equal(caps.get('Desc_LiquidOil_C'), 240);
});

test('water extractors use flat rate', () => {
  const caps = capsFromInputs({ Desc_Water_C: { kind: 'water', count: 2 } });
  assert.equal(caps.get('Desc_Water_C'), 240);
});

test('resource well sums satellite purities', () => {
  const caps = capsFromInputs({ Desc_NitrogenGas_C: { kind: 'well', satellites: { normal: 2, pure: 1 } } });
  assert.equal(caps.get('Desc_NitrogenGas_C'), 240); // 2*60 + 1*120
});

test('override bypasses computation', () => {
  const caps = capsFromInputs({ Desc_OreIron_C: { override: 999 } });
  assert.equal(caps.get('Desc_OreIron_C'), 999);
});

test('defaults kind to miner and tier to Mk1', () => {
  const caps = capsFromInputs({ Desc_OreIron_C: { normal: 1 } });
  assert.equal(caps.get('Desc_OreIron_C'), 60);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/engine/resource-model.test.js`
Expected: FAIL — `Cannot find module '.../js/engine/resource-model.js'`.

- [ ] **Step 3: Write minimal implementation** — `js/engine/resource-model.js`

```js
// Miner output per minute at 100% clock, by tier and node purity.
export const MINER_RATES = {
  Mk1: { impure: 30,  normal: 60,  pure: 120 },
  Mk2: { impure: 60,  normal: 120, pure: 240 },
  Mk3: { impure: 120, normal: 240, pure: 480 },
};

// Fluid extraction per minute at 100% clock.
export const OIL_EXTRACTOR_RATES = { impure: 60, normal: 120, pure: 240 };
export const WATER_EXTRACTOR_RATE = 120;                       // no purity variants
export const WELL_SATELLITE_RATES = { impure: 30, normal: 60, pure: 120 };

const byPurity = (c, rates) =>
  (c.impure || 0) * rates.impure + (c.normal || 0) * rates.normal + (c.pure || 0) * rates.pure;

/**
 * Compute raw-resource capacity (per minute) from a node configuration.
 * @param {Object.<string, object>} config keyed by raw-resource item id
 * @returns {Map<string, number>}
 */
export function capsFromInputs(config) {
  const caps = new Map();
  for (const itemId of Object.keys(config)) {
    const c = config[itemId];
    if (typeof c.override === 'number') { caps.set(itemId, c.override); continue; }
    const clock = typeof c.clock === 'number' ? c.clock : 1;
    const kind = c.kind || 'miner';
    let rate = 0;
    if (kind === 'miner') rate = byPurity(c, MINER_RATES[c.minerTier || 'Mk1']);
    else if (kind === 'oil') rate = byPurity(c, OIL_EXTRACTOR_RATES);
    else if (kind === 'water') rate = (c.count || 0) * WATER_EXTRACTOR_RATE;
    else if (kind === 'well') rate = byPurity(c.satellites || {}, WELL_SATELLITE_RATES);
    caps.set(itemId, rate * clock);
  }
  return caps;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/engine/resource-model.test.js`
Expected: PASS (10 tests).

- [ ] **Step 5: Run the whole suite**

Run: `node --test`
Expected: PASS — all files (Tasks 1–4), 21 tests total.

- [ ] **Step 6: Commit**

```bash
git add js/engine/resource-model.js test/engine/resource-model.test.js
git commit -m "feat(engine): resource-model capsFromInputs" \
  -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Real-data smoke check (locks the pinned dataset)

Confirms the normalizer works against the **actual** pinned `data.json` (not just the fixture) — catching any schema mismatch and validating the fluid ÷1000 rule against real recipes. Uses Node 18+ global `fetch`; hits the network, so it is a script, **not** part of `node --test`.

**Files:**
- Create: `scripts/verify-data.mjs`

**Interfaces:**
- Consumes: `loadDataset` (Task 3).
- Produces: a runnable diagnostic script (no exports).

- [ ] **Step 1: Write the script** — `scripts/verify-data.mjs`

```js
// Real-data smoke check against the pinned dataset. Run: node scripts/verify-data.mjs
import { loadDataset } from '../js/data/loader.js';

// No-op storage forces a fresh network fetch (skips any cache).
const ds = await loadDataset({ storage: { getItem: () => null, setItem: () => {} } });
console.log('items:',     ds.items.size);
console.log('buildings:', ds.buildings.size);
console.log('recipes:',   ds.recipes.length);
console.log('raw resources:', ds.rawResourceIds.size);

const assert = (cond, msg) => { if (!cond) { console.error('FAIL:', msg); process.exit(1); } };
assert(ds.items.size > 100, 'expected >100 items');
assert(ds.recipes.length > 100, 'expected >100 machine recipes');
assert(ds.rawResourceIds.has('Desc_OreIron_C'), 'iron ore should be a raw resource');

// Ground-truth rate check on a real recipe: standard Iron Ingot = 30 ore -> 30 ingot/min.
const ironIngot = ds.recipes.find((r) => r.id === 'Recipe_IngotIron_C');
assert(ironIngot, 'Recipe_IngotIron_C present');
assert(Math.abs(ironIngot.outputs[0].perMin - 30) < 1e-9, 'iron ingot = 30/min');

// Ground-truth fluid check: standard Plastic = 30 crude oil -> 20 plastic/min.
const plastic = ds.recipes.find((r) => r.id === 'Recipe_Plastic_C');
assert(plastic, 'Recipe_Plastic_C present');
const oilIn = plastic.inputs.find((i) => i.itemId === 'Desc_LiquidOil_C');
assert(oilIn && Math.abs(oilIn.perMin - 30) < 1e-9, `crude oil should be 30/min, got ${oilIn && oilIn.perMin}`);

console.log('\nAll real-data smoke checks passed. Dataset pin is good.');
```

- [ ] **Step 2: Run it**

Run: `node scripts/verify-data.mjs`
Expected: prints counts and `All real-data smoke checks passed.`
**If the crude-oil check fails at ~30000**, greeny pre-divides fluids: remove the `/1000` branch in `normalize.js` and re-run Tasks 2 + 5. (Ground-truth tests exist precisely to surface this.)

- [ ] **Step 3: Commit**

```bash
git add scripts/verify-data.mjs
git commit -m "test(data): real-data smoke check against pinned dataset" \
  -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Phase 1 Definition of Done

- `node --test` passes (21 unit tests across model, normalize, loader, resource-model).
- `node scripts/verify-data.mjs` passes against the real pinned dataset.
- `js/domain/model.js`, `js/data/{constants,normalize,loader}.js`, `js/engine/resource-model.js` exist and are pure ES modules with no third-party deps.
- Downstream (Phase 2) can `import { loadDataset }` to get a `Dataset`, `import { netPerMin }` for LP coefficients, and `import { capsFromInputs }` for resource limits.
