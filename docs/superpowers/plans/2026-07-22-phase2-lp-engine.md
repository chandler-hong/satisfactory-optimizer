# Phase 2: LP Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Given a `Dataset` (Phase 1) + resource caps + enabled recipes, compute optimal production via linear programming in two modes — maximize one target item, or hit target rates with shortfall reporting — returning per-recipe run-rates.

**Architecture:** A vendored zero-dep LP solver (jsLPSolver browser ESM build) does the math. `lp-builder.js` (pure) turns a `Dataset` + request into a jsLPSolver model; `solver.js` is a thin wrapper that normalizes the result; `optimize.js` orchestrates the two modes (a two-pass lexicographic max, and a slack-penalized target-rates solve). The whole engine is offline-testable with Node's runner against a hand-built iron-chain fixture whose answers are known by hand (360 iron → 15 Modular Frames or 32 Rotors).

**Tech Stack:** JavaScript ES modules, Node's built-in test runner, one vendored file (`javascript-lp-solver@1.0.3`, MIT). No build step, no other dependencies.

## Global Constraints

- Target game version: **Satisfactory v1.2**. All rates per-minute.
- **No build step.** Vanilla ES modules; `package.json` already has `"type": "module"`. Tests via `npm test` (scoped to `test/**/*.test.js`).
- **Vendored solver:** `js/vendor/solver.mjs` = `javascript-lp-solver@1.0.3` `dist/index.browser.mjs` (self-contained, zero-dep ESM; default export has `.Solve`). Source pinned to that exact version. MIT — keep attribution in `js/vendor/README.md`.
- **jsLPSolver model format:** `{ optimize: <attrName>, opType: 'max'|'min', constraints: { <name>: {max|min|equal} }, variables: { <varName>: { <attr>: <coef> } } }`. Result: `{ feasible, result: <objective>, bounded, isIntegral, <varName>: <value> }`. Variables are **≥ 0 by default**. Only non-zero variables appear in the result.
- **LP conventions (verified by prototype — use exactly):**
  - One variable per enabled recipe; its value = number of machines running at 100%.
  - For a **raw** item the recipe touches: coefficient = `input − output` (net consumption); constrained by `{ max: cap }`.
  - For a **non-raw** item: coefficient = `netPerMin` (`output − input`); constrained by `{ min: 0 }` (surplus allowed) — or `{ equal: 0 }` when `noWaste`.
  - Reserved objective attributes: `'_objective_'` = `netPerMin(recipe, targetItem)`; `'_rawcost_'` = Σ raw consumption per machine.
  - **Max mode = two passes (lexicographic):** pass 1 maximizes `_objective_` → `M*`; pass 2 constrains `_objective_ ≥ M* − tiny` and minimizes `_rawcost_` (least raw among optimal solutions).
  - **Target-rates mode:** each target `t` gets constraint `{ min: d_t }` plus a slack variable `'_slack_<t>'` with coefficient `1` on `t` and `_rawcost_` penalty `1e6`; minimize `_rawcost_`. A slack value > 1e-6 is that target's shortfall.
  - Do **not** put extra keys on the model object handed to `Solve`.
- **LP output has float noise** (e.g. `11.99999999`): all numeric assertions on solver/optimize output use a tolerance (`approx(a, b, 1e-6)`), never strict `===`. (Booleans like `feasible` are exact.)
- Fluids are already in m³ in the dataset (Phase 1) — irrelevant here since the engine consumes `Dataset.recipes[].{inputs,outputs}[].perMin` directly.
- One commit per task. Commit messages end with:
  `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`
- Consumes from Phase 1 (already on `main`): `js/domain/model.js` → `netPerMin(recipe, itemId)`; `js/data/loader.js` → `loadDataset(...)`; `Dataset = { items:Map, buildings:Map, recipes:Recipe[], rawResourceIds:Set }`.

---

## Task 1: Vendor the LP solver

**Files:**
- Create: `js/vendor/solver.mjs` (downloaded build artifact)
- Create: `js/vendor/README.md`
- Test: `test/engine/vendor-solver.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces: `js/vendor/solver.mjs` default export `solver` with `solver.Solve(model)`.

- [ ] **Step 1: Download the vendored solver**

Run:
```bash
cd /Users/chong/Documents/GitHub/satisfactory-optimizer
mkdir -p js/vendor
node -e "const{writeFileSync}=require('fs');fetch('https://cdn.jsdelivr.net/npm/javascript-lp-solver@1.0.3/dist/index.browser.mjs',{signal:AbortSignal.timeout(30000)}).then(r=>{if(!r.ok)throw new Error('HTTP '+r.status);return r.text()}).then(t=>{writeFileSync('js/vendor/solver.mjs',t);console.log('vendored',t.length,'bytes')}).catch(e=>{console.error(e);process.exit(1)})"
```
Expected: `vendored 171501 bytes` (or very close). If the byte count differs, that's fine as long as Step 4 passes.

- [ ] **Step 2: Write the attribution file** — `js/vendor/README.md`

```markdown
# Vendored dependency

`solver.mjs` is `dist/index.browser.mjs` from **javascript-lp-solver@1.0.3**
(https://github.com/JWally/jsLPSolver), MIT licensed. Self-contained, zero-dependency
ES module; default export `solver` exposes `solver.Solve(model)`.

Fetched via jsDelivr:
`https://cdn.jsdelivr.net/npm/javascript-lp-solver@1.0.3/dist/index.browser.mjs`

Do not edit by hand. To update, bump the pinned version and re-download.
```

- [ ] **Step 3: Write the failing test** — `test/engine/vendor-solver.test.js`

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import solver from '../../js/vendor/solver.mjs';

test('vendored solver solves the Berlin Airlift LP', () => {
  const model = {
    optimize: 'capacity', opType: 'max',
    constraints: { plane: { max: 44 }, person: { max: 512 }, cost: { max: 300000 } },
    variables: {
      brit: { capacity: 20000, plane: 1, person: 8, cost: 5000 },
      yank: { capacity: 30000, plane: 1, person: 16, cost: 9000 },
    },
  };
  const r = solver.Solve(model);
  assert.equal(r.feasible, true);
  assert.equal(r.result, 1080000);
  assert.equal(r.brit, 24);
  assert.equal(r.yank, 20);
});
```

- [ ] **Step 4: Run the test (it must pass immediately — the vendored file already exists)**

Run: `node --test test/engine/vendor-solver.test.js`
Expected: PASS (1 test). (There is no RED step here: Step 1 already produced the module. If the import fails, the download in Step 1 did not succeed — re-run it.)

- [ ] **Step 5: Commit**

```bash
git -C /Users/chong/Documents/GitHub/satisfactory-optimizer add js/vendor/solver.mjs js/vendor/README.md test/engine/vendor-solver.test.js
git -C /Users/chong/Documents/GitHub/satisfactory-optimizer commit -m "chore(engine): vendor javascript-lp-solver@1.0.3 (browser ESM)" \
  -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: LP model builder

**Files:**
- Create: `js/engine/lp-builder.js`
- Test: `test/engine/lp-builder.test.js`

**Interfaces:**
- Consumes: `netPerMin` from `js/domain/model.js`; `Dataset` shape.
- Produces:
  - `buildMaxModel({ dataset, caps, enabledRecipeIds, targetItemId, noWaste? }) → model`
  - `buildMinRawModel(sameArgs, minTarget) → model`
  - `buildTargetRatesModel({ dataset, caps, enabledRecipeIds, targets, noWaste? }) → model`
  - Exported constants `OBJ = '_objective_'`, `RAWCOST = '_rawcost_'`.
  - `caps` is a `Map<itemId, number>`; `targets` is a `Map<itemId, number>` or plain object.

- [ ] **Step 1: Write the failing test** — `test/engine/lp-builder.test.js`

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildMaxModel, buildMinRawModel, buildTargetRatesModel, OBJ, RAWCOST } from '../../js/engine/lp-builder.js';

// tiny synthetic dataset: ore(raw) -> ingot -> plate
const io = (itemId, perMin) => ({ itemId, perMin });
const dataset = {
  rawResourceIds: new Set(['ore']),
  recipes: [
    { id: 'ingot', name: 'ingot', buildingId: 'b', alternate: false, inputs: [io('ore', 30)], outputs: [io('ingot', 30)] },
    { id: 'plate', name: 'plate', buildingId: 'b', alternate: false, inputs: [io('ingot', 30)], outputs: [io('plate', 20)] },
  ],
};
const ALL = new Set(['ingot', 'plate']);
const caps = new Map([['ore', 60]]);

test('buildMaxModel: raw uses net-consumption coef + {max}, non-raw uses netPerMin + {min:0}, target excluded from constraints', () => {
  const m = buildMaxModel({ dataset, caps, enabledRecipeIds: ALL, targetItemId: 'plate' });
  assert.equal(m.optimize, OBJ);
  assert.equal(m.opType, 'max');
  // raw constraint
  assert.deepEqual(m.constraints.ore, { max: 60 });
  // intermediate balance
  assert.deepEqual(m.constraints.ingot, { min: 0 });
  // target (plate) is the objective, NOT a constraint
  assert.equal(m.constraints.plate, undefined);
  // ingot variable: consumes 30 ore (raw coef = input-output = 30), produces 30 ingot (net)
  assert.equal(m.variables.ingot.ore, 30);
  assert.equal(m.variables.ingot.ingot, 30);
  assert.equal(m.variables.ingot[RAWCOST], 30);
  assert.equal(m.variables.ingot[OBJ], 0);       // ingot recipe makes no plate
  // plate variable: consumes 30 ingot (net -30), makes 20 plate; objective coef = 20
  assert.equal(m.variables.plate.ingot, -30);
  assert.equal(m.variables.plate[OBJ], 20);
  assert.equal(m.variables.plate[RAWCOST], 0);   // consumes no raw directly
});

test('buildMaxModel: noWaste turns intermediate balance into {equal:0}', () => {
  const m = buildMaxModel({ dataset, caps, enabledRecipeIds: ALL, targetItemId: 'plate', noWaste: true });
  assert.deepEqual(m.constraints.ingot, { equal: 0 });
});

test('buildMinRawModel: minimizes rawcost with target lower-bounded', () => {
  const m = buildMinRawModel({ dataset, caps, enabledRecipeIds: ALL, targetItemId: 'plate' }, 20);
  assert.equal(m.optimize, RAWCOST);
  assert.equal(m.opType, 'min');
  assert.ok(m.constraints[OBJ].min <= 20 && m.constraints[OBJ].min > 19.9); // >= ~20 with tiny relax
});

test('buildTargetRatesModel: adds slack var + target min-constraint, minimizes rawcost', () => {
  const m = buildTargetRatesModel({ dataset, caps, enabledRecipeIds: ALL, targets: { plate: 10 } });
  assert.equal(m.optimize, RAWCOST);
  assert.equal(m.opType, 'min');
  assert.deepEqual(m.constraints.plate, { min: 10 });
  assert.equal(m.variables._slack_plate.plate, 1);
  assert.equal(m.variables._slack_plate[RAWCOST], 1e6);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/engine/lp-builder.test.js`
Expected: FAIL — `Cannot find module '.../js/engine/lp-builder.js'`.

- [ ] **Step 3: Write minimal implementation** — `js/engine/lp-builder.js`

```js
import { netPerMin } from '../domain/model.js';

export const OBJ = '_objective_';
export const RAWCOST = '_rawcost_';

// Build the per-recipe variable coefficient maps + the raw/non-raw item sets.
// Shared by every mode. Returns { variables, touchedRaw, touchedNonRaw }.
function buildVariables(dataset, enabledRecipeIds) {
  const raw = dataset.rawResourceIds;
  const variables = {};
  const touchedRaw = new Set();
  const touchedNonRaw = new Set();
  for (const r of dataset.recipes) {
    if (!enabledRecipeIds.has(r.id)) continue;
    const v = {};
    const items = new Set([...r.inputs.map((e) => e.itemId), ...r.outputs.map((e) => e.itemId)]);
    let rawcost = 0;
    for (const itemId of items) {
      const net = netPerMin(r, itemId);          // output - input
      if (raw.has(itemId)) {
        v[itemId] = -net;                        // net consumption for the {max: cap} constraint
        touchedRaw.add(itemId);
        if (-net > 0) rawcost += -net;
      } else {
        v[itemId] = net;                         // net production for the {min: 0} balance
        touchedNonRaw.add(itemId);
      }
    }
    v[RAWCOST] = rawcost;
    variables[r.id] = v;
  }
  return { variables, touchedRaw, touchedNonRaw };
}

function rawConstraints(touchedRaw, caps) {
  const c = {};
  for (const res of touchedRaw) c[res] = { max: caps.get(res) ?? 0 };
  return c;
}

export function buildMaxModel({ dataset, caps, enabledRecipeIds, targetItemId, noWaste = false }) {
  const { variables, touchedRaw, touchedNonRaw } = buildVariables(dataset, enabledRecipeIds);
  for (const id of Object.keys(variables)) {
    const r = dataset.recipes.find((x) => x.id === id);
    variables[id][OBJ] = netPerMin(r, targetItemId);
  }
  const constraints = rawConstraints(touchedRaw, caps);
  for (const i of touchedNonRaw) {
    if (i === targetItemId) continue;            // target is the objective, not a constraint
    constraints[i] = noWaste ? { equal: 0 } : { min: 0 };
  }
  return { optimize: OBJ, opType: 'max', constraints, variables };
}

export function buildMinRawModel(args, minTarget) {
  const model = buildMaxModel(args);
  model.constraints[OBJ] = { min: minTarget - Math.abs(minTarget) * 1e-9 - 1e-9 };
  model.optimize = RAWCOST;
  model.opType = 'min';
  return model;
}

export function buildTargetRatesModel({ dataset, caps, enabledRecipeIds, targets, noWaste = false }) {
  const targetMap = targets instanceof Map ? targets : new Map(Object.entries(targets));
  const { variables, touchedRaw, touchedNonRaw } = buildVariables(dataset, enabledRecipeIds);
  const constraints = rawConstraints(touchedRaw, caps);
  for (const i of touchedNonRaw) {
    if (targetMap.has(i)) continue;              // targets get their own {min: d} below
    constraints[i] = noWaste ? { equal: 0 } : { min: 0 };
  }
  for (const [t, d] of targetMap) {
    constraints[t] = { min: d };
    variables[`_slack_${t}`] = { [t]: 1, [RAWCOST]: 1e6 };
  }
  return { optimize: RAWCOST, opType: 'min', constraints, variables };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/engine/lp-builder.test.js`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git -C /Users/chong/Documents/GitHub/satisfactory-optimizer add js/engine/lp-builder.js test/engine/lp-builder.test.js
git -C /Users/chong/Documents/GitHub/satisfactory-optimizer commit -m "feat(engine): LP model builder (max, min-raw, target-rates)" \
  -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Solver wrapper

**Files:**
- Create: `js/engine/solver.js`
- Test: `test/engine/solver.test.js`

**Interfaces:**
- Consumes: `js/vendor/solver.mjs` (Task 1).
- Produces: `solveModel(model) → { feasible: boolean, bounded: boolean, objective: number, values: Record<string, number> }`. `values` excludes the meta keys `feasible/result/bounded/isIntegral`.

- [ ] **Step 1: Write the failing test** — `test/engine/solver.test.js`

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { solveModel } from '../../js/engine/solver.js';

const approx = (a, b, e = 1e-6) => Math.abs(a - b) <= e;

test('solveModel returns normalized result with variable values only', () => {
  const model = {
    optimize: 'capacity', opType: 'max',
    constraints: { plane: { max: 44 }, person: { max: 512 }, cost: { max: 300000 } },
    variables: {
      brit: { capacity: 20000, plane: 1, person: 8, cost: 5000 },
      yank: { capacity: 30000, plane: 1, person: 16, cost: 9000 },
    },
  };
  const r = solveModel(model);
  assert.equal(r.feasible, true);
  assert.ok(approx(r.objective, 1080000));
  assert.ok(approx(r.values.brit, 24));
  assert.ok(approx(r.values.yank, 20));
  // meta keys must not leak into values
  assert.equal('feasible' in r.values, false);
  assert.equal('result' in r.values, false);
  assert.equal('bounded' in r.values, false);
});

test('solveModel reports infeasible models', () => {
  const model = {
    optimize: 'x', opType: 'max',
    constraints: { a: { min: 10, max: 5 } },  // impossible
    variables: { v: { a: 1, x: 1 } },
  };
  const r = solveModel(model);
  assert.equal(r.feasible, false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/engine/solver.test.js`
Expected: FAIL — `Cannot find module '.../js/engine/solver.js'`.

- [ ] **Step 3: Write minimal implementation** — `js/engine/solver.js`

```js
import solver from '../vendor/solver.mjs';

const META = new Set(['feasible', 'result', 'bounded', 'isIntegral']);

/**
 * Solve a jsLPSolver model and normalize the result.
 * @param {object} model
 * @returns {{feasible: boolean, bounded: boolean, objective: number, values: Record<string, number>}}
 */
export function solveModel(model) {
  const raw = solver.Solve(model);
  const values = {};
  for (const k of Object.keys(raw)) if (!META.has(k)) values[k] = raw[k];
  return {
    feasible: !!raw.feasible,
    bounded: raw.bounded !== false,
    objective: typeof raw.result === 'number' ? raw.result : 0,
    values,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/engine/solver.test.js`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git -C /Users/chong/Documents/GitHub/satisfactory-optimizer add js/engine/solver.js test/engine/solver.test.js
git -C /Users/chong/Documents/GitHub/satisfactory-optimizer commit -m "feat(engine): solver wrapper normalizing jsLPSolver output" \
  -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Optimizer (both modes) + iron-chain fixture

**Files:**
- Create: `test/fixtures/iron-chain.js`
- Create: `js/engine/optimize.js`
- Test: `test/engine/optimize.test.js`

**Interfaces:**
- Consumes: `buildMaxModel`, `buildMinRawModel`, `buildTargetRatesModel` (Task 2); `solveModel` (Task 3).
- Produces:
  - `maxOutput({ dataset, caps, enabledRecipeIds, targetItemId, noWaste? }) → { feasible, maxRate, recipeRates: Map<recipeId, machines> }`
  - `hitTargets({ dataset, caps, enabledRecipeIds, targets, noWaste? }) → { feasible, recipeRates: Map, shortfalls: Map<itemId, number>, bindingResources: string[] }`

- [ ] **Step 1: Create the fixture** — `test/fixtures/iron-chain.js`

```js
// Minimal normalized Dataset for the standard iron chain (per-minute rates).
// Hand-verified answers from 360 iron ore: max Modular Frame = 15/min, max Rotor = 32/min.
const io = (itemId, perMin) => ({ itemId, perMin });
const R = (id, inputs, outputs) => ({ id, name: id, buildingId: 'b', alternate: false, inputs, outputs });

export const ironChain = {
  items: new Map(),        // unused by the LP engine
  buildings: new Map(),    // unused by the LP engine
  rawResourceIds: new Set(['ore']),
  recipes: [
    R('ingot', [io('ore', 30)], [io('ingot', 30)]),
    R('plate', [io('ingot', 30)], [io('plate', 20)]),
    R('rod',   [io('ingot', 15)], [io('rod', 15)]),
    R('screw', [io('rod', 10)], [io('screw', 40)]),
    R('rip',   [io('plate', 30), io('screw', 60)], [io('rip', 5)]),
    R('mf',    [io('rip', 3), io('rod', 12)], [io('mf', 2)]),
    R('rotor', [io('rod', 20), io('screw', 100)], [io('rotor', 4)]),
  ],
};

export const ALL_IRON_RECIPES = new Set(ironChain.recipes.map((r) => r.id));
export const capsIron = (n) => new Map([['ore', n]]);
```

- [ ] **Step 2: Write the failing test** — `test/engine/optimize.test.js`

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { maxOutput, hitTargets } from '../../js/engine/optimize.js';
import { ironChain, ALL_IRON_RECIPES, capsIron } from '../fixtures/iron-chain.js';

const approx = (a, b, e = 1e-5) => Math.abs(a - b) <= e;

test('maxOutput: 360 iron -> 15 Modular Frames/min', () => {
  const r = maxOutput({ dataset: ironChain, caps: capsIron(360), enabledRecipeIds: ALL_IRON_RECIPES, targetItemId: 'mf' });
  assert.equal(r.feasible, true);
  assert.ok(approx(r.maxRate, 15), `expected ~15, got ${r.maxRate}`);
  // the mf recipe makes 2/machine, so 7.5 machines -> 15/min
  assert.ok(approx(r.recipeRates.get('mf'), 7.5), `mf machines ${r.recipeRates.get('mf')}`);
});

test('maxOutput: 360 iron -> 32 Rotors/min', () => {
  const r = maxOutput({ dataset: ironChain, caps: capsIron(360), enabledRecipeIds: ALL_IRON_RECIPES, targetItemId: 'rotor' });
  assert.equal(r.feasible, true);
  assert.ok(approx(r.maxRate, 32), `expected ~32, got ${r.maxRate}`);
});

test('maxOutput: zero caps -> feasible with zero output', () => {
  const r = maxOutput({ dataset: ironChain, caps: capsIron(0), enabledRecipeIds: ALL_IRON_RECIPES, targetItemId: 'mf' });
  assert.ok(approx(r.maxRate, 0));
});

test('hitTargets: {16 rotor, 7.5 mf} feasible at 360 iron, no shortfall', () => {
  const r = hitTargets({ dataset: ironChain, caps: capsIron(360), enabledRecipeIds: ALL_IRON_RECIPES, targets: { rotor: 16, mf: 7.5 } });
  assert.equal(r.feasible, true);
  assert.equal(r.shortfalls.size, 0);
  assert.ok(r.bindingResources.includes('ore'));   // ore is fully used
});

test('hitTargets: same targets infeasible at 359 iron, reports Modular Frame shortfall', () => {
  const r = hitTargets({ dataset: ironChain, caps: capsIron(359), enabledRecipeIds: ALL_IRON_RECIPES, targets: { rotor: 16, mf: 7.5 } });
  assert.equal(r.feasible, false);
  assert.ok(r.shortfalls.get('mf') > 0, 'expected a Modular Frame shortfall');
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `node --test test/engine/optimize.test.js`
Expected: FAIL — `Cannot find module '.../js/engine/optimize.js'`.

- [ ] **Step 4: Write minimal implementation** — `js/engine/optimize.js`

```js
import { buildMaxModel, buildMinRawModel, buildTargetRatesModel } from './lp-builder.js';
import { solveModel } from './solver.js';

function ratesFrom(values, enabledRecipeIds) {
  const m = new Map();
  for (const [k, v] of Object.entries(values)) {
    if (enabledRecipeIds.has(k) && v > 1e-9) m.set(k, v);
  }
  return m;
}

function bindingResources(dataset, caps, recipeRates) {
  const usage = new Map();
  const byId = new Map(dataset.recipes.map((r) => [r.id, r]));
  for (const [rid, x] of recipeRates) {
    const r = byId.get(rid);
    if (!r) continue;
    for (const inp of r.inputs) {
      if (dataset.rawResourceIds.has(inp.itemId)) usage.set(inp.itemId, (usage.get(inp.itemId) || 0) + x * inp.perMin);
    }
    for (const out of r.outputs) {
      if (dataset.rawResourceIds.has(out.itemId)) usage.set(out.itemId, (usage.get(out.itemId) || 0) - x * out.perMin);
    }
  }
  const binding = [];
  for (const [res, cap] of caps) {
    if (cap > 0 && (usage.get(res) || 0) >= cap - 1e-6) binding.push(res);
  }
  return binding;
}

/** Maximize one target item's output. Two-pass lexicographic (max, then min raw). */
export function maxOutput({ dataset, caps, enabledRecipeIds, targetItemId, noWaste = false }) {
  const args = { dataset, caps, enabledRecipeIds, targetItemId, noWaste };
  const r1 = solveModel(buildMaxModel(args));
  if (!r1.feasible) return { feasible: false, maxRate: 0, recipeRates: new Map() };
  const maxRate = r1.objective;
  const r2 = solveModel(buildMinRawModel(args, maxRate));
  const chosen = r2.feasible ? r2 : r1;
  return { feasible: true, maxRate, recipeRates: ratesFrom(chosen.values, enabledRecipeIds) };
}

/** Hit target rates with minimum raw usage; slack variables report shortfalls. */
export function hitTargets({ dataset, caps, enabledRecipeIds, targets, noWaste = false }) {
  const targetMap = targets instanceof Map ? targets : new Map(Object.entries(targets));
  const r = solveModel(buildTargetRatesModel({ dataset, caps, enabledRecipeIds, targets: targetMap, noWaste }));
  const shortfalls = new Map();
  for (const t of targetMap.keys()) {
    const s = r.values[`_slack_${t}`] || 0;
    if (s > 1e-6) shortfalls.set(t, s);
  }
  const recipeRates = ratesFrom(r.values, enabledRecipeIds);
  return {
    feasible: shortfalls.size === 0,
    recipeRates,
    shortfalls,
    bindingResources: bindingResources(dataset, caps, recipeRates),
  };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `node --test test/engine/optimize.test.js`
Expected: PASS (5 tests).

- [ ] **Step 6: Run the whole suite**

Run: `npm test`
Expected: PASS — all files. (25 from Phase 1 + Task1 1 + Task2 4 + Task3 2 + Task4 5 = 37 tests.)

- [ ] **Step 7: Commit**

```bash
git -C /Users/chong/Documents/GitHub/satisfactory-optimizer add js/engine/optimize.js test/engine/optimize.test.js test/fixtures/iron-chain.js
git -C /Users/chong/Documents/GitHub/satisfactory-optimizer commit -m "feat(engine): optimizer maxOutput + hitTargets with iron-chain ground truth" \
  -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Real-data optimize smoke check

Validates the full pipeline (Phase 1 loader → normalize → LP engine) against the **real** pinned dataset: with only standard (non-alternate) recipes and 360 iron ore, max Modular Frame should be 15/min. Hits the network; a script, not part of `npm test`.

**Files:**
- Create: `scripts/verify-optimize.mjs`

**Interfaces:**
- Consumes: `loadDataset` (Phase 1), `maxOutput` (Task 4).

- [ ] **Step 1: Write the script** — `scripts/verify-optimize.mjs`

```js
// Real-data optimize smoke check. Run: node scripts/verify-optimize.mjs
import { loadDataset } from '../js/data/loader.js';
import { maxOutput } from '../js/engine/optimize.js';

const ds = await loadDataset({ storage: { getItem: () => null, setItem: () => {} } }); // fresh fetch

const IRON_ORE = 'Desc_OreIron_C';
const mf = [...ds.items.values()].find((i) => i.name === 'Modular Frame');
if (!mf) { console.error('FAIL: Modular Frame item not found'); process.exit(1); }

// Standard recipes only (exclude alternates), so the answer is the deterministic base chain.
const standard = new Set(ds.recipes.filter((r) => !r.alternate).map((r) => r.id));
const caps = new Map([[IRON_ORE, 360]]);

const res = maxOutput({ dataset: ds, caps, enabledRecipeIds: standard, targetItemId: mf.id });
console.log(`max Modular Frame from 360 iron (standard recipes): ${res.maxRate.toFixed(4)}/min`);

if (Math.abs(res.maxRate - 15) > 1e-2) {
  console.error(`FAIL: expected ~15/min, got ${res.maxRate}`);
  console.error('Recipe machines:', JSON.stringify([...res.recipeRates].slice(0, 20)));
  process.exit(1);
}
console.log('\nReal-data optimize smoke passed: 360 iron -> 15 Modular Frames/min via the standard chain.');
```

- [ ] **Step 2: Run it**

Run: `node /Users/chong/Documents/GitHub/satisfactory-optimizer/scripts/verify-optimize.mjs`
Expected: prints `~15.0000/min` and `Real-data optimize smoke passed`.
**If it prints a different max** (not ~15): do NOT edit engine files to force it. Report DONE_WITH_CONCERNS with the printed value and the recipe list — the controller decides (e.g. the standard-recipe filter or the target's item id may need adjusting for the real data).

- [ ] **Step 3: Commit**

```bash
git -C /Users/chong/Documents/GitHub/satisfactory-optimizer add scripts/verify-optimize.mjs
git -C /Users/chong/Documents/GitHub/satisfactory-optimizer commit -m "test(engine): real-data optimize smoke (360 iron -> 15 modular frames)" \
  -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Phase 2 Definition of Done

- `npm test` passes (Phase 1's 25 + Phase 2's 12 = **37 tests**).
- `node scripts/verify-optimize.mjs` passes against the real pinned dataset.
- `js/vendor/solver.mjs`, `js/engine/{lp-builder,solver,optimize}.js` exist; engine modules are pure (no DOM, no network) and import only each other + the vendored solver.
- Public API for Phase 3/4: `maxOutput(...)` and `hitTargets(...)` return per-recipe machine-rate Maps that the physical/shard layer will consume.
