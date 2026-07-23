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

## Run the app

ES modules + `fetch` need HTTP (not `file://`), so serve the folder:

```sh
python3 -m http.server 8000
# then open http://localhost:8000
```

Add one or more resources (e.g. Iron Ore, Mk.2 miner, 2 normal nodes), pick a target part,
and the build updates live. Toggle dark/light with the theme button. The recipe dataset is
fetched once from a pinned community source and cached in `localStorage`.

## Tests

```sh
npm test
```

(`npm test` is scoped to `test/**/*.test.js`, so fixtures/helpers under `test/` aren't run
as tests. The engine — data, LP, physical/shard and belt layers, plus the UI view-model —
is unit-tested; the DOM is verified by running the app.)

## Tech

Vanilla ES modules, **no build step**. Recipe/item/building data is loaded at runtime from a
pinned community dataset (greeny/SatisfactoryTools via jsDelivr) and cached in
`localStorage`. The LP solver (`javascript-lp-solver`, MIT) is vendored. Icons are vendored
under `assets/icons/` (fetched once via `scripts/fetch-icons.mjs`), so the site is fully
self-contained.

## Attribution

Recipe data and icons are community-maintained / in-game assets. This is a **fan-made** tool,
**not affiliated with or endorsed by Coffee Stain Studios**.
