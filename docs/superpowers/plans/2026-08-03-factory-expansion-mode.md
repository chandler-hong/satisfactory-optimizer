# Factory Expansion Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a fourth view, **🧱 Expansion**, that takes declared machine blocks (`6× Assembler → Motor`) plus existing supply (`Rubber @ 300/min`) and reports the upstream machines to build, the ore still needed, and progress toward milestone / Space Elevator goals.

**Architecture:** Blocks are *pinned* production, not solved for. Their net per-minute balance splits by sign: negative non-raw becomes an LP target, negative raw goes straight to the raw footer, positive becomes a free capped supply. The residual runs through the existing `hitTargets` LP with one new primitive — a supply variable — then through the existing `realize` / `beltReport` / `analyzeRequirements` layers. Pure engine modules, DOM-only view modules, no new dependencies.

**Tech Stack:** Vanilla ES modules, zero build step, zero npm dependencies. Tests are `node --test` with pure unit tests and minimal DOM stubs. The LP solver is the vendored `js/vendor/solver.mjs`.

**Spec:** `docs/superpowers/specs/2026-08-03-factory-expansion-mode-design.md`

## Global Constraints

- **Zero dependencies.** No npm packages, no build step, no bundler. Browser-native ES modules only.
- **Node ≥ 21** (`package.json` `engines`). Run tests with `npm test`, which is `node --test "test/**/*.test.js"`. Do **not** run `node --test test/` — that glob form reports a spurious single failure.
- **Baseline: 127/127 tests passing.** Every task must end green. Never reduce the count.
- **`test/fixtures/mini-data.js` MUST NOT be modified** — `test/data/normalize.test.js` asserts `recipes.length === 2`. New fixtures go in new files.
- **Pure modules under `js/engine/` and `js/domain/`** — no DOM, no `localStorage`, no network. DOM lives only in `js/ui/`.
- **All `localStorage` access wrapped in try/catch.** Reading `globalThis.localStorage` can itself throw (SecurityError in sandboxed contexts). Follow `js/ui/power.js:113-117`.
- **CSS uses existing tokens only:** `--accent`, `--surface`, `--border`, `--ink`, `--ink-2`. Any rule overriding icon size must use the `:is(.icon, .icon-fallback)` form so a failed image load keeps row layout. Inputs keep a 44px minimum tap target.
- **Commit per task**, conventional-commit style matching `git log` (`feat(engine):`, `fix(ui):`, `test(domain):`, `refactor(ui):`, `docs:`). End every commit message with:
  ```
  Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
  ```
- **Work directly on `main`.** No feature branches or worktrees for this repo.

## File Structure

| File | Responsibility | Status |
|---|---|---|
| `js/data/normalize.js` | + `dataset.goals` from `EST_Milestone` schematics | modify |
| `js/domain/model.js` | + `Goal` typedef, `goals` on `Dataset` | modify |
| `js/engine/lp-builder.js` | + `supplies` support in the target-rates model | modify |
| `js/engine/optimize.js` | thread `supplies` through `hitTargets`, return `supplyDrawn` | modify |
| `js/engine/expansion.js` | `planExpansion` — pin, split, solve, realize, shape | create |
| `js/domain/goals.js` | milestone + phase catalog, goal evaluation | create |
| `js/ui/search-select.js` | the searchable combobox, extracted from `inputs.js` | create |
| `js/ui/inputs.js` | import the combobox instead of defining it | modify |
| `js/ui/expansion.js` | the Expansion view (DOM only) | create |
| `js/engine/graph.js` | `buildGraph`, extracted from `view-model.js` (Task 9) | create |
| `js/ui/view-model.js` | import `buildGraph` instead of defining it (Task 9) | modify |
| `index.html` | `#tab-expansion` + `#view-expansion` | modify |
| `js/main.js` | one `VIEWS` entry + one `buildSecondaryView` call | modify |
| `css/styles.css` | appended `.exp*` block | modify |
| `test/fixtures/goal-data.js` | raw fixture with milestone costs | create |
| `test/engine/expansion.test.js` | expansion engine tests | create |
| `test/domain/goals.test.js` | goal catalog + evaluation tests | create |

---

## Task 1: `dataset.goals` — keep milestone costs through normalization

**Files:**
- Modify: `js/data/normalize.js` (add a block after `recipeUnlocks`, ~line 119; extend the return at line 121)
- Modify: `js/domain/model.js` (typedefs, ~line 47-59)
- Test: `test/data/normalize.test.js` (append)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `dataset.goals: Goal[]` where
  `Goal = { id: string, name: string, tier: number, cost: {itemId: string, amount: number}[], timeSec: number }`.
  Task 5 consumes this.

**Context:** `normalize` currently reads `raw.schematics` only to build `recipeUnlocks` (recipe → unlock source), discarding `cost`. The real dataset has 42 `EST_Milestone` schematics spanning tiers 1–9, and every one of their `cost` item ids resolves to a real item. MAM / alternate / customization schematics are deliberately excluded.

- [ ] **Step 1: Write the failing tests**

Append to `test/data/normalize.test.js`:

```js
test('keeps milestone part costs as dataset.goals', () => {
  const ds = normalize({
    items: {}, buildings: {}, recipes: {}, resources: {},
    schematics: {
      'Schematic_3-1_C': {
        className: 'Schematic_3-1_C', name: 'Coal Power', type: 'EST_Milestone', tier: 3, time: 480,
        cost: [
          { item: 'Desc_IronPlateReinforced_C', amount: 150 },
          { item: 'Desc_Rotor_C', amount: 50 },
        ],
        unlock: { recipes: [] },
      },
    },
  });
  assert.equal(ds.goals.length, 1);
  assert.deepEqual(ds.goals[0], {
    id: 'Schematic_3-1_C',
    name: 'Coal Power',
    tier: 3,
    cost: [
      { itemId: 'Desc_IronPlateReinforced_C', amount: 150 },
      { itemId: 'Desc_Rotor_C', amount: 50 },
    ],
    timeSec: 480,
  });
});

test('dataset.goals excludes non-milestone schematic types', () => {
  const ds = normalize({
    items: {}, buildings: {}, recipes: {}, resources: {},
    schematics: {
      M:  { className: 'M',  name: 'Mile', type: 'EST_Milestone', tier: 1, cost: [{ item: 'A', amount: 5 }], unlock: { recipes: [] } },
      R1: { className: 'R1', name: 'Res',  type: 'EST_MAM',       tier: 3, cost: [{ item: 'B', amount: 10 }], unlock: { recipes: [] } },
      R2: { className: 'R2', name: 'Alt',  type: 'EST_Alternate', tier: 4, cost: [{ item: 'C', amount: 1 }],  unlock: { recipes: [] } },
      R3: { className: 'R3', name: 'Sink', type: 'EST_ResourceSink', tier: 0, cost: [{ item: 'D', amount: 1 }], unlock: { recipes: [] } },
    },
  });
  assert.deepEqual(ds.goals.map((g) => g.id), ['M']);
});

// A dataset bump must degrade, not throw — same posture as the schematic
// name/type coercion above.
test('dataset.goals drops malformed cost entries and cost-less milestones', () => {
  const ds = normalize({
    items: {}, buildings: {}, recipes: {}, resources: {},
    schematics: {
      Good:    { className: 'Good',    name: 'G', type: 'EST_Milestone', tier: '2', cost: [{ item: 'A', amount: '25' }, { item: 42, amount: 5 }, { item: 'B', amount: 0 }, { item: 'C' }], unlock: { recipes: [] } },
      NoCost:  { className: 'NoCost',  name: 'N', type: 'EST_Milestone', tier: 1, unlock: { recipes: [] } },
      Emptied: { className: 'Emptied', name: 'E', type: 'EST_Milestone', tier: 1, cost: [{ item: null, amount: 3 }], unlock: { recipes: [] } },
    },
  });
  assert.deepEqual(ds.goals.map((g) => g.id), ['Good'], 'a milestone with no usable cost is dropped entirely');
  assert.deepEqual(ds.goals[0].cost, [{ itemId: 'A', amount: 25 }], 'a numeric string amount coerces; bad item, zero amount, and missing amount drop');
  assert.equal(ds.goals[0].tier, 0, 'a non-numeric tier falls back to 0');
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test 2>&1 | tail -20`
Expected: 3 failures, `TypeError: Cannot read properties of undefined (reading 'length')` — `ds.goals` does not exist yet.

- [ ] **Step 3: Implement**

In `js/data/normalize.js`, insert after the `recipeUnlocks` loop (after line 119, before the `return`):

```js
  // Milestone part costs, for the Expansion view's Goals panel. Milestones are
  // the only type kept: MAM / alternate / customization costs are research and
  // unlock inputs, which answers a different question from "what parts do I need
  // to build". Coerced and filtered like recipeUnlocks above — a dataset bump
  // should degrade, not throw.
  const goals = [];
  for (const key of Object.keys(raw.schematics || {})) {
    const s = raw.schematics[key];
    if (s.type !== 'EST_Milestone') continue;
    const cost = [];
    for (const c of s.cost || []) {
      const amount = Number(c?.amount);
      if (typeof c?.item !== 'string' || !c.item) continue;
      if (!Number.isFinite(amount) || amount <= 0) continue;
      cost.push({ itemId: c.item, amount });
    }
    if (cost.length === 0) continue;          // nothing to shop for
    goals.push({
      id: String(s.className ?? key),
      name: typeof s.name === 'string' ? s.name : '',
      tier: typeof s.tier === 'number' ? s.tier : 0,
      cost,
      timeSec: Number(s.time) || 0,
    });
  }
```

Change the return (line 121) to:

```js
  return { items, buildings, recipes, rawResourceIds, generators, recipeUnlocks, goals };
```

In `js/domain/model.js`, add before the `Dataset` typedef:

```js
 * @typedef {Object} Goal
 * @property {string} id     schematic className
 * @property {string} name   e.g. "Coal Power"
 * @property {number} tier   0 when the data gives no tier
 * @property {{itemId: string, amount: number}[]} cost  parts to deliver; never empty
 * @property {number} timeSec  research time; 0 if absent
 *
```

and add to the `Dataset` typedef's property list:

```js
 * @property {Goal[]} goals  milestone part costs; see js/domain/goals.js
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test 2>&1 | tail -8`
Expected: `pass 130`, `fail 0`.

- [ ] **Step 5: Sanity-check against the real dataset**

Run:
```bash
curl -s "https://cdn.jsdelivr.net/gh/greeny/SatisfactoryTools@2bd164690a29136365fcfda6f9adcaaf2d6de214/data/data.json" -o /tmp/satis-data.json
node --input-type=module -e "
import { normalize } from './js/data/normalize.js';
import { readFileSync } from 'node:fs';
const ds = normalize(JSON.parse(readFileSync('/tmp/satis-data.json','utf8')));
console.log('goals:', ds.goals.length);
console.log('tiers:', [...new Set(ds.goals.map(g=>g.tier))].sort((a,b)=>a-b).join(','));
console.log('unresolved cost ids:', ds.goals.flatMap(g=>g.cost).filter(c=>!ds.items.has(c.itemId)).length);
"
```
Expected: `goals: 42`, `tiers: 1,2,3,4,5,6,7,8,9`, `unresolved cost ids: 0`.

- [ ] **Step 6: Commit**

```bash
git add js/data/normalize.js js/domain/model.js test/data/normalize.test.js
git commit -F - <<'EOF'
feat(data): keep milestone part costs as dataset.goals

normalize read raw.schematics only to invert recipe unlocks, dropping the
`cost` array on the floor. The Expansion view's Goals panel needs exactly
that: 42 milestones across tiers 1-9, every cost id resolving to a real item.

Milestones only. MAM and alternate schematics also carry costs, but those are
research and unlock inputs — a different question from "what parts do I need
to build", and 139 rows of mostly-noise in a panel meant to be scanned.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
```

---

## Task 2: Supply variables in the target-rates LP

**Files:**
- Modify: `js/engine/lp-builder.js` (add `SUPPLY_COST`, `supplyVarName`, `addSupplies`; extend `buildTargetRatesModel` at line 69)
- Modify: `js/engine/optimize.js` (extend `hitTargets` at line 62)
- Test: `test/engine/lp-builder.test.js` (append), `test/engine/optimize.test.js` (append)

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces:
  - `supplyVarName(itemId, kind) -> string` exported from `lp-builder.js`.
  - `buildTargetRatesModel({..., supplies})` where `supplies: {itemId: string, rate: number, kind: 'pinned'|'have'}[]`.
  - `hitTargets({..., supplies})` returning an added field
    `supplyDrawn: {itemId: string, kind: string, used: number}[]`, one entry per input supply, in input order.
  - Task 3 consumes both.

**Context — why this shape.** A supply is "up to `rate`/min of this item is already on hand". Modelled as a variable that produces the item at a negligible-but-positive raw cost, bounded by its own `{max}` constraint. The minimiser therefore drains supply before building machines, and demand beyond `rate` spills into real machines rather than vanishing.

Two facts, both verified against the solver, that the code must preserve:

1. **The two kinds must stay separate variables.** `pinned` is a block's own surplus; `have` is an existing supply line. Task 3's `netOutput` adds `have` draw and must not add `pinned` draw — a merged variable makes that undecidable.
2. **Both costs must be strictly positive.** At cost exactly `0` the draw is degenerate: pulling the full cap and wasting the excess is feasible at an identical objective, so `used` can come back as the whole supply regardless of what was consumed. `1e-9` / `1e-6` keeps the draw exact while preserving the preference order.

A supply for a **raw** item must be skipped: raw constraints are expressed as *net consumption* (`js/engine/lp-builder.js:22`, `v[itemId] = -net`), so a `+1` coefficient there would invert the sign and silently loosen the ore constraint.

- [ ] **Step 1: Write the failing lp-builder tests**

Append to `test/engine/lp-builder.test.js` (note the import line at the top of that file must gain `supplyVarName`):

```js
test('buildTargetRatesModel: a supply adds a capped producing variable at negligible cost', () => {
  const m = buildTargetRatesModel({
    dataset, caps, enabledRecipeIds: ALL, targets: { plate: 10 },
    supplies: [{ itemId: 'ingot', rate: 30, kind: 'have' }],
  });
  const v = m.variables[supplyVarName('ingot', 'have')];
  assert.equal(v.ingot, 1, 'produces the item');
  assert.equal(v[RAWCOST], 1e-6);
  assert.deepEqual(m.constraints._supcap_have_ingot, { max: 30 });
  assert.equal(v._supcap_have_ingot, 1, 'the variable is what the cap constrains');
});

test('buildTargetRatesModel: pinned supply is cheaper than have, and both are strictly positive', () => {
  const m = buildTargetRatesModel({
    dataset, caps, enabledRecipeIds: ALL, targets: { plate: 10 },
    supplies: [
      { itemId: 'ingot', rate: 30, kind: 'pinned' },
      { itemId: 'ingot', rate: 30, kind: 'have' },
    ],
  });
  const pinned = m.variables[supplyVarName('ingot', 'pinned')][RAWCOST];
  const have = m.variables[supplyVarName('ingot', 'have')][RAWCOST];
  assert.ok(pinned > 0, 'zero cost would leave the draw degenerate');
  assert.ok(have > pinned, 'consume your own byproduct before pulling from the bus');
  assert.ok(have < 1, 'must not perturb real raw costs');
  assert.notEqual(supplyVarName('ingot', 'pinned'), supplyVarName('ingot', 'have'));
});

// Raw constraints hold NET CONSUMPTION, so a +1 coefficient would invert the
// sign and loosen the ore cap instead of supplying ore.
test('buildTargetRatesModel: a supply for a raw resource is ignored', () => {
  const m = buildTargetRatesModel({
    dataset, caps, enabledRecipeIds: ALL, targets: { plate: 10 },
    supplies: [{ itemId: 'ore', rate: 500, kind: 'have' }],
  });
  assert.equal(m.variables[supplyVarName('ore', 'have')], undefined);
  assert.equal(m.constraints._supcap_have_ore, undefined);
  assert.deepEqual(m.constraints.ore, { max: 60 }, 'the ore cap is untouched');
});

test('buildTargetRatesModel: omitting supplies yields the pre-existing model exactly', () => {
  const withArg = buildTargetRatesModel({ dataset, caps, enabledRecipeIds: ALL, targets: { plate: 10 }, supplies: [] });
  const without = buildTargetRatesModel({ dataset, caps, enabledRecipeIds: ALL, targets: { plate: 10 } });
  assert.deepEqual(withArg, without);
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npm test 2>&1 | tail -20`
Expected: failures — `supplyVarName` is not exported (`SyntaxError` on the import, or `undefined` is not a function).

- [ ] **Step 3: Implement in `js/engine/lp-builder.js`**

Add after the `RAWCOST` export (line 4):

```js
// Cost of drawing one unit from an already-on-hand supply. Both are strictly
// positive on purpose: at exactly 0 the draw is degenerate — pulling the full cap
// and wasting the excess is feasible at an identical objective, so the reported
// draw stops meaning "what was consumed". Both sit far below any real raw cost and
// ~9+ orders under the 1e6 slack penalty, so they cannot shift feasibility or
// machine counts. `pinned` < `have` so a block's own byproduct is consumed before
// the bus is tapped.
const SUPPLY_COST = { pinned: 1e-9, have: 1e-6 };

/** LP variable name for an on-hand supply. Kinds stay separate so each draw stays measurable. */
export function supplyVarName(itemId, kind) {
  return `_supply_${kind}_${itemId}`;
}

/**
 * Add "up to `rate`/min already on hand" sources. Each is a variable producing
 * the item, bounded by its own {max} constraint, so demand beyond `rate` spills
 * into real machines instead of vanishing.
 *
 * Raw items are skipped: their constraints hold NET CONSUMPTION (see
 * buildVariables), so a +1 coefficient would invert the sign and loosen the cap.
 */
function addSupplies(dataset, variables, constraints, supplies) {
  for (const s of supplies || []) {
    const rate = Number(s?.rate);
    if (!s?.itemId || !Number.isFinite(rate) || rate <= 0) continue;
    if (dataset.rawResourceIds.has(s.itemId)) continue;
    const kind = s.kind === 'pinned' ? 'pinned' : 'have';
    const capKey = `_supcap_${kind}_${s.itemId}`;
    variables[supplyVarName(s.itemId, kind)] = {
      [s.itemId]: 1,
      [RAWCOST]: SUPPLY_COST[kind],
      [capKey]: 1,
    };
    constraints[capKey] = { max: rate };
  }
}
```

Change `buildTargetRatesModel` (line 69) to accept and apply `supplies`:

```js
export function buildTargetRatesModel({ dataset, caps, enabledRecipeIds, targets, noWaste = false, supplies = [] }) {
```

and insert `addSupplies(dataset, variables, constraints, supplies);` immediately before its `return`.

- [ ] **Step 4: Run to verify the lp-builder tests pass**

Run: `npm test 2>&1 | tail -8`
Expected: `pass 134`, `fail 0`.

- [ ] **Step 5: Write the failing `hitTargets` integration tests**

Append to `test/engine/optimize.test.js`. These numbers are hand-verified against the solver using the `iron-chain` fixture (`2× rip` demands `plate 60` + `screw 120`; with no supply the answer is `ingot 4, rod 2, plate 3, screw 3`):

```js
import { ironChain, ALL_IRON_RECIPES } from '../fixtures/iron-chain.js';

const unbounded = new Map([['ore', Infinity]]);
const rate = (m, id) => Math.round((m.get(id) || 0) * 1e6) / 1e6;

test('hitTargets: a partial supply is drained first and the overflow is built', () => {
  const base = hitTargets({ dataset: ironChain, caps: unbounded, enabledRecipeIds: ALL_IRON_RECIPES, targets: { plate: 60, screw: 120 } });
  assert.equal(rate(base.recipeRates, 'screw'), 3);
  assert.equal(rate(base.recipeRates, 'rod'), 2);

  const r = hitTargets({
    dataset: ironChain, caps: unbounded, enabledRecipeIds: ALL_IRON_RECIPES,
    targets: { plate: 60, screw: 120 },
    supplies: [{ itemId: 'screw', rate: 60, kind: 'have' }],
  });
  assert.equal(r.feasible, true);
  assert.equal(rate(r.recipeRates, 'screw'), 1.5, 'builds for the 60/min the supply does not cover');
  assert.equal(rate(r.recipeRates, 'rod'), 1);
  assert.equal(rate(r.recipeRates, 'ingot'), 3.5);
  assert.deepEqual(r.supplyDrawn, [{ itemId: 'screw', kind: 'have', used: 60 }]);
});

test('hitTargets: a supply covering demand builds nothing for that item', () => {
  const r = hitTargets({
    dataset: ironChain, caps: unbounded, enabledRecipeIds: ALL_IRON_RECIPES,
    targets: { plate: 60, screw: 120 },
    supplies: [{ itemId: 'screw', rate: 120, kind: 'have' }],
  });
  assert.equal(rate(r.recipeRates, 'screw'), 0);
  assert.equal(rate(r.recipeRates, 'rod'), 0, 'and nothing to feed it either');
  assert.equal(rate(r.recipeRates, 'ingot'), 3);
});

// Guards the zero-cost degeneracy: `used` must mean "consumed", not "available".
test('hitTargets: an oversized supply reports the amount consumed, not its cap', () => {
  const r = hitTargets({
    dataset: ironChain, caps: unbounded, enabledRecipeIds: ALL_IRON_RECIPES,
    targets: { plate: 60, screw: 120 },
    supplies: [{ itemId: 'screw', rate: 300, kind: 'have' }],
  });
  assert.deepEqual(r.supplyDrawn, [{ itemId: 'screw', kind: 'have', used: 120 }]);
});

test('hitTargets: an unneeded supply reports zero rather than its cap', () => {
  const r = hitTargets({
    dataset: ironChain, caps: unbounded, enabledRecipeIds: ALL_IRON_RECIPES,
    targets: { plate: 60 },
    supplies: [{ itemId: 'rotor', rate: 40, kind: 'pinned' }],
  });
  assert.deepEqual(r.supplyDrawn, [{ itemId: 'rotor', kind: 'pinned', used: 0 }]);
});

test('hitTargets: pinned supply is consumed before have supply', () => {
  const r = hitTargets({
    dataset: ironChain, caps: unbounded, enabledRecipeIds: ALL_IRON_RECIPES,
    targets: { screw: 120 },
    supplies: [
      { itemId: 'screw', rate: 80, kind: 'pinned' },
      { itemId: 'screw', rate: 80, kind: 'have' },
    ],
  });
  assert.deepEqual(r.supplyDrawn, [
    { itemId: 'screw', kind: 'pinned', used: 80 },
    { itemId: 'screw', kind: 'have', used: 40 },
  ]);
});
```

- [ ] **Step 6: Run to verify they fail**

Run: `npm test 2>&1 | tail -20`
Expected: failures on `r.supplyDrawn` being `undefined`.

- [ ] **Step 7: Implement in `js/engine/optimize.js`**

Change the import on line 1 to add `supplyVarName`:

```js
import { buildMaxModel, buildMinRawModel, buildTargetRatesModel, buildMaxSetsModel, buildMinRawForSetsModel, supplyVarName } from './lp-builder.js';
```

Replace `hitTargets` (lines 62-81) with:

```js
/** Hit target rates with minimum raw usage; slack variables report shortfalls. */
export function hitTargets({ dataset, caps, enabledRecipeIds, targets, noWaste = false, supplies = [] }) {
  const targetMap = targets instanceof Map ? targets : new Map(Object.entries(targets));
  const r = solveModel(buildTargetRatesModel({ dataset, caps, enabledRecipeIds, targets: targetMap, noWaste, supplies }));
  const shortfalls = new Map();
  for (const t of targetMap.keys()) {
    const s = r.values[`_slack_${t}`] || 0;
    if (s > 1e-6) shortfalls.set(t, s);
  }
  const recipeRates = ratesFrom(r.values, enabledRecipeIds);
  // How much of each on-hand supply the plan actually consumed. One entry per
  // input supply, in input order, so callers can pair it back up positionally
  // and report "used X of Y". A skipped supply (raw, or a non-positive rate)
  // reports 0 rather than being omitted, so the arrays stay aligned.
  const supplyDrawn = (supplies || []).map((s) => {
    const kind = s?.kind === 'pinned' ? 'pinned' : 'have';
    const used = r.values[supplyVarName(s?.itemId, kind)] || 0;
    return { itemId: s?.itemId, kind, used: Math.round(used * 1e6) / 1e6 };
  });
  return {
    // Defense-in-depth: the target-rates model is always feasible today (the
    // slack variables guarantee a feasible point), so this AND-clause is inert
    // now — but folding in solver feasibility means a future hard-constraint
    // change (e.g. noWaste={equal:0}) can never report a false success.
    feasible: r.feasible && shortfalls.size === 0,
    recipeRates,
    shortfalls,
    supplyDrawn,
    bindingResources: bindingResources(dataset, caps, recipeRates),
  };
}
```

- [ ] **Step 8: Run the full suite**

Run: `npm test 2>&1 | tail -8`
Expected: `pass 139`, `fail 0`.

- [ ] **Step 9: Commit**

```bash
git add js/engine/lp-builder.js js/engine/optimize.js test/engine/lp-builder.test.js test/engine/optimize.test.js
git commit -F - <<'EOF'
feat(engine): model supply already on hand in the target-rates LP

The Expansion view needs "I already have 300 Rubber/min" to stop the
explosion there without stopping it dead. A capped variable producing the
item at negligible cost does it: the minimizer drains supply first, and
demand past the cap spills into real machines.

Two things the obvious version gets wrong. A pseudo-raw hard-caps the item,
so overflow surfaces as a phantom shortfall instead of machines. And a cost
of exactly zero leaves the draw degenerate — pulling the full cap and wasting
the excess scores identically, so the reported draw stops meaning "consumed".
Both costs are strictly positive, pinned under have so a block's own
byproduct is spent before the bus is tapped.

Raw supplies are skipped: raw constraints hold net consumption, so a +1
coefficient would invert the sign and quietly loosen the ore cap.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
```

---

## Task 3: `planExpansion` — pin, split, solve, shape

**Files:**
- Create: `js/engine/expansion.js`
- Test: `test/engine/expansion.test.js`

**Interfaces:**
- Consumes: `hitTargets({..., supplies})` and its `supplyDrawn` (Task 2); `netPerMin` from `js/domain/model.js`; `realize` from `js/engine/physical-layer.js`; `beltReport` from `js/engine/belt-layer.js`.
- Produces, all exported for direct unit testing:
  - `pinnedBalance(dataset, blockRows) -> Map<itemId, number>`
  - `splitDemand(dataset, netPinned, wantRows, haveRows) -> { targets: Map, supplies: [], rawDemand: Map, rawSupplied: Map }`
  - `computeNetOutput(dataset, netPinned, recipeRates, supplyDrawn) -> Map<itemId, number>`
  - `planExpansion({dataset, rows, enabledRecipeIds, shardBudget, beltTier, pipeTier}) -> ExpansionPlan`
  - Task 4 extends `planExpansion`'s `rawNeeded`; Tasks 7-8 consume `planExpansion`.
- Row shapes (from spec §3): `{kind:'block', recipeId, machines, clock}`, `{kind:'want', itemId, rate}`, `{kind:'have', itemId, rate}`.

**Context — the sign rule (spec §5.1).** Blocks are pinned. Their net balance splits three ways, and the raw case is the one that's easy to get wrong: a block eating ore directly (a Smelter on Iron Ingot) has no upstream to build, so routing it through the LP as a target would let the ore constraint "satisfy" it and it would then be missing from the raw footer entirely. It bypasses the LP.

**Context — `netOutput` (spec §6.1).** `netPinned + netFromLPRecipes + drawn['have']`. The drawn **pinned** supply must NOT be subtracted: an upstream machine's consumption of a block surplus already appears as a negative term in `netFromLPRecipes`, so subtracting the draw as well double-counts. Verified: blocks netting +130 Rod with new Screw machines eating 30 Rod must report 100 Rod leaving, not 70.

- [ ] **Step 1: Write the failing tests**

Create `test/engine/expansion.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { pinnedBalance, splitDemand, computeNetOutput, planExpansion } from '../../js/engine/expansion.js';
import { ironChain, ALL_IRON_RECIPES } from '../fixtures/iron-chain.js';

const r6 = (x) => Math.round(x * 1e6) / 1e6;
const rateOf = (m, id) => r6(m.get(id) || 0);
const machinesOf = (plan, recipeId) => plan.buildRows.find((b) => b.recipeId === recipeId)?.machines ?? 0;

const plan = (rows, extra = {}) => planExpansion({
  dataset: ironChain, rows, enabledRecipeIds: ALL_IRON_RECIPES, ...extra,
});

test('pinnedBalance: nets a block at its machine count', () => {
  // rip: 30 plate + 60 screw -> 5 rip, per machine
  const net = pinnedBalance(ironChain, [{ kind: 'block', recipeId: 'rip', machines: 2, clock: 1 }]);
  assert.equal(rateOf(net, 'plate'), -60);
  assert.equal(rateOf(net, 'screw'), -120);
  assert.equal(rateOf(net, 'rip'), 10);
});

test('pinnedBalance: clock scales the load — 4 @150% equals 6 @100%', () => {
  const fast = pinnedBalance(ironChain, [{ kind: 'block', recipeId: 'rip', machines: 4, clock: 1.5 }]);
  const many = pinnedBalance(ironChain, [{ kind: 'block', recipeId: 'rip', machines: 6, clock: 1 }]);
  assert.deepEqual([...fast].sort(), [...many].sort());
  assert.equal(rateOf(fast, 'plate'), -180);
});

test('pinnedBalance: an unknown recipeId is ignored, not thrown', () => {
  const net = pinnedBalance(ironChain, [
    { kind: 'block', recipeId: 'no_such_recipe', machines: 3, clock: 1 },
    { kind: 'block', recipeId: 'rip', machines: 2, clock: 1 },
  ]);
  assert.equal(rateOf(net, 'plate'), -60, 'the surviving block still counts');
});

test('splitDemand: negative non-raw becomes a target, positive becomes pinned supply', () => {
  const net = pinnedBalance(ironChain, [{ kind: 'block', recipeId: 'rip', machines: 2, clock: 1 }]);
  const { targets, supplies, rawDemand } = splitDemand(ironChain, net, [], []);
  assert.equal(rateOf(targets, 'plate'), 60);
  assert.equal(rateOf(targets, 'screw'), 120);
  assert.deepEqual(supplies, [{ itemId: 'rip', rate: 10, kind: 'pinned' }]);
  assert.equal(rawDemand.size, 0);
});

// A block eating ore has no upstream to build. Routed through the LP it would be
// silently absorbed by the ore constraint and vanish from the raw footer.
test('splitDemand: a block consuming a raw goes to rawDemand, not to the LP', () => {
  const net = pinnedBalance(ironChain, [{ kind: 'block', recipeId: 'ingot', machines: 1, clock: 1 }]);
  const { targets, supplies, rawDemand } = splitDemand(ironChain, net, [], []);
  assert.equal(targets.size, 0);
  assert.equal(rateOf(rawDemand, 'ore'), 30);
  assert.deepEqual(supplies, [{ itemId: 'ingot', rate: 30, kind: 'pinned' }]);
});

test('splitDemand: want rows add targets; a raw want becomes raw demand', () => {
  const { targets, rawDemand } = splitDemand(ironChain, new Map(), [
    { kind: 'want', itemId: 'rod', rate: 45 },
    { kind: 'want', itemId: 'ore', rate: 120 },
  ], []);
  assert.equal(rateOf(targets, 'rod'), 45);
  assert.equal(rateOf(rawDemand, 'ore'), 120);
});

test('splitDemand: have rows become have supply; a raw have becomes rawSupplied', () => {
  const { supplies, rawSupplied } = splitDemand(ironChain, new Map(), [], [
    { kind: 'have', itemId: 'screw', rate: 300 },
    { kind: 'have', itemId: 'ore', rate: 480 },
  ]);
  assert.deepEqual(supplies, [{ itemId: 'screw', rate: 300, kind: 'have' }]);
  assert.equal(rateOf(rawSupplied, 'ore'), 480);
});

test('planExpansion: one block explodes to whole upstream machines', () => {
  const p = plan([{ kind: 'block', recipeId: 'rip', machines: 2, clock: 1 }]);
  assert.equal(p.feasible, true);
  assert.equal(machinesOf(p, 'plate'), 3);
  assert.equal(machinesOf(p, 'screw'), 3);
  assert.equal(machinesOf(p, 'rod'), 2);
  assert.equal(machinesOf(p, 'ingot'), 4);
  assert.equal(p.tiles.machines, 12);
});

test('planExpansion: a block feeding another needs no upstream for the intermediate', () => {
  const p = plan([
    { kind: 'block', recipeId: 'rip', machines: 2, clock: 1 },
    { kind: 'block', recipeId: 'plate', machines: 3, clock: 1 },  // exactly the 60 plate/min rip wants
  ]);
  assert.equal(machinesOf(p, 'plate'), 0, 'plate nets to zero, so nothing upstream builds it');
  assert.equal(machinesOf(p, 'ingot'), 4, 'but the plate block itself now needs ingot');
  assert.equal(p.tiles.machines, 9);
});

test('planExpansion: a block partly feeding another covers only the deficit', () => {
  const p = plan([
    { kind: 'block', recipeId: 'rip', machines: 2, clock: 1 },
    { kind: 'block', recipeId: 'plate', machines: 2, clock: 1 },  // 40 of the 60 plate/min
  ]);
  assert.equal(machinesOf(p, 'plate'), 1, 'one more plate machine covers the missing 20/min');
  assert.equal(p.tiles.machines, 10);
});

test('planExpansion: a have row covering demand removes that whole subtree', () => {
  const p = plan([
    { kind: 'block', recipeId: 'rip', machines: 2, clock: 1 },
    { kind: 'have', itemId: 'screw', rate: 120 },
  ]);
  assert.equal(machinesOf(p, 'screw'), 0);
  assert.equal(machinesOf(p, 'rod'), 0, 'and the rod that fed it');
  assert.deepEqual(p.supplyUsage, [{ itemId: 'screw', kind: 'have', rate: 120, used: 120, capped: false }],
    'exhausted but nothing was built for it, so not flagged');
});

test('planExpansion: a have row partly covering demand flags the overflow', () => {
  const p = plan([
    { kind: 'block', recipeId: 'rip', machines: 2, clock: 1 },
    { kind: 'have', itemId: 'screw', rate: 60 },
  ]);
  assert.equal(machinesOf(p, 'screw'), 2, 'ceil(1.5) whole machines');
  assert.deepEqual(p.supplyUsage, [{ itemId: 'screw', kind: 'have', rate: 60, used: 60, capped: true }]);
});

test('planExpansion: a have row larger than demand is not flagged', () => {
  const p = plan([
    { kind: 'block', recipeId: 'rip', machines: 2, clock: 1 },
    { kind: 'have', itemId: 'screw', rate: 300 },
  ]);
  assert.deepEqual(p.supplyUsage, [{ itemId: 'screw', kind: 'have', rate: 300, used: 120, capped: false }]);
});

test('computeNetOutput: an unconsumed block output leaves at its full rate', () => {
  const p = plan([{ kind: 'block', recipeId: 'rip', machines: 2, clock: 1 }]);
  assert.equal(rateOf(p.netOutput, 'rip'), 10);
  assert.equal(rateOf(p.netOutput, 'plate'), 0, 'plate is fully consumed internally');
});

// The double-count guard: the upstream's consumption of the surplus is already a
// negative term in netFromLPRecipes, so subtracting the drawn supply too gives 70.
test('computeNetOutput: a block surplus partly eaten upstream reports the remainder', () => {
  const p = plan([
    { kind: 'block', recipeId: 'rip', machines: 2, clock: 1 },   // wants 120 screw
    { kind: 'block', recipeId: 'rod', machines: 10, clock: 1 },  // makes 150 rod
  ]);
  // screw machines (3) consume 30 rod; 150 - 30 = 120 rod leaves.
  assert.equal(rateOf(p.netOutput, 'rod'), 120);
  assert.equal(machinesOf(p, 'rod'), 0, 'the block already covers all rod demand');
});

test('computeNetOutput: a block surplus counts toward a larger want rather than against it', () => {
  const p = plan([
    { kind: 'block', recipeId: 'screw', machines: 2, clock: 1 },  // makes 80 screw, eats 20 rod
    { kind: 'want', itemId: 'screw', rate: 200 },
  ]);
  assert.equal(rateOf(p.netOutput, 'screw'), 200, 'not 120 — the 80 surplus is part of the 200');
});

test('planExpansion: an unreachable target reports a shortfall instead of throwing', () => {
  // Only the ingot recipe is enabled, so plate can never be made.
  const p = planExpansion({
    dataset: ironChain,
    rows: [{ kind: 'want', itemId: 'plate', rate: 20 }],
    enabledRecipeIds: new Set(['ingot']),
  });
  assert.equal(p.feasible, false);
  assert.deepEqual(p.shortfalls.map((s) => s.itemId), ['plate']);
});

test('planExpansion: no rows yields an empty, feasible plan', () => {
  const p = plan([]);
  assert.equal(p.tiles.machines, 0);
  assert.deepEqual(p.buildRows, []);
  assert.equal(p.hasPlan, false);
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npm test 2>&1 | tail -20`
Expected: `Cannot find module .../js/engine/expansion.js`.

- [ ] **Step 3: Implement `js/engine/expansion.js`**

```js
/**
 * Expansion planner: you declare machine blocks you've decided to build plus
 * whatever is already on your bus, and this works out what has to feed them.
 *
 * The Factory Optimizer solves the other direction — given ore nodes, maximize
 * output — which forces you to model the whole factory from ore up every time you
 * bolt something on. Here the blocks are *pinned* and only the residual is solved.
 *
 * Pure: no DOM, no storage, deterministic.
 * @typedef {import('../domain/model.js').Dataset} Dataset
 */
import { netPerMin } from '../domain/model.js';
import { hitTargets } from './optimize.js';
import { realize } from './physical-layer.js';
import { beltReport } from './belt-layer.js';

const EPS = 1e-6;
const round6 = (x) => Math.round(x * 1e6) / 1e6;

const nameOf = (dataset, id) => dataset.items.get(id)?.name ?? id;
const slugOf = (dataset, id) => dataset.items.get(id)?.slug;
const fluidOf = (dataset, id) => !!dataset.items.get(id)?.liquid;

/** Every item a recipe touches, on either side, once. */
function touched(recipe) {
  return new Set([...recipe.inputs.map((e) => e.itemId), ...recipe.outputs.map((e) => e.itemId)]);
}

/** Accumulate `v` onto `map[k]`. */
function add(map, k, v) {
  map.set(k, (map.get(k) || 0) + v);
}

/**
 * Net per-minute balance across every block row at its declared machine count and
 * clock. Positive = the blocks make a surplus; negative = something upstream has
 * to cover the difference.
 * @param {Dataset} dataset
 * @param {{recipeId: string, machines: number, clock?: number}[]} blockRows
 * @returns {Map<string, number>}
 */
export function pinnedBalance(dataset, blockRows) {
  const byId = new Map(dataset.recipes.map((r) => [r.id, r]));
  const net = new Map();
  for (const b of blockRows || []) {
    const recipe = byId.get(b?.recipeId);
    if (!recipe) continue;                       // stale saved row: ignore rather than throw
    const machines = Math.max(0, Number(b.machines) || 0);
    const clock = Number(b.clock);
    const load = machines * (Number.isFinite(clock) && clock > 0 ? clock : 1);
    if (load <= 0) continue;
    for (const itemId of touched(recipe)) add(net, itemId, load * netPerMin(recipe, itemId));
  }
  for (const [k, v] of net) net.set(k, round6(v));
  return net;
}

/**
 * Sort the pinned balance and the user's rows into what the LP must solve for and
 * what it gets for free.
 *
 * Raw resources take a separate path in both directions. A block that eats ore
 * directly has no upstream to build, and handing it to the LP as a target would
 * let the ore constraint absorb it — it would then be missing from the raw footer
 * entirely. Likewise a raw HAVE row can't be an LP supply, because raw
 * constraints hold net *consumption*, so it is netted off in the footer instead.
 */
export function splitDemand(dataset, netPinned, wantRows, haveRows) {
  const raw = dataset.rawResourceIds;
  const targets = new Map();
  const supplies = [];
  const rawDemand = new Map();
  const rawSupplied = new Map();

  for (const [itemId, v] of netPinned) {
    if (v < -EPS) {
      if (raw.has(itemId)) add(rawDemand, itemId, -v);
      else add(targets, itemId, -v);
    } else if (v > EPS) {
      supplies.push({ itemId, rate: v, kind: 'pinned' });
    }
  }
  for (const w of wantRows || []) {
    const rate = Math.max(0, Number(w?.rate) || 0);
    if (!w?.itemId || rate <= 0) continue;
    if (raw.has(w.itemId)) add(rawDemand, w.itemId, rate);
    else add(targets, w.itemId, rate);
  }
  for (const h of haveRows || []) {
    const rate = Math.max(0, Number(h?.rate) || 0);
    if (!h?.itemId || rate <= 0) continue;
    if (raw.has(h.itemId)) add(rawSupplied, h.itemId, rate);
    else supplies.push({ itemId: h.itemId, rate, kind: 'have' });
  }
  return { targets, supplies, rawDemand, rawSupplied };
}

/**
 * What actually leaves the expansion, per item:
 *   netPinned + netFromLPRecipes + drawn['have']
 *
 * The drawn *pinned* supply is deliberately absent. An upstream machine eating a
 * block's surplus already shows up as a negative term inside netFromLPRecipes, so
 * subtracting the draw as well double-counts it — blocks netting +130 Rod with new
 * Screw machines taking 30 would report 70 instead of 100.
 *
 * Drawn *have* supply IS added: it's an inflow from outside the expansion that
 * neither of the other two terms knows about.
 */
export function computeNetOutput(dataset, netPinned, recipeRates, supplyDrawn) {
  const byId = new Map(dataset.recipes.map((r) => [r.id, r]));
  const net = new Map(netPinned);
  for (const [rid, load] of recipeRates) {
    const recipe = byId.get(rid);
    if (!recipe) continue;
    for (const itemId of touched(recipe)) add(net, itemId, load * netPerMin(recipe, itemId));
  }
  for (const s of supplyDrawn || []) {
    if (s.kind === 'have') add(net, s.itemId, s.used);
  }
  const out = new Map();
  for (const [itemId, v] of net) {
    if (dataset.rawResourceIds.has(itemId)) continue;   // raws are the footer's job
    const r = round6(v);
    if (r > EPS) out.set(itemId, r);
  }
  return out;
}

/** Raw draw of the upstream machines, mirroring rawUsage in view-model.js. */
function lpRawUsage(dataset, recipeRates) {
  const byId = new Map(dataset.recipes.map((r) => [r.id, r]));
  const usage = new Map();
  for (const [rid, load] of recipeRates) {
    const recipe = byId.get(rid);
    if (!recipe) continue;
    for (const i of recipe.inputs) if (dataset.rawResourceIds.has(i.itemId)) add(usage, i.itemId, load * i.perMin);
    for (const o of recipe.outputs) if (dataset.rawResourceIds.has(o.itemId)) add(usage, o.itemId, -load * o.perMin);
  }
  return usage;
}

/**
 * Plan an expansion.
 * @param {{dataset: Dataset, rows: object[], enabledRecipeIds: Set<string>,
 *          shardBudget?: number, beltTier?: string, pipeTier?: string}} args
 */
export function planExpansion({ dataset, rows, enabledRecipeIds, shardBudget = 0, beltTier = 'Mk4', pipeTier = 'Mk2' }) {
  const all = rows || [];
  const blockRows = all.filter((r) => r?.kind === 'block');
  const wantRows = all.filter((r) => r?.kind === 'want');
  const haveRows = all.filter((r) => r?.kind === 'have');

  const netPinned = pinnedBalance(dataset, blockRows);
  const { targets, supplies, rawDemand, rawSupplied } = splitDemand(dataset, netPinned, wantRows, haveRows);

  // Raws are uncapped here by design — node budgeting is the Optimizer's job.
  // rawConstraints() clamps a non-finite cap to 1e9, which the LP never reaches.
  const caps = new Map();
  for (const r of dataset.recipes) {
    if (!enabledRecipeIds.has(r.id)) continue;
    for (const itemId of touched(r)) if (dataset.rawResourceIds.has(itemId)) caps.set(itemId, Infinity);
  }

  const solved = targets.size > 0
    ? hitTargets({ dataset, caps, enabledRecipeIds, targets, supplies })
    : { feasible: true, recipeRates: new Map(), shortfalls: new Map(), supplyDrawn: supplies.map((s) => ({ itemId: s.itemId, kind: s.kind, used: 0 })) };

  const recipeRates = solved.recipeRates;
  const phys = realize({ dataset, recipeRates, shardBudget });
  const belts = beltReport({ dataset, recipeRates, beltTier, pipeTier });
  const byId = new Map(dataset.recipes.map((r) => [r.id, r]));

  const buildRows = phys.perRecipe
    .map((pr) => {
      const recipe = byId.get(pr.recipeId);
      const building = dataset.buildings.get(pr.buildingId);
      const outId = recipe?.outputs?.[0]?.itemId;
      return {
        recipeId: pr.recipeId,
        recipeName: recipe?.name ?? pr.recipeId,
        buildingName: building?.name ?? '',
        buildingSlug: building?.slug,
        itemName: outId ? nameOf(dataset, outId) : '',
        itemSlug: outId ? slugOf(dataset, outId) : undefined,
        machines: pr.machines,
        clockPct: Math.floor(pr.clock * 100 + 1e-6),
        shards: pr.shards,
        powerMW: Math.round(pr.powerMW * 10) / 10,
      };
    })
    .sort((a, b) => b.machines - a.machines);

  const totalsByBuilding = new Map();
  for (const r of buildRows) {
    const t = totalsByBuilding.get(r.buildingName) || { buildingName: r.buildingName, buildingSlug: r.buildingSlug, machines: 0 };
    t.machines += r.machines;
    totalsByBuilding.set(r.buildingName, t);
  }

  // "Capped" means the supply ran dry AND machines were built for that item —
  // the signal that the declared supply is the reason you're building more.
  const builtItems = new Set();
  for (const rid of recipeRates.keys()) {
    for (const o of byId.get(rid)?.outputs || []) builtItems.add(o.itemId);
  }
  const supplyUsage = supplies.map((s, i) => {
    const used = solved.supplyDrawn[i]?.used ?? 0;
    return {
      itemId: s.itemId,
      kind: s.kind,
      rate: round6(s.rate),
      used: round6(used),
      capped: used >= s.rate - EPS && builtItems.has(s.itemId),
    };
  });

  const blockView = blockRows
    .map((b) => {
      const recipe = byId.get(b.recipeId);
      if (!recipe) return null;
      const building = dataset.buildings.get(recipe.buildingId);
      const outId = recipe.outputs?.[0]?.itemId;
      return {
        recipeId: b.recipeId,
        recipeName: recipe.name,
        buildingName: building?.name ?? '',
        buildingSlug: building?.slug,
        machines: Math.max(0, Number(b.machines) || 0),
        clockPct: Math.floor((Number(b.clock) || 1) * 100 + 1e-6),
        itemName: outId ? nameOf(dataset, outId) : '',
        itemSlug: outId ? slugOf(dataset, outId) : undefined,
      };
    })
    .filter(Boolean);

  const netOutput = computeNetOutput(dataset, netPinned, recipeRates, solved.supplyDrawn);

  // Raw need = the upstream's own draw plus any block that eats ore directly.
  const rawUsage = lpRawUsage(dataset, recipeRates);
  for (const [itemId, v] of rawDemand) add(rawUsage, itemId, v);

  const shortfalls = [...solved.shortfalls].map(([itemId, amount]) => ({
    itemId, name: nameOf(dataset, itemId), slug: slugOf(dataset, itemId),
    amount: Math.round(amount * 100) / 100, fluid: fluidOf(dataset, itemId),
  }));

  return {
    feasible: solved.feasible,
    hasPlan: blockRows.length > 0 || wantRows.length > 0,
    tiles: {
      machines: phys.totalMachines,
      powerMW: Math.round(phys.totalPowerMW * 10) / 10,
      shards: phys.totalShardsUsed,
    },
    buildRows,
    machineTotals: [...totalsByBuilding.values()].sort((a, b) => b.machines - a.machines),
    blockRows: blockView,
    netOutput,
    netOutputRows: [...netOutput]
      .map(([itemId, rate]) => ({ itemId, name: nameOf(dataset, itemId), slug: slugOf(dataset, itemId), rate: round6(rate), fluid: fluidOf(dataset, itemId) }))
      .sort((a, b) => b.rate - a.rate),
    supplyUsage,
    rawUsage,        // Map<itemId, ratePerMin>; Task 4 turns this into rawNeeded
    rawSupplied,     // Map<itemId, ratePerMin> from raw HAVE rows
    shortfalls,
    beltRows: belts.map((f) => ({ itemId: f.itemId, name: nameOf(dataset, f.itemId), slug: slugOf(dataset, f.itemId), rate: f.rate, lines: f.lines, tier: f.tier, fluid: f.fluid, saturated: f.saturated })),
  };
}
```

- [ ] **Step 4: Run to verify they pass**

Run: `npm test 2>&1 | tail -8`
Expected: `pass 157`, `fail 0`.

If the `have row partly covering demand` test fails on machine count, check `realize` — `recipeOptions` rounds `1.5` up to 2 whole machines at 75% clock, which is what the assertion expects.

- [ ] **Step 5: Commit**

```bash
git add js/engine/expansion.js test/engine/expansion.test.js
git commit -F - <<'EOF'
feat(engine): plan an expansion from pinned blocks and existing supply

Blocks are pinned rather than solved for. Their net balance splits by sign:
negative non-raw becomes an LP target, positive becomes a free capped supply,
and negative *raw* bypasses the LP entirely — a Smelter eating ore has no
upstream to build, and as a target the ore constraint would absorb it and it
would vanish from the raw footer.

Block-to-block feeding then falls out of the arithmetic instead of needing a
pass of its own, byproducts included.

netOutput is netPinned + netFromLPRecipes + drawn-have. Drawn *pinned* supply
is pointedly not subtracted: the upstream's consumption of a block surplus is
already a negative term in netFromLPRecipes, so subtracting the draw too
turns 130 Rod less 30 eaten into 70 instead of 100. Both directions are
pinned by tests.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
```

---

## Task 4: Raw footer — needed, supplied, and extractor counts

**Files:**
- Modify: `js/engine/expansion.js` (add `rawNeededRows`, call it in `planExpansion`)
- Test: `test/engine/expansion.test.js` (append)

**Interfaces:**
- Consumes: `planExpansion`'s `rawUsage` and `rawSupplied` Maps (Task 3).
- Produces: `plan.rawNeeded` — an array of
  `{itemId, name, slug, fluid, needed, supplied, newRate, options: {label, count}[]}`,
  sorted by `needed` descending. Task 7 renders it.

**Context.** Rates come from the constants already in `js/engine/resource-model.js` — `MINER_RATES` (Mk1 30/60/120, Mk2 60/120/240, Mk3 120/240/480 for impure/normal/pure), `OIL_EXTRACTOR_RATES` (60/120/240), `WELL_SATELLITE_RATES` (30/60/120), `WATER_EXTRACTOR_RATE` (120). Do **not** derive these from `dataset.miners`: those entries use the raw ×1000 fluid convention and would need unpicking for no benefit.

Which extractor applies is decided by item id, matching how `js/ui/inputs.js` classifies resources:
- `Desc_Water_C` → Water Extractor (no purity variants)
- `Desc_LiquidOil_C` → Oil Extractor, normal + pure
- `Desc_NitrogenGas_C` → Well Satellite, normal + pure
- everything else → Miner Mk.1/2/3, normal + pure

- [ ] **Step 1: Write the failing tests**

Append to `test/engine/expansion.test.js`:

```js
const rawFor = (p, itemId) => p.rawNeeded.find((r) => r.itemId === itemId);

test('rawNeeded: reports the rate and whole miners for a solid', () => {
  // 2x rip -> 120 ore/min (verified in the one-block test above).
  const p = plan([{ kind: 'block', recipeId: 'rip', machines: 2, clock: 1 }]);
  const ore = rawFor(p, 'ore');
  assert.equal(ore.needed, 120);
  assert.equal(ore.supplied, 0);
  assert.equal(ore.newRate, 120);
  // Mk.1 normal = 60 -> 2; Mk.2 normal = 120 -> 1; Mk.3 pure = 480 -> 1
  assert.equal(ore.options.find((o) => o.label === 'Miner Mk.1 · normal').count, 2);
  assert.equal(ore.options.find((o) => o.label === 'Miner Mk.2 · normal').count, 1);
  assert.equal(ore.options.find((o) => o.label === 'Miner Mk.1 · pure').count, 1);
});

test('rawNeeded: a raw have row is netted off, not shown as supply usage', () => {
  const p = plan([
    { kind: 'block', recipeId: 'rip', machines: 2, clock: 1 },
    { kind: 'have', itemId: 'ore', rate: 60 },
  ]);
  const ore = rawFor(p, 'ore');
  assert.equal(ore.needed, 120);
  assert.equal(ore.supplied, 60);
  assert.equal(ore.newRate, 60);
  assert.equal(ore.options.find((o) => o.label === 'Miner Mk.1 · normal').count, 1);
  assert.deepEqual(p.supplyUsage, [], 'raw supply never appears in supplyUsage');
});

test('rawNeeded: a raw have row covering everything needs no new extraction', () => {
  const p = plan([
    { kind: 'block', recipeId: 'rip', machines: 2, clock: 1 },
    { kind: 'have', itemId: 'ore', rate: 500 },
  ]);
  const ore = rawFor(p, 'ore');
  assert.equal(ore.newRate, 0);
  assert.deepEqual(ore.options, [], 'nothing to build');
});

test('rawNeeded: a block eating ore directly still reaches the footer', () => {
  const p = plan([{ kind: 'block', recipeId: 'ingot', machines: 3, clock: 1 }]);
  assert.equal(p.tiles.machines, 0, 'nothing upstream to build');
  assert.equal(rawFor(p, 'ore').needed, 90);
});

test('rawNeeded: water, oil, and nitrogen use their own extractors', () => {
  const io = (itemId, perMin) => ({ itemId, perMin });
  const fluids = {
    items: new Map([
      ['Desc_Water_C', { id: 'Desc_Water_C', name: 'Water', slug: 'water', liquid: true }],
      ['Desc_LiquidOil_C', { id: 'Desc_LiquidOil_C', name: 'Crude Oil', slug: 'crude-oil', liquid: true }],
      ['Desc_NitrogenGas_C', { id: 'Desc_NitrogenGas_C', name: 'Nitrogen Gas', slug: 'nitrogen-gas', liquid: true }],
      ['blend', { id: 'blend', name: 'Blend', slug: 'blend', liquid: false }],
    ]),
    buildings: new Map([['b', { id: 'b', name: 'Blender', slug: 'blender', basePowerMW: 75, powerExponent: 1.321928 }]]),
    rawResourceIds: new Set(['Desc_Water_C', 'Desc_LiquidOil_C', 'Desc_NitrogenGas_C']),
    recipes: [{ id: 'mix', name: 'Mix', buildingId: 'b', alternate: false, timeSec: 60,
      inputs: [io('Desc_Water_C', 240), io('Desc_LiquidOil_C', 120), io('Desc_NitrogenGas_C', 60)],
      outputs: [io('blend', 60)] }],
  };
  const p = planExpansion({ dataset: fluids, rows: [{ kind: 'want', itemId: 'blend', rate: 60 }], enabledRecipeIds: new Set(['mix']) });
  const find = (id) => p.rawNeeded.find((r) => r.itemId === id);
  assert.equal(find('Desc_Water_C').options.find((o) => o.label === 'Water Extractor').count, 2);      // 240/120
  assert.equal(find('Desc_LiquidOil_C').options.find((o) => o.label === 'Oil Extractor · normal').count, 1); // 120/120
  assert.equal(find('Desc_NitrogenGas_C').options.find((o) => o.label === 'Well Satellite · normal').count, 1); // 60/60
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npm test 2>&1 | tail -20`
Expected: `Cannot read properties of undefined (reading 'find')` — `p.rawNeeded` doesn't exist.

- [ ] **Step 3: Implement**

Add the import at the top of `js/engine/expansion.js`:

```js
import { MINER_RATES, OIL_EXTRACTOR_RATES, WELL_SATELLITE_RATES, WATER_EXTRACTOR_RATE } from './resource-model.js';
```

Add before `planExpansion`:

```js
const WATER_ID = 'Desc_Water_C';
const OIL_ID = 'Desc_LiquidOil_C';
const NITROGEN_ID = 'Desc_NitrogenGas_C';

/**
 * Whole extractors needed to cover `rate`/min of `itemId`, as labelled options.
 * Reuses the rate tables in resource-model.js rather than dataset.miners, whose
 * fluid entries are in the raw x1000 units.
 */
function extractorOptions(itemId, rate) {
  if (rate <= EPS) return [];
  const count = (per) => ({ count: Math.ceil(rate / per - 1e-9) });
  if (itemId === WATER_ID) return [{ label: 'Water Extractor', ...count(WATER_EXTRACTOR_RATE) }];
  if (itemId === OIL_ID) {
    return [
      { label: 'Oil Extractor · normal', ...count(OIL_EXTRACTOR_RATES.normal) },
      { label: 'Oil Extractor · pure', ...count(OIL_EXTRACTOR_RATES.pure) },
    ];
  }
  if (itemId === NITROGEN_ID) {
    return [
      { label: 'Well Satellite · normal', ...count(WELL_SATELLITE_RATES.normal) },
      { label: 'Well Satellite · pure', ...count(WELL_SATELLITE_RATES.pure) },
    ];
  }
  const options = [];
  for (const tier of ['Mk1', 'Mk2', 'Mk3']) {
    for (const purity of ['normal', 'pure']) {
      options.push({ label: `Miner ${tier.replace('Mk', 'Mk.')} · ${purity}`, ...count(MINER_RATES[tier][purity]) });
    }
  }
  return options;
}

/**
 * Raw resources the expansion draws, what an existing supply already covers, and
 * the extraction still to build. Uncapped by design — see spec §2.
 */
export function rawNeededRows(dataset, rawUsage, rawSupplied) {
  const rows = [];
  for (const [itemId, rawRate] of rawUsage) {
    const needed = round6(rawRate);
    if (needed <= EPS) continue;
    const supplied = round6(rawSupplied.get(itemId) || 0);
    const newRate = round6(Math.max(0, needed - supplied));
    rows.push({
      itemId,
      name: nameOf(dataset, itemId),
      slug: slugOf(dataset, itemId),
      fluid: fluidOf(dataset, itemId),
      needed,
      supplied,
      newRate,
      options: extractorOptions(itemId, newRate),
    });
  }
  return rows.sort((a, b) => b.needed - a.needed);
}
```

In `planExpansion`'s return, replace the `rawUsage` / `rawSupplied` lines with:

```js
    rawNeeded: rawNeededRows(dataset, rawUsage, rawSupplied),
```

- [ ] **Step 4: Run to verify they pass**

Run: `npm test 2>&1 | tail -8`
Expected: `pass 162`, `fail 0`.

- [ ] **Step 5: Commit**

```bash
git add js/engine/expansion.js test/engine/expansion.test.js
git commit -F - <<'EOF'
feat(engine): report raw draw, existing supply, and the extraction to build

The footer answers the question an expansion actually raises — do I need a new
node? — so it reports needed, already-supplied, and the difference, with whole
extractor counts per tier and purity for the difference only.

A raw HAVE row is netted off here rather than becoming an LP supply. Raw
constraints hold net consumption, so a supply variable would invert the sign;
and reporting it in both places at once would have the supply panel calling
ore "capped" while the footer asked for more.

Rates come from resource-model.js, not dataset.miners, whose fluid entries are
still in the raw x1000 units.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
```

---

## Task 5: Goal catalog and evaluation

**Files:**
- Create: `js/domain/goals.js`
- Create: `test/fixtures/goal-data.js`
- Test: `test/domain/goals.test.js`

**Interfaces:**
- Consumes: `dataset.goals` (Task 1), `dataset.items`.
- Produces:
  - `buildGoalCatalog(dataset) -> Goal[]` where
    `Goal = {id, kind: 'milestone'|'phase', label, order, cost: {itemId, name, slug, fluid, amount}[]}`
  - `evaluateGoals(catalog, selectedIds, netOutput, fillMinutes) -> GoalView[]` where
    `GoalView = {id, kind, label, parts: {itemId, name, slug, fluid, amount, netRate, covered, etaMinutes}[], etaMinutes, uncovered: {itemId, name, rate}[]}`
  - Task 8 renders both.

**Context — the phase table.** Space Elevator phase costs are genuinely not in the dataset: `Recipe_SpaceElevator_C` carries only the elevator building's own construction cost, and no schematic's `cost` references any `Desc_SpaceElevatorPart_*`. The five entries below are verified against `satisfactory.wiki.gg/wiki/Space_Elevator` and `/wiki/Project_Assembly`, which agree, and describe Satisfactory 1.0 — matching the pinned dataset commit. All twelve item ids are confirmed present in the dataset.

These are each phase's own cost, **not** cumulative totals (later parts are built from earlier ones, so the roll-up is larger and depends on build order — out of scope, spec §13).

- [ ] **Step 1: Create the fixture**

Create `test/fixtures/goal-data.js`:

```js
// Normalized-Dataset shape for goal tests: two milestones with part costs, the
// items those costs name, one Space Elevator part so the hardcoded phase table
// resolves, and one phase-table item deliberately ABSENT so the drop path is
// exercised.
export const goalDataset = {
  items: new Map([
    ['Desc_IronPlateReinforced_C', { id: 'Desc_IronPlateReinforced_C', name: 'Reinforced Iron Plate', slug: 'reinforced-iron-plate', liquid: false }],
    ['Desc_Rotor_C', { id: 'Desc_Rotor_C', name: 'Rotor', slug: 'rotor', liquid: false }],
    ['Desc_Cable_C', { id: 'Desc_Cable_C', name: 'Cable', slug: 'cable', liquid: false }],
    ['Desc_SpaceElevatorPart_1_C', { id: 'Desc_SpaceElevatorPart_1_C', name: 'Smart Plating', slug: 'smart-plating', liquid: false }],
  ]),
  buildings: new Map(),
  recipes: [],
  rawResourceIds: new Set(),
  generators: [],
  recipeUnlocks: new Map(),
  goals: [
    { id: 'Schematic_3-1_C', name: 'Coal Power', tier: 3, timeSec: 480,
      cost: [{ itemId: 'Desc_IronPlateReinforced_C', amount: 150 }, { itemId: 'Desc_Rotor_C', amount: 50 }, { itemId: 'Desc_Cable_C', amount: 500 }] },
    { id: 'Schematic_2-2_C', name: 'Part Assembly', tier: 2, timeSec: 300,
      cost: [{ itemId: 'Desc_Rotor_C', amount: 100 }] },
  ],
};
```

- [ ] **Step 2: Write the failing tests**

Create `test/domain/goals.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildGoalCatalog, evaluateGoals, SPACE_ELEVATOR_PHASES } from '../../js/domain/goals.js';
import { goalDataset } from '../fixtures/goal-data.js';

const catalog = () => buildGoalCatalog(goalDataset);
const byId = (c, id) => c.find((g) => g.id === id);

test('buildGoalCatalog: milestones come from the dataset, ordered by tier', () => {
  const c = catalog();
  const milestones = c.filter((g) => g.kind === 'milestone');
  assert.deepEqual(milestones.map((g) => g.label), ['Tier 2 · Part Assembly', 'Tier 3 · Coal Power']);
});

test('buildGoalCatalog: cost entries carry display data resolved from items', () => {
  const g = byId(catalog(), 'Schematic_3-1_C');
  assert.deepEqual(g.cost[0], {
    itemId: 'Desc_IronPlateReinforced_C', name: 'Reinforced Iron Plate',
    slug: 'reinforced-iron-plate', fluid: false, amount: 150,
  });
});

test('buildGoalCatalog: phases follow milestones and are labelled by number and name', () => {
  const c = catalog();
  const phases = c.filter((g) => g.kind === 'phase');
  assert.equal(phases[0].label, 'Phase 1 · Distribution Platform');
  assert.ok(c.indexOf(phases[0]) > c.indexOf(byId(c, 'Schematic_3-1_C')), 'milestones sort first');
});

// A renamed part after a dataset bump must not take the panel down.
test('buildGoalCatalog: a phase cost id missing from items is dropped, not thrown', () => {
  const c = catalog();
  const phase1 = c.find((g) => g.id === 'phase-1');
  assert.deepEqual(phase1.cost.map((p) => p.itemId), ['Desc_SpaceElevatorPart_1_C'], 'the one present item survives');
  const phase3 = c.find((g) => g.id === 'phase-3');
  assert.equal(phase3, undefined, 'a phase with no resolvable cost drops entirely');
});

test('SPACE_ELEVATOR_PHASES: the five 1.0 phase costs', () => {
  assert.equal(SPACE_ELEVATOR_PHASES.length, 5);
  assert.deepEqual(SPACE_ELEVATOR_PHASES[0].cost, [{ itemId: 'Desc_SpaceElevatorPart_1_C', amount: 50 }]);
  assert.equal(SPACE_ELEVATOR_PHASES[1].cost.find((c) => c.itemId === 'Desc_SpaceElevatorPart_1_C').amount, 1000);
  assert.equal(SPACE_ELEVATOR_PHASES[4].cost.find((c) => c.itemId === 'Desc_SpaceElevatorPart_12_C').amount, 256);
});

test('evaluateGoals: only selected goals are returned, in catalog order', () => {
  const views = evaluateGoals(catalog(), ['Schematic_3-1_C'], new Map(), 10);
  assert.deepEqual(views.map((v) => v.id), ['Schematic_3-1_C']);
});

test('evaluateGoals: ETA is amount / net rate, and the goal ETA is the slowest part', () => {
  const net = new Map([
    ['Desc_IronPlateReinforced_C', 15],   // 150 / 15 = 10 min
    ['Desc_Rotor_C', 10],                 //  50 / 10 =  5 min
    ['Desc_Cable_C', 25],                 // 500 / 25 = 20 min  <- gates
  ]);
  const [v] = evaluateGoals(catalog(), ['Schematic_3-1_C'], net, 10);
  assert.deepEqual(v.parts.map((p) => p.etaMinutes), [10, 5, 20]);
  assert.equal(v.etaMinutes, 20, 'the slowest part gates delivery');
  assert.deepEqual(v.uncovered, []);
});

test('evaluateGoals: an unproduced part has no ETA and lands in uncovered', () => {
  const net = new Map([['Desc_Rotor_C', 10]]);
  const [v] = evaluateGoals(catalog(), ['Schematic_3-1_C'], net, 10);
  const plate = v.parts.find((p) => p.itemId === 'Desc_IronPlateReinforced_C');
  assert.equal(plate.covered, false);
  assert.equal(plate.etaMinutes, null);
  assert.equal(v.etaMinutes, null, 'the goal has no ETA while any part is unproduced');
  assert.deepEqual(v.uncovered.map((u) => u.itemId), ['Desc_IronPlateReinforced_C', 'Desc_Cable_C']);
});

test('evaluateGoals: uncovered rates convert the cost stock into a flow over fillMinutes', () => {
  const [v] = evaluateGoals(catalog(), ['Schematic_3-1_C'], new Map(), 10);
  assert.equal(v.uncovered.find((u) => u.itemId === 'Desc_Cable_C').rate, 50);   // 500 / 10
  const [v2] = evaluateGoals(catalog(), ['Schematic_3-1_C'], new Map(), 20);
  assert.equal(v2.uncovered.find((u) => u.itemId === 'Desc_Cable_C').rate, 25);  // 500 / 20
});

test('evaluateGoals: a non-positive fillMinutes falls back to 10 rather than dividing by zero', () => {
  const [v] = evaluateGoals(catalog(), ['Schematic_3-1_C'], new Map(), 0);
  assert.equal(v.uncovered.find((u) => u.itemId === 'Desc_Cable_C').rate, 50);
});

test('evaluateGoals: an unknown selected id is skipped', () => {
  assert.deepEqual(evaluateGoals(catalog(), ['nope'], new Map(), 10), []);
});
```

- [ ] **Step 3: Run to verify they fail**

Run: `npm test 2>&1 | tail -20`
Expected: `Cannot find module .../js/domain/goals.js`.

- [ ] **Step 4: Implement `js/domain/goals.js`**

```js
/**
 * Goals for the Expansion view: what the game asks you to deliver, and how far
 * your plan gets you. Two sources — HUB tier milestones straight from the
 * dataset, and the Space Elevator phases, which the dataset doesn't carry.
 *
 * Pure — no DOM, no engine imports, deterministic.
 * @typedef {import('./model.js').Dataset} Dataset
 */

const DEFAULT_FILL_MINUTES = 10;

/**
 * Space Elevator (Project Assembly) phase costs — hand-authored, because they are
 * genuinely absent from the dataset: Recipe_SpaceElevator_C holds only the
 * elevator building's own construction cost, and no schematic's `cost` references
 * any Desc_SpaceElevatorPart_*.
 *
 * Satisfactory 1.0, matching the pinned dataset commit. Verified against
 * https://satisfactory.wiki.gg/wiki/Space_Elevator and
 * https://satisfactory.wiki.gg/wiki/Project_Assembly, which agree.
 *
 * These are each phase's OWN cost, not a cumulative total: later parts are built
 * from earlier ones, so the roll-up is larger and depends on build order.
 */
export const SPACE_ELEVATOR_PHASES = [
  { id: 'phase-1', number: 1, name: 'Distribution Platform', cost: [
    { itemId: 'Desc_SpaceElevatorPart_1_C', amount: 50 },        // Smart Plating
  ] },
  { id: 'phase-2', number: 2, name: 'Construction Dock', cost: [
    { itemId: 'Desc_SpaceElevatorPart_1_C', amount: 1000 },      // Smart Plating
    { itemId: 'Desc_SpaceElevatorPart_2_C', amount: 1000 },      // Versatile Framework
    { itemId: 'Desc_SpaceElevatorPart_3_C', amount: 100 },       // Automated Wiring
  ] },
  { id: 'phase-3', number: 3, name: 'Main Body', cost: [
    { itemId: 'Desc_SpaceElevatorPart_2_C', amount: 2500 },      // Versatile Framework
    { itemId: 'Desc_SpaceElevatorPart_4_C', amount: 500 },       // Modular Engine
    { itemId: 'Desc_SpaceElevatorPart_5_C', amount: 100 },       // Adaptive Control Unit
  ] },
  { id: 'phase-4', number: 4, name: 'Propulsion', cost: [
    { itemId: 'Desc_SpaceElevatorPart_7_C', amount: 500 },       // Assembly Director System
    { itemId: 'Desc_SpaceElevatorPart_6_C', amount: 500 },       // Magnetic Field Generator
    { itemId: 'Desc_SpaceElevatorPart_8_C', amount: 250 },       // Thermal Propulsion Rocket
    { itemId: 'Desc_SpaceElevatorPart_9_C', amount: 100 },       // Nuclear Pasta
  ] },
  { id: 'phase-5', number: 5, name: 'Assembly', cost: [
    { itemId: 'Desc_SpaceElevatorPart_9_C', amount: 1000 },      // Nuclear Pasta
    { itemId: 'Desc_SpaceElevatorPart_10_C', amount: 1000 },     // Biochemical Sculptor
    { itemId: 'Desc_SpaceElevatorPart_12_C', amount: 256 },      // AI Expansion Server
    { itemId: 'Desc_SpaceElevatorPart_11_C', amount: 200 },      // Ballistic Warp Drive
  ] },
];

/**
 * Resolve cost entries against the dataset's items. An id the dataset doesn't
 * know is dropped with a warning rather than thrown: one renamed part after a
 * dataset bump must not take the whole panel down.
 */
function resolveCost(dataset, cost, goalLabel) {
  const out = [];
  for (const c of cost) {
    const item = dataset.items.get(c.itemId);
    if (!item) {
      console.warn(`goals: ${goalLabel} needs unknown item ${c.itemId}; skipping that line`);
      continue;
    }
    out.push({ itemId: c.itemId, name: item.name, slug: item.slug, fluid: !!item.liquid, amount: c.amount });
  }
  return out;
}

/**
 * Every goal you can work toward: milestones by tier, then Space Elevator phases.
 * A goal whose cost lines all fail to resolve is omitted.
 * @param {Dataset} dataset
 */
export function buildGoalCatalog(dataset) {
  const catalog = [];

  const milestones = [...(dataset.goals || [])].sort((a, b) => a.tier - b.tier || a.name.localeCompare(b.name));
  for (const m of milestones) {
    const label = m.tier > 0 ? `Tier ${m.tier} · ${m.name}` : m.name;
    const cost = resolveCost(dataset, m.cost, label);
    if (cost.length === 0) continue;
    catalog.push({ id: m.id, kind: 'milestone', label, order: m.tier, cost });
  }

  for (const p of SPACE_ELEVATOR_PHASES) {
    const label = `Phase ${p.number} · ${p.name}`;
    const cost = resolveCost(dataset, p.cost, label);
    if (cost.length === 0) continue;
    catalog.push({ id: p.id, kind: 'phase', label, order: p.number, cost });
  }

  return catalog;
}

/**
 * Score the selected goals against what the plan actually emits.
 *
 * A goal's ETA is the MAX across its parts — the slowest part gates delivery, so
 * a sum or an average would both understate it. Any unproduced part leaves the
 * goal ETA null: there's no honest number while something isn't being made.
 *
 * `uncovered` converts each unproduced part's cost (a stock) into a rate (a flow)
 * over `fillMinutes`, which is what a WANT row takes.
 *
 * @param {ReturnType<typeof buildGoalCatalog>} catalog
 * @param {string[]} selectedIds
 * @param {Map<string, number>} netOutput  per-item rate leaving the plan
 * @param {number} fillMinutes
 */
export function evaluateGoals(catalog, selectedIds, netOutput, fillMinutes) {
  const selected = new Set(selectedIds || []);
  const minutes = Number(fillMinutes) > 0 ? Number(fillMinutes) : DEFAULT_FILL_MINUTES;
  const round2 = (x) => Math.round(x * 100) / 100;

  return catalog.filter((g) => selected.has(g.id)).map((g) => {
    const parts = g.cost.map((c) => {
      const netRate = netOutput.get(c.itemId) || 0;
      const covered = netRate > 1e-6;
      return { ...c, netRate: round2(netRate), covered, etaMinutes: covered ? round2(c.amount / netRate) : null };
    });
    const uncovered = parts
      .filter((p) => !p.covered)
      .map((p) => ({ itemId: p.itemId, name: p.name, rate: round2(p.amount / minutes) }));
    const etaMinutes = uncovered.length > 0 ? null : Math.max(...parts.map((p) => p.etaMinutes));
    return { id: g.id, kind: g.kind, label: g.label, parts, etaMinutes, uncovered };
  });
}
```

- [ ] **Step 5: Run to verify they pass**

Run: `npm test 2>&1 | tail -8`
Expected: `pass 173`, `fail 0`. Two `goals:` warnings on stderr from the deliberately-absent phase items are expected.

- [ ] **Step 6: Verify against the real dataset**

Run:
```bash
node --input-type=module -e "
import { normalize } from './js/data/normalize.js';
import { buildGoalCatalog } from './js/domain/goals.js';
import { readFileSync } from 'node:fs';
const ds = normalize(JSON.parse(readFileSync('/tmp/satis-data.json','utf8')));
const c = buildGoalCatalog(ds);
console.log('catalog:', c.length, '=', c.filter(g=>g.kind==='milestone').length, 'milestones +', c.filter(g=>g.kind==='phase').length, 'phases');
console.log('first:', c[0].label, '| last:', c[c.length-1].label);
" 2>&1
```
Expected: `catalog: 47 = 42 milestones + 5 phases`, `first: Tier 1 · Base Building | last: Phase 5 · Assembly`, and **no** `goals:` warnings — every phase item id resolves against the real dataset.

- [ ] **Step 7: Commit**

```bash
git add js/domain/goals.js test/fixtures/goal-data.js test/domain/goals.test.js
git commit -F - <<'EOF'
feat(domain): goal catalog and progress scoring for milestones and phases

42 milestones come from the dataset. The five Space Elevator phases are
hand-authored because they genuinely aren't in it — Recipe_SpaceElevator_C
carries only the elevator's own build cost, and no schematic cost references a
Desc_SpaceElevatorPart_*. Verified against two agreeing wiki.gg pages for 1.0,
which is the version the pinned dataset commit describes.

A goal's ETA is the max across its parts, not the sum or the mean: the slowest
part gates delivery. Any unproduced part leaves the ETA null rather than
quoting a number that assumes something you aren't making.

An unresolvable cost id warns and drops. A renamed part after a dataset bump
should cost you one line, not the panel.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
```
---

## Task 6: Extract the searchable combobox

**Files:**
- Create: `js/ui/search-select.js`
- Modify: `js/ui/inputs.js` (delete lines 78-222, add an import)
- Test: none new — the existing 173 are the regression net.

**Interfaces:**
- Consumes: `iconUrl` from `js/ui/icons.js` (already exported).
- Produces: `createSearchSelect({options, placeholder, showIcon}) -> {el, getValue, setValue, onSelect}`
  where `options` is `{id, name, slug}[]`. Task 7 consumes it.

**Context — why this is a prerequisite, not a nicety.** Both new row types need a picker over hundreds of options: 300+ machine recipes for block rows, 175 items for want/have rows. A plain `<select>` at that size is unusable. The combobox that solves it already exists at `js/ui/inputs.js:78-222` but is module-private, and it contains ~145 lines of focus/blur/mousedown sequencing that was deliberate — selection fires on `mousedown` with `preventDefault` so the input doesn't blur first, and the blur handler is deferred with `setTimeout(…, 0)` so a click-selection wins the race. Duplicating that is how it drifts.

This is the same extraction the icon helper went through in `aa006a9`. **Move it verbatim** — no behaviour changes, no signature changes, no "improvements" while it's in flight.

- [ ] **Step 1: Confirm the green baseline**

Run: `npm test 2>&1 | tail -5`
Expected: `pass 173`, `fail 0`. Note the number; it must be identical at Step 5.

- [ ] **Step 2: Create `js/ui/search-select.js`**

Move `js/ui/inputs.js` lines 78-222 verbatim, plus the `el` helper it depends on. Prepend this header and export the function:

```js
/**
 * Searchable single-select combobox — a text input that filters a list of a few
 * hundred options, with the selected option's icon overlaid inside the input's
 * left edge.
 *
 * Shared by the Optimizer sidebar (js/ui/inputs.js) and the Expansion view
 * (js/ui/expansion.js): both need to pick from 175 items or 300+ recipes, where a
 * native <select> is unusable.
 *
 * The event sequencing is deliberate, not incidental. Selection fires on
 * `mousedown` with `preventDefault()` so the input never blurs first, and the blur
 * handler defers via setTimeout so a click-selection always wins the race against
 * the list-hide. Change it only with a reason.
 */
import { iconUrl } from './icons.js';

function el(tag, className) {
  const n = document.createElement(tag);
  if (className) n.className = className;
  return n;
}

export function createSearchSelect({ options, placeholder = 'Search…', showIcon = false }) {
  // ... lines 79-221 of the original, unchanged ...
}
```

- [ ] **Step 3: Update `js/ui/inputs.js`**

Delete lines 78-222 (the whole `createSearchSelect` definition) and add to the imports at the top:

```js
import { createSearchSelect } from './search-select.js';
```

Leave the local `el` helper in `inputs.js` — the rest of that file uses it. Check whether `iconUrl` is still referenced elsewhere in `inputs.js` (it is, in `makeResourceRow`) and keep that import.

- [ ] **Step 4: Verify nothing regressed**

Run: `npm test 2>&1 | tail -5`
Expected: `pass 173`, `fail 0` — the same number as Step 1.

Then verify the picker still works in a browser, because no unit test covers this DOM:

```bash
python3 -m http.server 8765 >/dev/null 2>&1 &
sleep 1
curl -s http://localhost:8765/js/ui/search-select.js | head -3
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:8765/js/ui/inputs.js
```
Then open `http://localhost:8765/` and confirm: the Resources picker opens on focus, filters as you type, selects on click, and shows the item icon inside the input. Kill the server when done (`kill %1`).

- [ ] **Step 5: Commit**

```bash
git add js/ui/search-select.js js/ui/inputs.js
git commit -F - <<'EOF'
refactor(ui): extract the searchable combobox for reuse

The Expansion view needs the same picker twice over — 300+ recipes for block
rows, 175 items for want/have rows — and a native <select> at that size is
unusable. createSearchSelect already solved it, but privately inside inputs.js.

Moved verbatim, same shape as the icon-helper extraction in aa006a9. The
mousedown-with-preventDefault selection and the deferred blur are load-bearing
(they settle the click-vs-blur race), so the move carries a note saying so
rather than inviting a tidy-up.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
```

---

## Task 7: The Expansion view

**Files:**
- Create: `js/ui/expansion.js`
- Modify: `index.html` (tab button after line 21, view div after line 39)
- Modify: `js/main.js` (`VIEWS` map line 50-54, import line 6, `buildSecondaryView` call after line 139)
- Modify: `css/styles.css` (append)
- Test: `test/ui/expansion.test.js` (pure helpers only)

**Interfaces:**
- Consumes: `planExpansion` (Tasks 3-4), `createSearchSelect` (Task 6), `iconEl` from `js/ui/icons.js`.
- Produces: `buildExpansion(dataset, container)`, plus `sanitizeState(raw) -> {rows, goals, fillMinutes}`
  and `DEFAULT_STATE`, both exported so the persistence path is unit-testable without a DOM.
  Task 8 adds the goals panel to this same file.
- Not exported: `readRows()` is an internal closure over the live row controls (each row
  object exposes `read()`), not a pure function of state. It has no test of its own —
  it's DOM plumbing, and `sanitizeState` covers the part that can be tested purely.

**Context.** Follow `js/ui/power.js` exactly as the pattern: `buildExpansion(dataset, container)` clears the container, restores state from `localStorage` inside try/catch, builds controls, and recomputes on input. `js/main.js` already isolates secondary-view failures (`buildSecondaryView`), so a throw here degrades to a message in this pane and leaves the Optimizer working.

State key: `sat-optimizer:expansion:v1`. Shape `{rows: Row[], goals: string[], fillMinutes: number}`.

Recipe options for block rows: every recipe in `dataset.recipes` whose `buildingId` resolves, labelled `"<recipe name> · <building name>"` so `Motor · Assembler` is distinguishable from an alternate. Item options for want/have rows: every non-`special__` item.

- [ ] **Step 1: Write the failing tests for the pure helpers**

Create `test/ui/expansion.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeState, DEFAULT_STATE } from '../../js/ui/expansion.js';

test('sanitizeState: null / garbage falls back to defaults', () => {
  assert.deepEqual(sanitizeState(null), DEFAULT_STATE);
  assert.deepEqual(sanitizeState('nope'), DEFAULT_STATE);
  assert.deepEqual(sanitizeState({}), DEFAULT_STATE);
});

test('sanitizeState: drops rows with an unknown kind', () => {
  const s = sanitizeState({ rows: [
    { kind: 'block', recipeId: 'r', machines: 2, clock: 1 },
    { kind: 'wat', itemId: 'x', rate: 5 },
  ] });
  assert.deepEqual(s.rows.map((r) => r.kind), ['block']);
});

test('sanitizeState: coerces numbers and drops non-numeric rates', () => {
  const s = sanitizeState({ rows: [
    { kind: 'block', recipeId: 'r', machines: '6', clock: '1.5' },
    { kind: 'want', itemId: 'a', rate: 'abc' },
    { kind: 'have', itemId: 'b', rate: '300' },
  ] });
  assert.deepEqual(s.rows[0], { kind: 'block', recipeId: 'r', machines: 6, clock: 1.5 });
  assert.equal(s.rows.length, 2, 'the non-numeric rate row is dropped');
  assert.deepEqual(s.rows[1], { kind: 'have', itemId: 'b', rate: 300 });
});

test('sanitizeState: keeps only string goal ids and a positive fillMinutes', () => {
  const s = sanitizeState({ goals: ['a', 7, null, 'b'], fillMinutes: -3 });
  assert.deepEqual(s.goals, ['a', 'b']);
  assert.equal(s.fillMinutes, 10, 'a non-positive horizon falls back to the default');
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npm test 2>&1 | tail -10`
Expected: `Cannot find module .../js/ui/expansion.js`.

- [ ] **Step 3: Implement `js/ui/expansion.js`**

Structure it in this order. Keep it under ~380 lines; if it grows past that, split the result-rendering half into `js/ui/expansion-render.js`.

```js
/**
 * Expansion view: declare the machine blocks you've decided to build and whatever
 * is already on your bus, and see what has to feed them.
 *
 * DOM only — all arithmetic lives in js/engine/expansion.js and js/domain/goals.js.
 */
import { iconEl as icon } from './icons.js';
import { createSearchSelect } from './search-select.js';
import { planExpansion } from '../engine/expansion.js';

const STATE_KEY = 'sat-optimizer:expansion:v1';
const DEFAULT_FILL_MINUTES = 10;
export const DEFAULT_STATE = { rows: [], goals: [], fillMinutes: DEFAULT_FILL_MINUTES };

const fmt1 = (x) => Math.round(x * 10) / 10;
const fmt2 = (x) => Math.round(x * 100) / 100;

function el(tag, className) {
  const n = document.createElement(tag);
  if (className) n.className = className;
  return n;
}

/**
 * Coerce whatever came out of localStorage into a usable state. Persisted state
 * outlives code, so an old or hand-edited payload must degrade to defaults rather
 * than throwing during boot.
 */
export function sanitizeState(raw) {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_STATE };
  const rows = [];
  for (const r of Array.isArray(raw.rows) ? raw.rows : []) {
    if (!r || typeof r !== 'object') continue;
    if (r.kind === 'block') {
      const machines = Number(r.machines);
      const clock = Number(r.clock);
      if (typeof r.recipeId !== 'string' || !Number.isFinite(machines)) continue;
      rows.push({ kind: 'block', recipeId: r.recipeId, machines, clock: Number.isFinite(clock) && clock > 0 ? clock : 1 });
    } else if (r.kind === 'want' || r.kind === 'have') {
      const rate = Number(r.rate);
      if (typeof r.itemId !== 'string' || !Number.isFinite(rate)) continue;
      rows.push({ kind: r.kind, itemId: r.itemId, rate });
    }
  }
  const goals = (Array.isArray(raw.goals) ? raw.goals : []).filter((g) => typeof g === 'string');
  const fill = Number(raw.fillMinutes);
  return { rows, goals, fillMinutes: Number.isFinite(fill) && fill > 0 ? fill : DEFAULT_FILL_MINUTES };
}

function loadState() {
  try { return sanitizeState(JSON.parse(localStorage.getItem(STATE_KEY) || 'null')); }
  catch { return { ...DEFAULT_STATE }; }
}

function saveState(state) {
  try { localStorage.setItem(STATE_KEY, JSON.stringify(state)); } catch { /* storage unavailable: session-only */ }
}
```

Then, in the same file:

1. `recipeOptions(dataset)` — `dataset.recipes` filtered to those whose building resolves, mapped to `{id: recipe.id, name: `${recipe.name} · ${building.name}`, slug: outputSlug}`, so the picker's icon shows the product.
2. `itemOptions(dataset)` — `dataset.items` values, excluding ids starting with `special__`, as `{id, name, slug}`.
3. `makeBlockRow`, `makeRateRow(kind)` — each returns `{el, read(), remove}`. A block row is: `createSearchSelect` over recipe options, a machine-count `number` input (min 1, step 1), a clock `number` input (min 1, max 250, step 1, suffix `%`), a derived building label, and a remove button. A rate row is: `createSearchSelect` over item options, a rate `number` input, and a remove button.
4. `renderPlan(wrap, dataset, plan)` — the eight panels in spec order: tiles, to-build table, machine totals, your blocks, net output, supply used, raw needed, belts. Each panel returns early and renders nothing when its data is empty. Reuse `icon(slug, kind)` for every row, with `'fluid'` for `fluid: true` items and `'building'` for buildings.
5. `buildExpansion(dataset, container)` — assemble, wire `recompute` (which calls `readRows()`, `planExpansion(...)`, `renderPlan(...)`, `saveState(...)`), debounce input at 150ms to match `js/main.js`, and render an empty-state hint when `!plan.hasPlan`:
   > *"Add a block — say 6 Assemblers making Motors — and this will work out what has to feed it."*

`enabledRecipeIds` for this view is **all** recipes (`new Set(dataset.recipes.map(r => r.id))`). The Optimizer's alternate-recipe checkboxes are that view's state; wiring them across views is out of scope.

Raw-needed rows render as:
```
Iron Ore  720/min needed · 480/min already supplied
          → 240/min new = 2× Miner Mk.2 · normal, 1× Miner Mk.3 · normal
```
with the `already supplied` clause omitted when `supplied === 0`, and the whole `→` line replaced by *"covered by your existing supply"* when `newRate === 0`.

- [ ] **Step 4: Run to verify the helper tests pass**

Run: `npm test 2>&1 | tail -8`
Expected: `pass 177`, `fail 0`.

- [ ] **Step 5: Wire it into the app**

`index.html` — after line 21 (`#tab-codex`):
```html
    <button id="tab-expansion" class="viewtab" type="button">🧱 Expansion</button>
```
and after line 39 (the codex view div):
```html
  <div class="expansion-view" id="view-expansion" hidden>
    <!-- factory expansion planner (js/ui/expansion.js) -->
  </div>
```

`js/main.js` — add the import after line 6:
```js
import { buildExpansion } from './ui/expansion.js';
```
add to `VIEWS` (line 53):
```js
  expansion: { viewId: 'view-expansion', tabId: 'tab-expansion' },
```
and after line 139:
```js
  buildSecondaryView(dataset, 'view-expansion', 'Expansion', buildExpansion);
```

Update the view-tabs comment on line 48-49 to mention the fourth view.

- [ ] **Step 6: Append the CSS**

Append an `.exp*` block to `css/styles.css` using only existing tokens. Two-column layout (rows panel left, results right) collapsing to one column at `<=800px`, matching `.codex-view`. Number inputs get `min-height: 44px` for the tap target. Any rule that sizes an icon inside an expansion row must use `:is(.icon, .icon-fallback)`.

- [ ] **Step 7: Verify in a browser**

```bash
python3 -m http.server 8765 >/dev/null 2>&1 &
sleep 1
```
Because headless Chrome can't click a view tab, create a throwaway `_shot-exp.html` at the repo root that imports `buildExpansion` and mounts it directly into a visible div (the technique used in earlier phases — never commit it). Screenshot it:
```bash
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new \
  --screenshot=/tmp/exp.png --window-size=1400,1600 http://localhost:8765/_shot-exp.html
```
Read `/tmp/exp.png` and confirm: both panels render, no dark-on-dark text, icons load, no horizontal overflow. Then delete `_shot-exp.html` and `kill %1`.

Also confirm by hand in a real browser that adding `6× Assembler → Motor` produces a non-empty To-build table, and that a reload restores the rows.

- [ ] **Step 8: Commit**

```bash
git add js/ui/expansion.js test/ui/expansion.test.js index.html js/main.js css/styles.css
git commit -F - <<'EOF'
feat(ui): the Expansion view — declare blocks, see what feeds them

Fourth tab. Left panel takes block rows (6x Assembler on Motors, with a clock),
flat want rates, and have rates; right panel reports machines to build, machine
totals, net output, supply drawn, ore still needed with extractor counts, and
belts.

State is sanitized on load rather than trusted: persisted state outlives code,
so an old payload degrades to defaults instead of throwing during boot. Unknown
row kinds and non-numeric rates drop.

enabledRecipeIds is every recipe here. The Optimizer's alternate checkboxes are
that view's state, and sharing them across views is a separate decision.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
```

---

## Task 8: The Goals panel

**Files:**
- Modify: `js/ui/expansion.js` (add the goals panel + `Add shortfall` wiring)
- Modify: `css/styles.css` (append `.exp-goal*` rules)
- Test: `test/ui/expansion.test.js` (append)

**Interfaces:**
- Consumes: `buildGoalCatalog`, `evaluateGoals` (Task 5); `plan.netOutput` (Task 3).
- Produces: `uncoveredToRows(goalViews) -> {kind:'want', itemId, rate}[]`, exported for test.

**Context.** The catalog is built once at view construction (`buildGoalCatalog(dataset)`) — it doesn't depend on the rows. `evaluateGoals` runs on every recompute against `plan.netOutput`.

`Add shortfall as WANT rows` is the one destructive-ish action here, so it must be honest: the button label states the count (`Add 2 shortfalls as WANT rows`), it is disabled when there are none, and it de-duplicates — an item that already has a want row is skipped rather than added twice.

- [ ] **Step 1: Write the failing test**

Append to `test/ui/expansion.test.js`:

```js
import { uncoveredToRows } from '../../js/ui/expansion.js';

test('uncoveredToRows: one want row per uncovered part, de-duplicated across goals', () => {
  const views = [
    { id: 'g1', uncovered: [{ itemId: 'a', name: 'A', rate: 20 }, { itemId: 'b', name: 'B', rate: 5 }] },
    { id: 'g2', uncovered: [{ itemId: 'a', name: 'A', rate: 50 }] },
  ];
  const rows = uncoveredToRows(views);
  assert.deepEqual(rows, [
    { kind: 'want', itemId: 'a', rate: 50 },
    { kind: 'want', itemId: 'b', rate: 5 },
  ], 'the same item across two goals takes the higher rate, not the sum');
});

test('uncoveredToRows: nothing uncovered yields no rows', () => {
  assert.deepEqual(uncoveredToRows([{ id: 'g', uncovered: [] }]), []);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test 2>&1 | tail -10`
Expected: `uncoveredToRows is not a function`.

- [ ] **Step 3: Implement**

Add to `js/ui/expansion.js`:

```js
import { buildGoalCatalog, evaluateGoals } from '../domain/goals.js';

/**
 * Want rows for every part the selected goals still need. Where two goals want the
 * same part, the higher rate wins rather than the sum: the rates are independent
 * "deliver this much within the horizon" figures, and adding them would size the
 * factory for delivering both goals simultaneously, which isn't what was asked.
 */
export function uncoveredToRows(goalViews) {
  const best = new Map();
  for (const v of goalViews || []) {
    for (const u of v.uncovered || []) {
      if (!best.has(u.itemId) || u.rate > best.get(u.itemId)) best.set(u.itemId, u.rate);
    }
  }
  return [...best].map(([itemId, rate]) => ({ kind: 'want', itemId, rate }));
}
```

Then in `buildExpansion`:
1. Build the catalog once: `const catalog = buildGoalCatalog(dataset);`
2. Render a scrollable checkbox list (milestones grouped by tier, then phases), each checkbox toggling membership in `state.goals` and triggering recompute.
3. A `fill in [N] min` number input bound to `state.fillMinutes` (min 1, step 1).
4. On recompute, `const goalViews = evaluateGoals(catalog, state.goals, plan.netOutput, state.fillMinutes)` and render per goal: label, ETA (`~20 min` or `—`), and one line per part — `icon · name ×amount` then either `✓ 15/min → 10 min` or `✗ not produced`.
5. The `Add shortfall` button: label from `uncoveredToRows(goalViews).length`, disabled at zero, and on click append each returned row (skipping items that already have a want row) then recompute.

Cap the goal list at `40vh` on the `<=800px` stacked layout, and put that override **after** the base rule — equal specificity means source order decides, the same trap the Codex hit.

- [ ] **Step 4: Run to verify it passes**

Run: `npm test 2>&1 | tail -8`
Expected: `pass 179`, `fail 0`.

- [ ] **Step 5: Verify in a browser**

Rebuild the throwaway `_shot-exp.html` harness, tick `Phase 2 · Construction Dock` and a tier milestone, and confirm: part lines render with icons, covered parts show an ETA, uncovered show `not produced`, and `Add N shortfalls as WANT rows` adds exactly those rows and then reports zero. Delete the harness.

- [ ] **Step 6: Commit**

```bash
git add js/ui/expansion.js css/styles.css test/ui/expansion.test.js
git commit -F - <<'EOF'
feat(ui): Goals panel — milestone and phase progress, both directions

Tick a milestone or Space Elevator phase and see its part costs, which ones
your plan already emits, and an ETA for the rest. Then push the other way:
"Add N shortfalls as WANT rows" turns what's missing into demand.

A cost is a stock and a want row is a flow, so the conversion needs a stated
horizon — hence the "fill in [10] min" field rather than a hidden constant.

Where two goals want the same part the higher rate wins rather than the sum:
the rates are independent deliver-within-the-horizon figures, and adding them
would size for delivering both goals at once.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
```

---

## Task 9: Extract `buildGraph` and add the diagram (droppable)

**Files:**
- Create: `js/engine/graph.js`
- Modify: `js/ui/view-model.js` (delete lines 26-139, add an import)
- Modify: `js/ui/expansion.js` (build and render the graph)
- Test: none new — `test/ui/view-model.test.js` is the regression net.

**Interfaces:**
- Consumes: nothing new.
- Produces: `buildGraph(dataset, recipeRates, machinesById, targetItemIds) -> {nodes, edges, tiers}`, consumed by `view-model.js` and `expansion.js`, rendered by the existing `renderDiagram` in `js/ui/diagram.js`.

**This task is optional.** It is sequenced last so it can be dropped without affecting Tasks 1-8. Drop it if the view is already doing enough.

- [ ] **Step 1: Confirm the green baseline**

Run: `npm test 2>&1 | tail -5`
Expected: `pass 179`, `fail 0`.

- [ ] **Step 2: Move `buildGraph` verbatim**

Create `js/engine/graph.js` with this header, then `js/ui/view-model.js` lines 26-139 (`buildGraph` and its `nameOf`/`slugOf`/`fluidOf` helpers) moved unchanged and exported:

```js
/**
 * Tiered flow graph of a build: raw sources at tier 0, one node per active recipe,
 * and one sink per item leaving the system — "output" for targets, "surplus" for
 * anything else left over. Tiers are the longest path from raw, computed by
 * relaxation and guarded against cycles.
 *
 * Pure. Shared by the Optimizer (js/ui/view-model.js) and the Expansion view
 * (js/ui/expansion.js); js/ui/diagram.js lays out whatever this returns.
 */
```

- [ ] **Step 3: Update `js/ui/view-model.js`**

Delete lines 26-139 and import instead:
```js
import { buildGraph } from '../engine/graph.js';
```
`nameOf` / `slugOf` / `fluidOf` are used elsewhere in `view-model.js`, so keep the local copies there — duplicated three-line helpers are cheaper than a shared module for them.

- [ ] **Step 4: Verify no regression**

Run: `npm test 2>&1 | tail -5`
Expected: `pass 179`, `fail 0` — identical to Step 1.

Then screenshot the Optimizer's diagram (it needs no throwaway harness, being the default view) and confirm it is unchanged:
```bash
python3 -m http.server 8765 >/dev/null 2>&1 &
sleep 1
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new \
  --screenshot=/tmp/optimizer.png --window-size=1400,1600 http://localhost:8765/
kill %1
```

- [ ] **Step 5: Render the diagram in the Expansion view**

In `js/ui/expansion.js`, import `buildGraph` and `renderDiagram`, build
`buildGraph(dataset, recipeRates, machinesById, [...plan.netOutput.keys()])`
and append it below the belts panel. This needs `planExpansion` to also return
`recipeRates` and a `machinesById` Map — add both to its return object and to the
`ExpansionPlan` field table in the spec.

- [ ] **Step 6: Verify and commit**

Screenshot the Expansion view via the throwaway harness, confirm the diagram renders with sane tiers, delete the harness, then:

```bash
git add js/engine/graph.js js/ui/view-model.js js/ui/expansion.js docs/superpowers/specs/2026-08-03-factory-expansion-mode-design.md
git commit -F - <<'EOF'
refactor(engine): share buildGraph, and draw the expansion

buildGraph was 105 of view-model.js's 345 lines, already pure, and exactly what
the Expansion view needed to draw itself. Moved rather than copied; the existing
view-model tests are the regression net and diagram.js is untouched.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
```

---

## Final verification

- [ ] `npm test` → `pass 179`, `fail 0` (or 179 with Task 9 dropped)
- [ ] `git log --oneline -9` shows one commit per completed task
- [ ] All four tabs work in a real browser; switching between them doesn't break any
- [ ] Reload restores Expansion rows, goal selections, and the fill horizon
- [ ] Light mode is legible in the new view (`Toggle theme`) — the repo's light mode is under-tested, so eyeball it
- [ ] No `_shot-*.html` harness left behind: `git status --short` is clean
- [ ] A real-dataset smoke test: `6× Assembler → Motor` plus `Rubber @ 300/min` gives a plausible build with no console errors

## Self-Review Notes

Checked against the spec, section by section:

- §3 input model → Task 7 (all three row kinds); §3.3 raw-HAVE divergence → Tasks 3-4; §3.4 state → Task 7 Step 1-3.
- §4/§5 engine → Tasks 2-4. §5.2's two invariants (separate kinds, strictly-positive costs) each have a dedicated test.
- §6 output shape → Task 3, with §6.1's `netOutput` formula getting the two double-count regression tests.
- §7 goals → Task 5 (catalog/eval) + Task 8 (panel). §7.1's MAM exclusion is asserted in Task 1.
- §8.1 combobox → Task 6 (prerequisite); §8.2 graph → Task 9 (droppable).
- §9 data layer → Task 1. §10 wiring → Task 7 Step 5. §11 phasing → this plan's nine tasks.
- §12's 17 anchor cases all appear: 1→T3, 2→T3, 3→T3, 4→T3 (rod-surplus test), 5→T3, 6→T3, 7→T3, 8→T4, 9→T3 (clock), 9b→T3/T4, 10→T2, 11→T4, 12→T3, 12b→T2, 13→T5, 14→T8, 15→T2, 16→T5, 17→T7.

Two things a reviewer should push back on if they disagree:

1. **Task 6 is a prerequisite, not optional.** The spec originally framed the only refactor as droppable; extracting the combobox is not, because both new row types are unusable without it. If you'd rather not touch `inputs.js`, the fallback is a native `<select>` over 300 recipes — worse, but it unblocks Tasks 7-8.
2. **`uncoveredToRows` takes the max, not the sum,** for a part two goals both want. Summing would size the factory to deliver both goals within the same horizon, which nobody asked for. Debatable; it's one line to change.
