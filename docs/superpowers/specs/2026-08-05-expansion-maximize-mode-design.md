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
| `js/engine/optimize.js` | `maxSets` (`:49`) threads `supplies` through to the builder on both passes, and returns a `supplyDrawn` array in the same shape `hitTargets` already returns — one entry per input supply, unfiltered, in input order. §5.2's binding check depends on it. |
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
whether any declared supply is **binding**: `used >= rate - EPS`.

**Max mode must compute this itself, from `solved.supplyDrawn`.** It must NOT reuse the
existing `supplyUsage` readout, for two independent reasons — both verified by reading
`js/engine/expansion.js`:

1. `supplyUsage` is filtered to `kind === 'have'` (`:387`). A Built block's output enters as
   `kind: 'pinned'`, so the very supply that bounds a maximize answer never appears there.
2. Its `capped` flag is `used >= s.rate - EPS && builtItems.has(s.itemId)` (`:384`). That
   second clause is deliberate for target-rates mode, where "capped" means *you ran dry and
   had to build more*. In max mode the item's recipes are **excluded** (§3.2), so nothing
   builds it, `builtItems` cannot contain it, and `capped` is always `false` for exactly the
   supply we care about — precisely backwards.

`solved.supplyDrawn` is the right source: one entry per input supply, unfiltered, in input
order (`js/engine/optimize.js`, `hitTargets`), so it pairs positionally with the `supplies`
array. `maxSets` must return `supplyDrawn` in the same shape for this to work (§5.1).

- **At least one binding** → report the maximum and name what binds it.
- **None binding** → do not print a rate. Show: *"Your declared lines don't feed
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

Built `6× Assembler · Motor` (30 Motor/min), maximize Modular Engine, base recipes only.
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
2. Max mode with a Built block bounds the answer at the block's output: the iron-chain
   analogue of the §6 example, asserting the exact maximum and that it is *not* the
   1e9-clamp number.
3. **The exclusion is what bounds it** — remove it and the answer explodes. This is the test
   that would have caught the 21-million bug; it must fail if §3.2 is dropped.
4. A block's **byproduct** is NOT excluded: a block whose recipe has a second output does not
   stop the planner producing that second item.
5. A **HAVE row** is not a ceiling: the planner may still build more of a have-row item.
6. **Binding diagnostic**: a target fed by a declared line reports that line as binding; a
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
