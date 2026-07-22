# Phase 3: Physical/Shard Layer + Belt/Pipe Layer — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the LP engine's per-recipe run-rates (Phase 2) into a concrete, buildable factory: machine counts + clocks + power, spending a power-shard budget to minimize buildings, plus belt/pipe line counts per material flow.

**Architecture:** Two pure modules over the Phase-2 `recipeRates` Map. `physical-layer.js` converts each recipe's load (machine-equivalents @100%) into machines/clock/power, and runs a DP that allocates a global shard budget to minimize total buildings (the machines↔shards trade-off is non-convex, so a multiple-choice knapsack DP, not a greedy). `belt-layer.js` sums material flows and divides by belt/pipe capacity per tier. Both are offline-unit-tested; an integration test ties optimize→realize→belts on the iron-chain fixture.

**Tech Stack:** JavaScript ES modules, Node's built-in test runner, no third-party dependencies.

## Global Constraints

- Target game version **Satisfactory v1.2**; all rates per-minute.
- **No build step.** Vanilla ES modules; tests via `npm test` (scoped to `test/**/*.test.js`).
- **Power:** `powerMW = machines × basePowerMW × clock^powerExponent`. `powerExponent` comes from the building (Phase 1 `Building.powerExponent`, default **1.321928** — which is a truncation of log₂2.5, so power assertions use a tolerance except at clock 1.0 where the multiplier is exactly 1).
- **Overclock/shards:** clock ceiling **2.5** (250%). Shards to REACH a clock: ≤100% → 0, ≤150% → 1, ≤200% → 2, ≤250% → 3. A recipe with load `L` run on `N` machines uses clock `L/N` on each; shards = `N × shardsToReach(L/N)`.
- **Noise:** `realize` rounds each recipe load to 1e-6 before `ceil`/clock math, to absorb LP float noise (Phase 2 outputs e.g. `11.99999999`).
- **Belt caps** (items/min): Mk1 60, Mk2 120, Mk3 270, Mk4 480, Mk5 780, Mk6 1200. **Pipe caps** (m³/min): Mk1 300, Mk2 600. Fluids (`Item.liquid` from Phase 1) use pipe caps; solids use belt caps.
- Consumes: Phase 1 `Dataset` (`recipes`, `buildings`, `items`, `rawResourceIds`) + Phase 2 `recipeRates: Map<recipeId, number>` (machine-equivalents @100%).
- One commit per task; messages end with:
  `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`

---

## Task 1: Physical / shard layer

**Files:**
- Create: `js/engine/physical-layer.js`
- Test: `test/engine/physical-layer.test.js`

**Interfaces:**
- Consumes: `Dataset` (recipes + buildings).
- Produces:
  - `shardsToReach(clock) → 0|1|2|3|Infinity`
  - `recipeOptions(load) → [{ machines, clock, shards }]`
  - `allocateShards(items, budget) → { chosen: Map<id,{machines,clock,shards}>, totalMachines, totalShards }` where `items = [{ id, options }]`
  - `realize({ dataset, recipeRates, shardBudget? }) → { perRecipe: [{recipeId, buildingId, machines, clock, shards, powerMW}], totalMachines, totalShardsUsed, totalPowerMW }`

- [ ] **Step 1: Write the failing test** — `test/engine/physical-layer.test.js`

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { shardsToReach, recipeOptions, allocateShards, realize } from '../../js/engine/physical-layer.js';

const approx = (a, b, e = 1e-4) => Math.abs(a - b) <= e;

test('shardsToReach: clock thresholds', () => {
  assert.equal(shardsToReach(0.9375), 0);
  assert.equal(shardsToReach(1.0), 0);
  assert.equal(shardsToReach(1.25), 1);
  assert.equal(shardsToReach(1.5), 1);
  assert.equal(shardsToReach(2.0), 2);
  assert.equal(shardsToReach(2.5), 3);
  assert.equal(shardsToReach(2.6), Infinity);
});

test('recipeOptions(7.5): frontier includes no-shard, 150%, and max overclock', () => {
  const o = recipeOptions(7.5);
  assert.deepEqual(o.find((x) => x.machines === 8), { machines: 8, clock: 7.5 / 8, shards: 0 });
  assert.deepEqual(o.find((x) => x.machines === 5), { machines: 5, clock: 1.5, shards: 5 });
  assert.deepEqual(o.find((x) => x.machines === 3), { machines: 3, clock: 2.5, shards: 9 });
});

test('allocateShards: DP minimizes machines within budget (non-convex frontier)', () => {
  const A = { id: 'A', options: recipeOptions(7.5) };
  const B = { id: 'B', options: recipeOptions(4) };
  assert.equal(allocateShards([A, B], 0).totalMachines, 12);
  assert.equal(allocateShards([A, B], 5).totalMachines, 9);
  assert.equal(allocateShards([A, B], 8).totalMachines, 8);
  assert.equal(allocateShards([A, B], 9).totalMachines, 7);
  assert.equal(allocateShards([A, B], 100).totalMachines, 5);
  // budget 5 spends exactly 5 on A -> 5 machines @150%
  const r5 = allocateShards([A, B], 5);
  assert.equal(r5.chosen.get('A').machines, 5);
  assert.equal(r5.chosen.get('A').shards, 5);
});

const dataset = {
  rawResourceIds: new Set(['ore']),
  items: new Map(),
  buildings: new Map([['bld', { id: 'bld', name: 'B', basePowerMW: 4, powerExponent: 1.321928 }]]),
  recipes: [
    { id: 'r1', name: 'r1', buildingId: 'bld', alternate: false, inputs: [{ itemId: 'ore', perMin: 20 }], outputs: [{ itemId: 'x', perMin: 10 }] },
  ],
};

test('realize: no shards -> ceil machines at even clock, exact power at 100%', () => {
  const r = realize({ dataset, recipeRates: new Map([['r1', 2]]), shardBudget: 0 });
  assert.equal(r.totalMachines, 2);           // load 2 -> 2 machines @ clock 1.0
  assert.equal(r.totalShardsUsed, 0);
  assert.equal(r.perRecipe[0].clock, 1);
  assert.equal(r.perRecipe[0].powerMW, 8);    // 2 * 4 * 1^exp = 8, exact
});

test('realize: shard budget consolidates machines and raises power', () => {
  const r = realize({ dataset, recipeRates: new Map([['r1', 2]]), shardBudget: 2 });
  assert.equal(r.totalMachines, 1);           // load 2 -> 1 machine @ 200%
  assert.equal(r.totalShardsUsed, 2);
  assert.equal(r.perRecipe[0].clock, 2);
  assert.ok(approx(r.perRecipe[0].powerMW, 4 * Math.pow(2, 1.321928))); // ~10 MW
});

test('realize: absorbs LP float noise via rounding', () => {
  const r = realize({ dataset, recipeRates: new Map([['r1', 1.99999999]]), shardBudget: 0 });
  assert.equal(r.totalMachines, 2);           // rounds to 2, not ceil(1.99999999)->2 anyway, but 2.0000001 would also -> 2
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/engine/physical-layer.test.js`
Expected: FAIL — `Cannot find module '.../js/engine/physical-layer.js'`.

- [ ] **Step 3: Write minimal implementation** — `js/engine/physical-layer.js`

```js
const EPS = 1e-9;
export const DEFAULT_POWER_EXPONENT = 1.321928;

/** Power shards needed to REACH a clock: ≤100%→0, ≤150%→1, ≤200%→2, ≤250%→3, else Infinity. */
export function shardsToReach(clock) {
  if (clock <= 1 + EPS) return 0;
  if (clock <= 1.5 + EPS) return 1;
  if (clock <= 2 + EPS) return 2;
  if (clock <= 2.5 + EPS) return 3;
  return Infinity;
}

/** Candidate {machines, clock, shards} for a recipe load (machine-equivalents @100%). */
export function recipeOptions(load) {
  if (load <= 0) return [{ machines: 0, clock: 0, shards: 0 }];
  const lo = Math.max(1, Math.ceil(load / 2.5 - EPS));
  const hi = Math.max(1, Math.ceil(load - EPS));
  const opts = [];
  for (let n = lo; n <= hi; n++) {
    const clock = load / n;
    const s = shardsToReach(clock);
    if (s !== Infinity) opts.push({ machines: n, clock, shards: n * s });
  }
  return opts;
}

/**
 * Minimize total machines subject to total shards ≤ budget (multiple-choice knapsack DP).
 * @param {{id:string, options:{machines,clock,shards}[]}[]} items
 * @param {number} budget
 */
export function allocateShards(items, budget) {
  const maxUseful = items.reduce((s, it) => s + Math.max(0, ...it.options.map((o) => o.shards)), 0);
  const B = Math.max(0, Math.min(budget, maxUseful));
  let dp = new Array(B + 1).fill(Infinity);
  dp[0] = 0;
  const choice = [];
  for (let i = 0; i < items.length; i++) {
    const ndp = new Array(B + 1).fill(Infinity);
    const ch = new Array(B + 1).fill(null);
    for (let b = 0; b <= B; b++) {
      if (dp[b] === Infinity) continue;
      for (const o of items[i].options) {
        const nb = b + o.shards;
        if (nb > B) continue;
        if (dp[b] + o.machines < ndp[nb]) {
          ndp[nb] = dp[b] + o.machines;
          ch[nb] = { machines: o.machines, clock: o.clock, shards: o.shards, prevB: b };
        }
      }
    }
    dp = ndp;
    choice.push(ch);
  }
  let bestB = 0, bestM = Infinity;
  for (let b = 0; b <= B; b++) if (dp[b] < bestM) { bestM = dp[b]; bestB = b; }
  const chosen = new Map();
  let b = bestB;
  for (let i = items.length - 1; i >= 0; i--) {
    const c = choice[i][b];
    chosen.set(items[i].id, { machines: c.machines, clock: c.clock, shards: c.shards });
    b = c.prevB;
  }
  return { chosen, totalMachines: bestM === Infinity ? 0 : bestM, totalShards: bestB };
}

const round6 = (x) => Math.round(x * 1e6) / 1e6;

/** Turn recipeRates into a physical build, spending shardBudget to minimize buildings. */
export function realize({ dataset, recipeRates, shardBudget = 0 }) {
  const byId = new Map(dataset.recipes.map((r) => [r.id, r]));
  const items = [];
  for (const [rid, raw] of recipeRates) {
    const load = round6(raw);
    if (load <= 0) continue;
    items.push({ id: rid, options: recipeOptions(load) });
  }
  const { chosen, totalMachines, totalShards } = allocateShards(items, shardBudget);
  const perRecipe = [];
  let totalPowerMW = 0;
  for (const [rid, sel] of chosen) {
    const recipe = byId.get(rid);
    const building = recipe ? dataset.buildings.get(recipe.buildingId) : undefined;
    const base = building?.basePowerMW ?? 0;
    const exp = building?.powerExponent ?? DEFAULT_POWER_EXPONENT;
    const powerMW = sel.machines * base * Math.pow(sel.clock, exp);
    totalPowerMW += powerMW;
    perRecipe.push({ recipeId: rid, buildingId: recipe?.buildingId ?? null, machines: sel.machines, clock: sel.clock, shards: sel.shards, powerMW });
  }
  return { perRecipe, totalMachines, totalShardsUsed: totalShards, totalPowerMW };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/engine/physical-layer.test.js`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git -C /Users/chong/Documents/GitHub/satisfactory-optimizer add js/engine/physical-layer.js test/engine/physical-layer.test.js
git -C /Users/chong/Documents/GitHub/satisfactory-optimizer commit -m "feat(engine): physical/shard layer (realize + shard-budget DP)" \
  -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Belt / pipe layer

**Files:**
- Create: `js/engine/belt-layer.js`
- Test: `test/engine/belt-layer.test.js`

**Interfaces:**
- Consumes: `Dataset` (recipes + items) + `recipeRates`.
- Produces:
  - `BELT_CAPACITY`, `PIPE_CAPACITY` (constant maps).
  - `beltReport({ dataset, recipeRates, beltTier?, pipeTier? }) → [{ itemId, rate, fluid, tier, lines, saturated }]` sorted by rate desc.

- [ ] **Step 1: Write the failing test** — `test/engine/belt-layer.test.js`

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { beltReport, BELT_CAPACITY, PIPE_CAPACITY } from '../../js/engine/belt-layer.js';

const io = (itemId, perMin) => ({ itemId, perMin });
const dataset = {
  rawResourceIds: new Set(['ore']),
  buildings: new Map(),
  items: new Map([
    ['ore', { id: 'ore', name: 'Ore', slug: 'ore', liquid: false }],
    ['ingot', { id: 'ingot', name: 'Ingot', slug: 'ingot', liquid: false }],
    ['water', { id: 'water', name: 'Water', slug: 'water', liquid: true }],
  ]),
  recipes: [
    { id: 'smelt', name: 'smelt', buildingId: 'b', alternate: false, inputs: [io('ore', 30)], outputs: [io('ingot', 30)] },
    { id: 'pump', name: 'pump', buildingId: 'b', alternate: false, inputs: [], outputs: [io('water', 300)] },
  ],
};

test('belt caps are the v1.2 tier values', () => {
  assert.equal(BELT_CAPACITY.Mk2, 120);
  assert.equal(BELT_CAPACITY.Mk4, 480);
  assert.equal(PIPE_CAPACITY.Mk2, 600);
});

test('beltReport: solid flow lines by tier', () => {
  const mk2 = beltReport({ dataset, recipeRates: new Map([['smelt', 12]]), beltTier: 'Mk2' });
  const ore2 = mk2.find((r) => r.itemId === 'ore');
  assert.equal(ore2.rate, 360);              // 12 * 30
  assert.equal(ore2.lines, 3);               // 360 / 120
  assert.equal(ore2.saturated, true);
  const mk4 = beltReport({ dataset, recipeRates: new Map([['smelt', 12]]), beltTier: 'Mk4' });
  assert.equal(mk4.find((r) => r.itemId === 'ore').lines, 1);   // 360 / 480
});

test('beltReport: fluids use pipe capacity', () => {
  const rep = beltReport({ dataset, recipeRates: new Map([['pump', 2]]), pipeTier: 'Mk2' });
  const w = rep.find((r) => r.itemId === 'water');
  assert.equal(w.fluid, true);
  assert.equal(w.rate, 600);                 // 2 * 300
  assert.equal(w.lines, 1);                  // 600 / 600
  assert.equal(w.saturated, false);
});

test('beltReport: sorted by rate descending', () => {
  const rep = beltReport({ dataset, recipeRates: new Map([['smelt', 12]]), beltTier: 'Mk2' });
  for (let i = 1; i < rep.length; i++) assert.ok(rep[i - 1].rate >= rep[i].rate);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/engine/belt-layer.test.js`
Expected: FAIL — `Cannot find module '.../js/engine/belt-layer.js'`.

- [ ] **Step 3: Write minimal implementation** — `js/engine/belt-layer.js`

```js
const EPS = 1e-9;
export const BELT_CAPACITY = { Mk1: 60, Mk2: 120, Mk3: 270, Mk4: 480, Mk5: 780, Mk6: 1200 };
export const PIPE_CAPACITY = { Mk1: 300, Mk2: 600 };

const round6 = (x) => Math.round(x * 1e6) / 1e6;

/**
 * Belt/pipe line counts per material flow. `rate` = max(produced, consumed) across the build.
 * @param {{dataset, recipeRates: Map, beltTier?: string, pipeTier?: string}} args
 */
export function beltReport({ dataset, recipeRates, beltTier = 'Mk4', pipeTier = 'Mk2' }) {
  const beltCap = BELT_CAPACITY[beltTier];
  const pipeCap = PIPE_CAPACITY[pipeTier];
  const byId = new Map(dataset.recipes.map((r) => [r.id, r]));
  const flows = new Map(); // itemId -> {produced, consumed}
  for (const [rid, load] of recipeRates) {
    if (load <= 0) continue;
    const r = byId.get(rid);
    if (!r) continue;
    for (const o of r.outputs) {
      const f = flows.get(o.itemId) || { produced: 0, consumed: 0 };
      f.produced += load * o.perMin;
      flows.set(o.itemId, f);
    }
    for (const i of r.inputs) {
      const f = flows.get(i.itemId) || { produced: 0, consumed: 0 };
      f.consumed += load * i.perMin;
      flows.set(i.itemId, f);
    }
  }
  const report = [];
  for (const [itemId, f] of flows) {
    const rate = round6(Math.max(f.produced, f.consumed));
    if (rate <= EPS) continue;
    const fluid = !!dataset.items.get(itemId)?.liquid;
    const cap = fluid ? pipeCap : beltCap;
    report.push({
      itemId,
      rate,
      fluid,
      tier: fluid ? pipeTier : beltTier,
      lines: Math.ceil(rate / cap - EPS),
      saturated: rate > cap + EPS,
    });
  }
  report.sort((a, b) => b.rate - a.rate);
  return report;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/engine/belt-layer.test.js`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git -C /Users/chong/Documents/GitHub/satisfactory-optimizer add js/engine/belt-layer.js test/engine/belt-layer.test.js
git -C /Users/chong/Documents/GitHub/satisfactory-optimizer commit -m "feat(engine): belt/pipe layer (lines per flow by tier)" \
  -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: End-to-end integration test (optimize → realize → belts)

Ties Phase 2 + Phase 3 together, offline, on the iron-chain fixture. Confirms the full pipeline produces the hand-verified build (max 15 Modular Frames from 360 ore → 50 machines at 0 shards; ore needs 3 Mk.2 belts / 1 Mk.4 belt).

**Files:**
- Test: `test/engine/phase3-integration.test.js`

**Interfaces:**
- Consumes: `maxOutput` (Phase 2), `realize` + `beltReport` (Phase 3), `ironChain` fixture (Phase 2).

- [ ] **Step 1: Write the test** — `test/engine/phase3-integration.test.js`

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { maxOutput } from '../../js/engine/optimize.js';
import { realize } from '../../js/engine/physical-layer.js';
import { beltReport } from '../../js/engine/belt-layer.js';
import { ironChain, ALL_IRON_RECIPES, capsIron } from '../fixtures/iron-chain.js';

test('optimize -> realize: 15 Modular Frames build is 50 machines at 0 shards', () => {
  const { recipeRates } = maxOutput({ dataset: ironChain, caps: capsIron(360), enabledRecipeIds: ALL_IRON_RECIPES, targetItemId: 'mf' });
  const r = realize({ dataset: ironChain, recipeRates, shardBudget: 0 });
  assert.equal(r.totalMachines, 50);          // ceil: ingot12 plate7 rod11 screw7 rip5 mf8
  assert.equal(r.totalShardsUsed, 0);
});

test('optimize -> realize: a shard budget reduces total machines', () => {
  const { recipeRates } = maxOutput({ dataset: ironChain, caps: capsIron(360), enabledRecipeIds: ALL_IRON_RECIPES, targetItemId: 'mf' });
  const r = realize({ dataset: ironChain, recipeRates, shardBudget: 30 });
  assert.ok(r.totalMachines < 50, `expected < 50, got ${r.totalMachines}`);
  assert.ok(r.totalShardsUsed <= 30);
});

test('optimize -> belts: ore needs 3 Mk.2 belts, 1 Mk.4 belt', () => {
  const { recipeRates } = maxOutput({ dataset: ironChain, caps: capsIron(360), enabledRecipeIds: ALL_IRON_RECIPES, targetItemId: 'mf' });
  const mk2 = beltReport({ dataset: ironChain, recipeRates, beltTier: 'Mk2' });
  assert.equal(mk2.find((r) => r.itemId === 'ore').lines, 3);
  const mk4 = beltReport({ dataset: ironChain, recipeRates, beltTier: 'Mk4' });
  assert.equal(mk4.find((r) => r.itemId === 'ore').lines, 1);
});
```

- [ ] **Step 2: Run the test**

Run: `node --test test/engine/phase3-integration.test.js`
Expected: PASS (3 tests).

- [ ] **Step 3: Run the whole suite**

Run: `npm test`
Expected: PASS — Phase 1 (25) + Phase 2 (14) + Phase 3 (7 + 4 + 3 = 14) = **53 tests**.

- [ ] **Step 4: Commit**

```bash
git -C /Users/chong/Documents/GitHub/satisfactory-optimizer add test/engine/phase3-integration.test.js
git -C /Users/chong/Documents/GitHub/satisfactory-optimizer commit -m "test(engine): end-to-end optimize -> realize -> belts on iron chain" \
  -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Phase 3 Definition of Done

- `npm test` passes (~53 tests).
- `js/engine/physical-layer.js` + `js/engine/belt-layer.js` exist, pure (no DOM/network), importing only Phase 1/2 modules.
- Public API for Phase 4 (UI): `realize(...)` → machines/clock/shards/power per recipe + totals; `beltReport(...)` → lines per flow. Together with Phase 2's `maxOutput`/`hitTargets`, the UI now has everything to render a full build.
