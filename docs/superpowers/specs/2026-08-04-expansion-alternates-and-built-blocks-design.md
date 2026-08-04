# Expansion: Alternates Picker + Built/To-build Blocks — Design Spec

Date: 2026-08-04
Status: Awaiting user review
Depends on: `2026-08-03-factory-expansion-mode-design.md` (the Expansion view this
modifies — §3 state, §5 engine, §6 panels, §13 deferred list), and through it
`2026-07-22-satisfactory-optimizer-design.md` (base architecture, view tabs, icon +
theming conventions)

Supersedes two entries in `2026-08-03-factory-expansion-mode-design.md` §13.1: the
deferred alternates picker (built here as §3) and, from §13, "Marking a block as
'already built' vs 'planned'" (built here as §4).

## 1. Overview

Two changes to the 🧱 Expansion view, both narrowing what the planner assumes on
your behalf.

**Alternates picker (§3).** The view currently solves with all 110 alternate
recipes enabled, so it can prescribe a recipe you haven't unlocked. It gets the
Optimizer's picker, defaulting to all-off.

**Built vs To-build blocks (§4).** A block row currently means "plan this and
everything that feeds it", so declaring `6× Assembler · Motor` reports Rotors,
Stators, iron ore and miner counts. That is the wrong question for an existing
line. Each block row gains a Built / To-build choice:

- **Built** — the machines exist and are already fed. Only their **output** enters
  the plan; their feedstock is ignored.
- **To build** — today's behaviour. Their feedstock is planned upstream.

The motivating case, stated by the user: *"if I want a certain number of modular
engines from 6 motors, show all the buildings/parts I need to expand there"* — not
the parts that feed the motors, which already run.

```
┌─ ALTERNATE RECIPES (0/110 enabled) ─┐   Built 6× Motor + want 10 Modular Engine/min
│ [filter…]      [all on] [all off]   │
│ ☐ Alternate: Rigor Motor            │   TO BUILD
│ ☐ Alternate: Electric Motor         │     Modular Engine  ← the want
│ ☐ Alternate: Heavy Oil Residue      │     Smart Plating   ┐ the want's other
│ …                                   │     Rubber         ┘ ingredients, + upstream
└─────────────────────────────────────┘     Reinforced Iron Plate, Iron Rod, …
┌─ BLOCKS ────────────────────────────┐
│ 🔧 Motor · Assembler                │   NOT shown any more:
│ Machines [6]  Clock% [100]          │     Rotor, Stator, Iron Ore, miners
│ ◉ Built  ○ To build       [Remove]  │     — the Motors are already fed
└─────────────────────────────────────┘
```

## 2. Goals / Non-goals

**Goals**

- The Expansion view never silently assumes an unlocked recipe.
- A block can represent an existing line without dragging its upstream into the plan.
- Both settings persist with the rest of the Expansion state.
- No behaviour change to the Factory Optimizer, Power Generation, or Codex views.

**Non-goals**

- Alternate *suggestions* in Expansion. The Optimizer's `suggestAlternates`
  (`js/engine/suggestions.js`) could rank which disabled alternates would improve an
  expansion plan, and the machinery is view-agnostic, but it is its own feature.
- Shard-budget / belt-tier / pipe-tier controls for this view (still deferred; belt
  line counts still assume Mk.4).
- Making a **To build** block's machines count toward the "Machines to build" tile.
  Blocks are excluded from the tiles today; that inconsistency predates this change,
  and fixing it here would conflate two concerns. See §9.
- Sharing alternates state with the Optimizer. Decided against in §3.1.

## 3. Alternates picker

### 3.1 State ownership

The Expansion view keeps its **own** enabled-alternates set, persisted in its own
`localStorage` payload. It does not read or write the Optimizer's.

Rejected: one shared set across both views. It matches reality (a recipe is either
unlocked in your save or it isn't), but it couples the views, requires `inputs.js` to
publish its set, and means testing a hypothetical in the Optimizer silently rewrites
a real expansion plan. Independent state is the smaller, more predictable design; a
"copy from Optimizer" button can be added later if the divergence ever annoys.

### 3.2 Shared widget — `js/ui/alt-picker.js` (new)

The Optimizer's picker is ~60 lines of DOM in `js/ui/inputs.js` (collapsible
`<details>`, count in the summary, filter box, enable-all / disable-all, one labelled
checkbox per alternate). Extract it verbatim into `js/ui/alt-picker.js` and have both
views construct it.

Follows the precedent set by `js/ui/search-select.js`, which was extracted from the
same file for the same reason. The alternative — a second copy in the Expansion view —
guarantees the two drift.

Interface:

```js
createAltPicker({ recipes, initialEnabled, onChange }) -> {
  el,                  // the <details> element, ready to append
  getEnabledIds(),     // Set<recipeId> of checked alternates
  setEnabled(ids),     // restore from saved state
}
```

`recipes` is the full alternate list; the widget sorts by name itself. `onChange`
fires on every checkbox and on the bulk buttons.

**Extraction discipline.** `inputs.js` feeds the live Optimizer, so the moved body
must be byte-identical apart from the parameterisation, and the Optimizer's rendered
DOM must be verified unchanged before and after (the technique already used for
`search-select.js`: render both trees over the real dataset and compare `innerHTML`).

While in there, fix the section comment `--- Alt recipes (searchable, collapsible,
default all-on) ---` at `js/ui/inputs.js:517`, which contradicts both the code below
it and its own next line. Alternates are off by default.

### 3.3 Wiring into Expansion

`js/ui/expansion.js:390` currently builds the enabled set as *every* recipe:

```js
const enabledRecipeIds = new Set(dataset.recipes.map((r) => r.id));
```

It becomes the Optimizer's rule — every base recipe, plus checked alternates:

```js
for (const r of dataset.recipes) {
  if (!r.alternate) enabledRecipeIds.add(r.id);
  else if (altPicker.getEnabledIds().has(r.id)) enabledRecipeIds.add(r.id);
}
```

Recomputed on every picker change, through the existing debounce.

The alternates disclosure hint at `js/ui/expansion.js:406` ("Assumes every alternate
recipe is unlocked…") is **deleted** — the picker replaces it.

### 3.4 The picker gates choices, not declarations

`enabledRecipeIds` constrains what the **LP may select**. It must not constrain what
the **user may declare**. A block row's recipe picker keeps offering the whole
catalogue, including unchecked alternates: a block states what you have, and blocks
are pinned, never solved. A Built block on `Alternate: Rigor Motor` with that
alternate unchecked is valid and must plan normally.

This is the one place the two concepts could be wrongly conflated, so it gets an
explicit test (§8).

### 3.5 Expected consequence

Plans get more expensive across the board — more machines, more ore — because base
recipes are less efficient. This is correct. Wants that are only reachable via an
alternate become unproducible and surface the existing requirements callout, which is
why that callout's rendering was fixed before this work.

## 4. Built vs To-build blocks

### 4.1 Row shape

`{ kind: 'block', recipeId, machines, clock, built }` — `built` is a boolean.

New rows default to `built: true`, per the user's stated primary workflow. A saved row
with no `built` field is also read as `true`, which **changes the meaning of any
existing saved plan**: its blocks stop planning their feedstock. Called out here
because it is a silent semantic change to persisted data, not a bug.

### 4.2 Engine rule — `pinnedBalance` (`js/engine/expansion.js:74`)

Today every block contributes its net balance per touched item, so inputs come out
negative and become LP targets:

```js
for (const itemId of touched(recipe)) add(net, itemId, load * netPerMin(recipe, itemId));
```

Split by flag:

- **To build** — unchanged: net across every touched item.
- **Built** — contribute **gross output only**. Iterate the recipe's `outputs` and add
  `load * outputPerMin(recipe, itemId)`; contribute nothing for inputs.

"Gross output, not positive net" matters for the three dataset recipes with an item on
both sides — Encased Uranium Cell, Alternate: Instant Scrap, Alternate: Distilled
Silica. For a Built block the input side is externally fed by definition, so the full
output rate is available; taking `Math.max(0, net)` instead would under-report those
three. Note two of the three are alternates, so with the §3 default they are
unreachable by the LP but still declarable as a block — which is precisely the §3.4
distinction, and why the §8.3 test uses a fixture rather than the live dataset.

Both kinds still merge into the one `netPinned` map, so a Built line's output can
cover a To-build block's demand in the same plan.

### 4.3 What falls out for free

`splitDemand` already routes positive entries to `supplies`/`rawCredit` and negative
entries to `targets`/`rawDemand`. A Built block emits no negatives, so with no further
change it stops producing LP targets and stops appearing in the raw footer. No change
to `splitDemand`, the LP, `realize`, or `beltReport`.

### 4.4 Display

- Each block row gets the Built / To-build control. Two radios, not a checkbox: the
  states are a symmetric either/or and both labels must be readable.
- The "Your blocks" panel (`js/ui/expansion-render.js`) shows which kind each row is,
  using the existing chip style.
- The Blocks section hint changes from "Machines you've decided to build, e.g. 6×
  Assembler making Motors" — now wrong for the default — to text covering both kinds.
- `blockRows` gains the flag so the panel can render it.

## 5. State and persistence

`js/ui/expansion.js`'s `sanitizeState` extends to:

| Field | Sanitising | Fallback |
|---|---|---|
| `rows[].built` | exactly `built === false` means To build; **everything else** — `true`, absent, or a non-boolean from a hand-edited payload — means Built | `true` |
| `alts` | `Array.isArray`, keep `typeof === 'string'`, ignore ids not in the dataset | `[]` |

`alts` holds only **enabled** alternate ids, so the all-off default is the empty array
and a dataset bump that removes a recipe degrades to "not enabled" rather than
throwing. Unknown ids are dropped on load, matching how `goals` already behaves.

The existing `STATE_KEY` (`sat-optimizer:expansion:v1`) is **not** bumped: every change
here is additive and older payloads degrade correctly per §4.1 and the table above.

## 6. Worked example (the motivating case)

Verified against the pinned dataset: Modular Engine = Motor ×2 + Rubber ×15 + Smart
Plating ×2; Motor = Rotor ×2 + Stator ×2.

Built block `6× Assembler · Motor` (30 Motor/min), want `Modular Engine 10/min`:

| | Before | After |
|---|---|---|
| Rotor, Stator, iron ore, miner counts | planned and listed | **absent** — Motors are fed |
| Modular Engine Manufacturers | planned | planned |
| Rubber, Smart Plating + their upstream | planned | planned — the *want's* ingredients |
| Motor | 30/min surplus in Net output | consumed by the Engines |

10 Modular Engine/min needs 20 Motor/min, so 30/min covers it with 10/min left as net
output. Asking for more than 15/min reports a Motor shortfall through the existing
shortfalls panel rather than silently building more Motors — correct, because the
block is a declaration of capacity, not a target.

## 7. Files

| File | Change |
|---|---|
| `js/ui/alt-picker.js` | **new** — widget extracted from `inputs.js` (§3.2) |
| `js/ui/inputs.js` | use the extracted widget; fix the stale comment at :517 |
| `js/ui/expansion.js` | mount the picker; build `enabledRecipeIds` from it; Built/To-build control per row; `sanitizeState` for `built` + `alts`; drop the disclosure hint; reword the Blocks hint |
| `js/engine/expansion.js` | `pinnedBalance` splits Built (gross output) from To-build (net) |
| `js/ui/expansion-render.js` | show each block's kind in "Your blocks" |
| `css/styles.css` | styles for the new row control, additively |

## 8. Testing (TDD, `node --test` via `npm test`)

Engine (`test/engine/expansion.test.js`):

1. `pinnedBalance`: a Built block contributes only its outputs — no negative entries.
2. `pinnedBalance`: a To-build block is unchanged (regression guard on existing tests).
3. Gross-not-net: a Built block on a recipe with an item on both sides reports the full
   output rate, which `Math.max(0, net)` would under-report. Uses a fixture recipe, not
   the live dataset — `test/fixtures/mini-data.js` must not be modified, so this goes in
   `iron-chain.js` or an inline literal.
4. End-to-end §6: Built Motor block + Modular Engine want ⇒ build rows include Rubber
   and Smart Plating, exclude Rotor and Stator, and `rawNeeded` has no iron ore.
5. The same plan with the block flipped to To-build ⇒ Rotor and Stator return.
6. Mixed plan: a Built line's output covers a To-build block's demand.

Alternates:

7. A want reachable only via an alternate is unproducible with the picker empty, and
   producible once that id is enabled.
8. §3.4: a **block** on an unchecked alternate still plans normally.

State (`test/ui/expansion.test.js`):

9. `sanitizeState`: `built` absent ⇒ `true`; `built: false` preserved as `false`; a
   non-boolean (e.g. the string `"false"`) ⇒ `true`, per §5.
10. `sanitizeState`: `alts` drops non-strings and ids absent from the dataset.

Widget (`test/ui/alt-picker.test.js`, pure exports only):

11. Whatever of the widget is pure — id filtering / sort order — is unit-tested. The DOM
    body is verified by the byte-identical-move check in §3.2 plus running the app,
    consistent with the suite having no DOM shim.

The Optimizer's `test/ui/view-model.test.js` and the LP tests must pass unchanged —
they are the regression signal for the §3.2 extraction.

## 9. Out of scope / deferred (carried forward)

- Alternate suggestions in Expansion (§2).
- Shard-budget / belt-tier / pipe-tier controls; belt counts still assume Mk.4.
- **To build** blocks' machines counting toward the "Machines to build" tile and the
  machine-totals chips. Today the tiles cover the upstream only, so a To-build block is
  invisible in them; arguably wrong, but pre-existing and separable. Note that with
  Built as the default this matters less, since a Built block *shouldn't* count.
- Sharing alternates state with the Optimizer, or a "copy from Optimizer" button (§3.1).
- The missing DOM shim, and the Optimizer's own unclamped inputs / save-before-compute
  ordering — see `2026-07-22-satisfactory-optimizer-design.md` §22.
