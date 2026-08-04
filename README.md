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
from what you've *decided to build*. Declare your blocks (6× Assembler making Motors, at
whatever clock), any flat extra demand, and whatever is already on your bus, and it works
out the upstream: what to build to feed it, the machine totals, the net output leaving the
factory, how much of your existing supply gets used (and whether it runs out), the raw
rates with whole miner counts per tier and purity, belts/pipes, power, and a factory
diagram. Tick a HUB milestone or Space Elevator phase and it checks the plan against that
goal's cost, showing what's still uncovered and roughly how long the plan takes to fill it —
with a one-click button to turn the gaps into demand rows.

Two things to know about the Expansion view: it assumes **every alternate recipe is
unlocked** (there's no picker there yet, so it can prescribe a recipe you don't have — the
Factory Optimizer starts with alternates off if you want that comparison), and it uses the
default belt tier rather than the Optimizer's sidebar setting, so line counts assume Mk.4.

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
