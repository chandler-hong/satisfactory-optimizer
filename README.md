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
whatever clock), any flat extra demand, and whatever is already on your bus, and it works
out the upstream: what to build to feed it, the machine totals, the net output leaving the
factory, how much of your existing supply gets used (and whether it runs out), the raw
rates with whole miner counts per tier and purity, belts/pipes, power, and a factory
diagram. Tick a HUB milestone or Space Elevator phase and it checks the plan against that
goal's cost, showing what's still uncovered and roughly how long the plan takes to fill it —
with a one-click button to turn the gaps into demand rows.

Each block is either **Built** or **To build**, and the difference is the whole point. A
Built block already exists and is already fed, so only what it *makes* enters the plan.
Declare your existing 6× Assembler Motor line as Built and ask for 10 Modular Engine/min:
Stator drops out entirely, and the Motors' own share of the Rotors goes with it — Rotor
machines fall from ×20 to just the ×5 that Smart Plating still needs for itself, taking
iron ore from 1410/min down to 465/min and total machines from 267 to 97. A To-build
block gets its feedstock planned upstream instead. New blocks default to Built — and so
do any blocks saved before this feature shipped, since the storage format wasn't bumped,
so a returning session's plan can re-solve to something materially different on first
load.

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
