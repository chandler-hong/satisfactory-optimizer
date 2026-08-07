# Expansion: Maximize Mode — Design Spec

Date: 2026-08-05
Status: Awaiting user review
Depends on: `2026-08-04-expansion-alternates-and-built-blocks-design.md` (Built/To-build
blocks, the alternates picker, and the `supplies` LP primitive this builds on), and through
it `2026-08-03-factory-expansion-mode-design.md` (the Expansion view itself) and
`2026-07-22-satisfactory-optimizer-design.md` (base architecture, the Optimizer's own
two-mode pattern)

## 1. Overview

The Expansion view answers *"I've declared these lines — what do I need to add to hit these
rates?"* It has one solve mode: target rates. This adds the other question, the one the
Optimizer already answers for ore nodes:

> *"I have 6 Assemblers making Motors. What buildings and parts do I need to make the most
> Modular Engines I can, efficiently?"*

Answer for that example, verified against the pinned dataset: **15 Modular Engine/min**, bound
by Motor 30/min. See §6.

### 1.1 The problem that shapes the whole design

Expansion deliberately leaves raw resources **uncapped** — `js/engine/expansion.js:277-283`
sets every touched raw to `Infinity`, because node budgeting is the Optimizer's job. Maximize
against free raws is unbounded. Measured, not theorised: running the Optimizer's `maxOutput`
with Expansion's own caps over the real dataset returns

```
maxRate = 21308980.2130898   Modular Engine/min
```

because the planner simply builds unlimited Motors from unlimited ore. So maximize needs
something to push against, and picking that bound *is* the design.

## 2. Goals / Non-goals

**Goals**

- Maximize a target (or balanced sets of targets) bounded by what the user has **declared**,
  not by ore.
- "Efficiently" means what it already means in the Optimizer: among all solutions achieving
  the maximum, use the least raw material.
- Say what is binding, so the number is interpretable.
- Refuse to print a meaningless number when nothing bounds the answer.
- No behaviour change to target-rates mode, the Optimizer, Power Generation, or Codex.

**Non-goals**

- Ore/node caps in Expansion. That is the Optimizer's panel and duplicating it here would
  make the user describe their whole ore situation before getting an answer (§3.1 rejected
  alternative).
- A build budget ("most engines for ≤50 machines"). A different, interesting question; not
  this one.
- Goals (HUB milestones / Space Elevator phases) in max mode. A milestone is a *fixed cost*,
  not something to maximize. Goals stays a target-rates feature (§5.2).
- Shard-budget / belt-tier / pipe-tier controls (still deferred from the prior spec).

## 3. What bounds the answer

Two mechanisms, and the second is what actually stops the 21-million answer.

**3.1 Declared supply becomes capped LP supply.** Each declared non-raw item enters the model
as a supply variable with a hard upper bound at its rate. The primitive already exists:
`addSupplies` (`js/engine/lp-builder.js:28-42`) creates one variable per `(itemId, kind)` with
a `{ max: rate }` constraint and correctly skips raws. Today it is called from exactly one
place, `buildTargetRatesModel` (`:119`).

*Rejected: ore caps as the bound.* Mathematically the cleanest and most familiar, but it
duplicates the Optimizer's resource panel and forces the user to model their ore before
asking a question that isn't about ore. The whole point of this view is to start from the
factory you already have.

**3.2 Recipes producing a block's PRIMARY OUTPUT are excluded from the planner's choices.**
Capping Motor supply at 30/min is not enough on its own: the supply is free, so the planner
takes all 30 and then builds more Motor machines from free ore, and we are back to 21 million.
A block is a statement about the user's *capacity* for that item, so the planner may not add
to it.

**3.3 The asymmetry — and why it is load-bearing.** The §3.2 exclusion applies **only to a
block row's primary output** (`recipe.outputs[0]`). It does **not** apply to:

- **A block's byproducts.** They remain supply credits, exactly as `pinnedBalance` already
  treats them.
- **HAVE rows.** They stay plain capped supplies the planner may supplement.

This is not hair-splitting. A block making Aluminum Scrap also outputs Water; excluding every
water-producing recipe in the game because the user declared one Scrap line would wreck the
plan. And a HAVE row means "I can draw 300 Rubber/min off my bus", not "300 Rubber/min is all
the Rubber that can exist in the world" — the planner should still be free to build more.

Stated as one rule: **a block declares a ceiling on its primary output; everything else
declared is a floor you can draw on.**

## 4. Efficiently

No new machinery. `maxSets` (`js/engine/optimize.js:49-60`) already runs two passes —
maximize sets, then minimize raw usage among the optimal solutions. So of all the ways to
reach 15 Modular Engine/min, the reported build is the one needing the least ore. Mirroring
the Optimizer here is the point; this bullet exists so nobody re-implements it.

## 5. Changes

### 5.1 Engine

| File | Change |
|---|---|
| `js/engine/lp-builder.js` | `buildMaxSetsModel` (`:131`) gains a `supplies = []` parameter and calls the existing `addSupplies`, as `buildTargetRatesModel` does at `:119`. **Call order matters:** it must run *before* the `variables[id][SETS] = 0` normalization loop (`:139-141`), so the new supply variables get that coefficient like every other variable. `buildMinRawForSetsModel` needs no change — it delegates to `buildMaxSetsModel(args)`, so the second (min-raw) pass inherits the supplies for free. |
| `js/engine/optimize.js` | `maxSets` (`:49`) threads `supplies` through to the builder on both passes, and returns **two** arrays in the same shape `hitTargets`' `supplyDrawn` already has — one entry per input supply, unfiltered, in input order. `supplyDrawn` is filled from the min-raw pass and answers "how much did we use" (display). `supplyAtMax` is filled from pass 1 and answers "is this the binding constraint" (§5.2's check), and is left all-zero when pass 1 comes back unbounded. |
| `js/engine/expansion.js` | `planExpansion` gains `mode: 'targets' \| 'max'`, **defaulting to `'targets'`**. In `'max'` mode it calls `maxSets` instead of `hitTargets` (`:286`), computes the §3.2 exclusion set, and returns the maximize readout of §5.3. |

`splitDemand`, `realize`, `beltReport`, `computeNetOutput`, the raw footer, and the diagram are
**untouched** — max mode differs only in which solver runs and what bounds it. The default
keeps every existing caller and all 236 tests unaffected.

**Blocks have no feedstock to plan in max mode.** A block is always already built and already
fed, so it can never appear in `splitDemand`'s `targets` map as a deficit — only want-row
demand can, and max mode replaces the Want section with Maximize targets, so that map is
always empty here too. `maxSets` therefore needs no notion of a minimum rate: there is nothing
left for a floor to protect. `buildMaxSetsModel` briefly gained a `minRates` parameter for
this (mirroring `buildTargetRatesModel`'s targets-as-floors), but it was reverted once the
Built/To-build distinction was dropped — no caller could ever populate it. Neither
`buildMaxSetsModel` nor `maxSets` takes a floors argument.

The exclusion set is computed from the block rows: for each row whose recipe resolves, take
`recipe.outputs[0].itemId` — already how this codebase reads a primary output elsewhere in
both `js/engine/expansion.js` and `js/ui/expansion.js` — then remove from `enabledRecipeIds`
every recipe that outputs that item.

Applies to every block: excluding a block's own recipe from the LP's choices does not remove
the block itself — blocks are applied through `pinnedBalance`, never through
`enabledRecipeIds` — so the block's declared output stays intact. That separation is what
makes the exclusion safe to state so bluntly.

### 5.2 The unbounded guard

If nothing the user declared feeds the target, the LP is bounded only by
`rawConstraints`' 1e9 clamp and will report a meaningless number. Max mode therefore checks
whether any declared supply is **fully consumed**: `rate > EPS && used >= rate - EPS`. Two
further conditions, both added by later fix rounds, are part of the same check:

- **The item must not be producible.** A supply whose item is reachable from
  `dataset.rawResourceIds` through the post-exclusion recipe set — `producibleClosure`
  (`js/engine/requirements.js`), the same fixpoint the "no recipe path" diagnostic already
  trusts — bounds nothing, because the planner could simply build more of it. Drawing such
  a supply dry is a coincidence, not a ceiling. Reachability is deliberately *static*: a
  gate on `solved.recipeRates` would read a live producer that this particular solve left
  at rate 0 as dead.
- **No raw may be sitting at the clamp.** A declared supply can be drawn dry on one route
  while the real answer runs away on a bypass route to `RAW_CLAMP`. So the pre-want LP raw
  usage is checked independently against `RAW_CLAMP * (1 - 1e-6)`; if any raw is at the
  clamp the answer is unbounded no matter what looks fully consumed. Do **not** reach for
  `solved.bindingResources` instead — Expansion's raw caps are all `Infinity`, so that
  comparison is always against `Infinity` and the array is always empty.

**Max mode must compute this itself, from `solved.supplyAtMax`.** It must NOT reuse the
existing `supplyUsage` readout, for two independent reasons — both verified by reading
`js/engine/expansion.js`:

1. `supplyUsage` is filtered to `kind === 'have'`. A block's output enters as
   `kind: 'pinned'`, so the very supply that bounds a maximize answer never appears there.
2. Its `capped` flag is `used >= s.rate - EPS && builtItems.has(s.itemId)`. That
   second clause is deliberate for target-rates mode, where "capped" means *you ran dry and
   had to build more*. In max mode the item's recipes are **excluded** (§3.2), so nothing
   builds it, `builtItems` cannot contain it, and `capped` is always `false` for exactly the
   supply we care about — precisely backwards.

**And it must read pass 1, not pass 2.** This spec originally said `solved.supplyDrawn`;
that was wrong, and reading it is precisely the bug a later fix round removed.
`supplyDrawn` tracks `chosen`, the min-raw second pass, whose `SETS` floor is relaxed by
`minSets - Math.abs(minSets) * 1e-9 - 1e-9` — a give with a relative **and** a flat term.
Below roughly `sets = 1e-3` the flat term dominates and is non-monotone in `sets`, so a
genuinely binding supply's pass-2 draw falls short of its declared rate by more than any
margin tuned off the rate alone; four rounds of margin-tuning went into that before the
real diagnosis. Pass 1 (`buildMaxSetsModel`) has no give at all — `SETS` is the direct
objective, not a bound relaxed afterwards — so a truly binding supply is drawn to its rate
there at every reachable scale, closely enough for a plain absolute `EPS`. Hence the two
arrays in §5.1: `supplyDrawn` (pass 2) for the "how much did we use" display, which must
match the reported build, and `supplyAtMax` (pass 1) for detection. They are two different
questions and were conflated onto one value for three rounds.

- **At least one fully consumed** → report the maximum and name the lines that are fully
  consumed — without claiming any of them *causes* it (§5.3).
- **None** → do not print a rate. Show: *"Your declared lines don't feed
  <target> — there's nothing here to bound the answer. Add a block or a have row that
  <target> depends on."*

This also covers the degenerate case of max mode with no block or have rows at all.

### 5.3 Readout

The headline names the bound, because an unexplained maximum is not actionable:

```
MOST YOU CAN MAKE      15 Modular Engine/min

At their limit:
  Motor    30/min   (fully used)
```

**Why "at their limit" and not "bound by".** Naming *which* declared line causes the
maximum is mathematically ill-posed, and this was established the hard way — four fix
rounds of margin-tuning before the real diagnosis. Pass 1 of `maxSets` is entirely
cost-blind (every variable but `__sets__` carries `[SETS] = 0`, and `RAWCOST` has no
constraint), so where two declared lines are interchangeable feeds for the same item the
LP has genuinely multiple optima and the solver picks a vertex arbitrarily. Demonstrated:
two fungible supplies plus a third line as the real ceiling reports all of them, yet
doubling *or* halving the named one leaves `sets` unchanged. No epsilon, margin, or choice
of solve pass fixes that.

What IS sound is the weaker claim, and it has a structural proof: the only non-homogeneous
constraints in max mode are supply caps and raw caps, so a finite positive optimum must
have one of them tight in *every* optimum. So the readout reports which lines are **fully
consumed** — true in all cases — and does not claim causation. `bounded` keeps its full
meaning; only the naming is demoted.

With several targets it reads as the Optimizer's balanced sets — `N sets/min` plus a per-part
breakdown. Everything below the headline (To build, machine totals, net output, supply used,
raw needed, belts, diagram) renders exactly as it does now.

### 5.4 UI

A **Maximize / Target rates** toggle mirroring the Optimizer's own mode select. In max mode
the Want section becomes **Maximize** targets: an item picker plus an optional weight, no rate
box. Target-rates mode is unchanged, and the Goals panel renders only in target-rates mode
(§2 non-goal) with a one-line note saying so rather than vanishing silently.

`mode` and the maximize targets persist in the existing Expansion `localStorage` payload
alongside `rows`, `goals`, `fillMinutes` and `alts`. `STATE_KEY` is **not** bumped: an older
payload has no `mode`, which sanitises to the `'targets'` default and so behaves exactly as it
does today.

## 6. Worked example — verified before this spec was written

A `6× Assembler · Motor` block (30 Motor/min), maximize Modular Engine, base recipes only.
`Modular Engine = Motor ×2 + Rubber ×15 + Smart Plating ×2`.

I simulated §3's exact semantics with existing machinery — base recipes minus everything
producing Motor, plus Motor as a capped 30/min supply, raws free — and probed the boundary
with `hitTargets`:

| Target | Result |
|---|---|
| 15/min | feasible, **no shortfall** |
| 15.5/min | infeasible, shortfall 0.50 |
| 16/min | infeasible, shortfall 1.00 |

So the maximum is exactly **15/min**, which is 30 Motor/min ÷ 2 per engine. The plan that
delivers it builds the Modular Engine Manufacturers plus the Smart Plating, Rubber,
Reinforced Iron Plate, Rotor, Iron Plate, Iron Rod, Screws and Iron Ingot chain, and reports
the iron ore and crude oil behind it — Rotors included, because Smart Plating needs Rotors
independently of the Motors.

## 7. Testing (TDD, `node --test` via `npm test`)

Baseline is **236 pass, 0 fail**. Engine tests go in `test/engine/expansion.test.js`; the
`{ ...ironChain, recipes: [...] }` throwaway-dataset pattern is already established there
(`oreMakerDataset`, `altDataset`, `loopDataset`) — `test/fixtures/mini-data.js` and
`test/fixtures/iron-chain.js` must not be modified.

1. `buildMaxSetsModel` with `supplies` produces the cap constraint; without it, unchanged
   (byte-compare the model against the current builder to prove the default is inert).
2. Max mode with a block bounds the answer at the block's output: the iron-chain
   analogue of the §6 example, asserting the exact maximum and that it is *not* the
   1e9-clamp number.
3. **The exclusion is what bounds it** — remove it and the answer explodes. This is the test
   that would have caught the 21-million bug; it must fail if §3.2 is dropped.
4. A block's **byproduct** is NOT excluded: a block whose recipe has a second output does not
   stop the planner producing that second item.
5. A **HAVE row** is not a ceiling: the planner may still build more of a have-row item.
6. **Fully-consumed diagnostic**: a target fed by a declared line reports that line as
   fully consumed; a
   target that touches nothing declared reports the unbounded case and **no rate**.
7. Balanced sets: two targets with weights maximize matched sets, not one at the other's
   expense.
8. `mode` defaults to `'targets'` — `planExpansion` called without it behaves identically
   (regression guard for all 236 existing tests).
9. `sanitizeState`: `mode` absent ⇒ `'targets'`; an unknown string ⇒ `'targets'`; maximize
   targets sanitise like want rows.

The Optimizer's `test/ui/view-model.test.js` and the LP tests must pass unchanged — they are
the regression signal for the `lp-builder.js` and `optimize.js` edits.

## 8. Out of scope / deferred

- Ore caps in Expansion (§2, §3.1).
- A build-budget bound (§2).
- Goals in max mode (§2, §5.4).
- Shard-budget / belt-tier / pipe-tier controls; belt line counts still assume Mk.4.
- Alternate *suggestions* in Expansion — `suggestAlternates` is view-agnostic and could rank
  which disabled alternates would raise the maximum, which is a natural follow-up but its own
  feature.
