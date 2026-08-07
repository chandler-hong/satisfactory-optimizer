# Satisfactory Resource Optimizer

A static, browser-based production planner for **Satisfactory (v1.2)**. Enter the raw
resources you have (ore nodes by purity × miner tier), a power-shard budget, and a belt
tier — get an **optimal factory build** (best recipes incl. alternates, machine counts,
clocks, power, and belt/pipe lines) computed via linear programming, with item/building
icons.

**Two modes:** **Max one part** (maximize a target from your resources) and **Target
rates** (hit specific rates; shortfalls reported).

**Requirements check:** when you pick a target, the planner shows which raw resources it
needs — each marked ✓ added or ✗ missing — and flags impossible resource/target combos
(e.g. Crude Oil → Modular Frame) with a clear "recheck your resources or target" error
instead of a silent empty plan.

**Alternate suggestions:** with alternate recipes off, the planner points out the specific
disabled alternates that would improve *this* build — more output, fewer machines, or
meeting a target you're short on — each with a one-click **Enable**.

**Power generation:** pick a generator and its fuel, describe your fuel supply (nodes ×
miner tier for solid raw fuels, or a rate for anything else), and see how many *whole*
generators it runs, the total MW, the water extractors needed, and any byproduct.

**Codex:** a searchable reference for every item, like the one in-game — its description,
stack size and sink points, every recipe that makes it and every recipe that uses it (with
per-craft amounts, the building, and craft time), and how each recipe is unlocked (tier
milestone, MAM research, or hard drive). Click any ingredient to jump to its own entry.

**Expansion:** planning in the other direction — instead of "what can my ore make?", start
from the factory you already have. Declare your blocks (6× Assembler making Motors, at
whatever clock) and whatever is already on your bus, then pick a mode.

**Target rates** adds a flat extra demand on top of the blocks and works out the upstream:
what to build to feed it, the machine totals, the net output leaving the factory, how much
of your existing supply gets used (and whether it runs out), the raw rates with whole miner
counts per tier and purity, belts/pipes, power, and a factory diagram. Tick a HUB milestone
or Space Elevator phase and it checks the plan against that goal's cost, showing what's still
uncovered and roughly how long the plan takes to fill it — with a one-click button to turn
the gaps into demand rows.

**Maximize** flips the question: instead of a demand rate, pick one or more parts to make as
much of as your declared blocks and existing supply allow (weight sets the ratio between them
when you pick more than one). The result names whatever supply is fully used — "At their
limit: Motor 30/min (fully used)" — or says plainly that nothing bounds it yet if none of your
blocks feed the target. Maximize has no flat demand to declare and no fixed milestone cost to
check against, so the Want and Goals sections step aside for it (each leaves a one-line note
explaining why, rather than just disappearing); Have stays available in both modes, as supply
either one can draw from.

A block is something you already have — already built and already fed — so only what it
*makes* counts toward the plan; its own inputs never create upstream demand. The planner
works out what else you need to add. Declare your existing 6× Assembler Motor line as a
block and ask for 10 Modular Engine/min: the plan needs 465 iron ore/min and 97 machines
in total, including ×5 Rotor machines — Smart Plating, further up the Modular Engine
chain, still needs Rotors of its own, on top of whatever the Motor line already covers
internally.

That last part is a change in what a block *means*, and it reaches back into saved plans.
A block used to have its own feedstock planned upstream as well; now it never does. The
storage key was deliberately left unbumped — every row you declared is still a valid
declaration and throwing them away would be worse — so an older saved plan loads intact
and silently answers differently: the very rows in the example above used to report 1410
iron ore/min, 267 machines and ×20 Rotor, and now report 465, 97 and ×5. Nothing is lost
or corrupted and nothing warns you on load; the numbers just move. If a returning plan
looks smaller than you remember, that's why.

The Expansion view has its own alternate-recipe picker, starting with all of them off, so it
won't prescribe a recipe you haven't unlocked. It's independent of the Optimizer's picker —
the two views can hold different sets, which is useful for testing a hypothesis in one
without disturbing a real plan in the other. Note the picker governs what the *planner may
choose*, not what you may *declare*: a block row can name any recipe you actually have,
enabled or not. One caveat remains — the view uses the default belt tier rather than the
Optimizer's sidebar setting, so line counts assume Mk.4.

## Run the app

ES modules + `fetch` need HTTP (not `file://`), so serve the folder:

```sh
python3 -m http.server 8000
# then open http://localhost:8000
```

Add one or more resources (e.g. Iron Ore, Mk.2 miner, 2 normal nodes), pick a target part,
and the build updates live. The tabs across the top switch between the four views —
**Factory Optimizer**, **Power Generation**, **Codex**, and **Expansion**. Toggle dark/light
with the theme button. The recipe dataset is fetched once from a pinned community source and
cached in `localStorage`; the Expansion view also saves your blocks and goals there, so they
survive a reload.

## Tests

```sh
npm test
```

(`npm test` is scoped to `test/**/*.test.js`, so fixtures/helpers under `test/` aren't run
as tests. The engine — data, LP, physical/shard and belt layers, the expansion planner and
goal scoring, plus the UI view-model and the Codex model — is unit-tested.

The rendering layer is not: there's no DOM shim in the suite, so `js/ui/**` is covered only
through its pure exports and the actual DOM is verified by running the app. Worth knowing
when changing a renderer — a deleted `appendChild` there won't fail anything.)

## Tech

Vanilla ES modules, **no build step**. Recipe/item/building data is loaded at runtime from a
pinned community dataset (greeny/SatisfactoryTools via jsDelivr) and cached in
`localStorage`. The LP solver (`javascript-lp-solver`, MIT) is vendored. Icons are vendored
under `assets/icons/` (fetched once via `scripts/fetch-icons.mjs`), so the site is fully
self-contained.

## Attribution

Recipe data and icons are community-maintained / in-game assets. This is a **fan-made** tool,
**not affiliated with or endorsed by Coffee Stain Studios**.
