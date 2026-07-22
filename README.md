# Satisfactory Resource Optimizer

A static, browser-based production planner for **Satisfactory (v1.2)**. Enter the raw
resources you have (ore nodes by purity + miner tier, plus fluids), a power-shard budget,
and a belt tier — get an **optimal factory build** (best recipes incl. alternates,
machine counts, clocks, power, belts) computed via linear programming.

**Two modes:**
- **Max one part** — maximize a single target part from your resources.
- **Target rates** — hit specific rates; infeasible plans report exact shortfalls.

## Status

🚧 In development. See the design spec:
[`docs/superpowers/specs/2026-07-22-satisfactory-optimizer-design.md`](docs/superpowers/specs/2026-07-22-satisfactory-optimizer-design.md).

## Run locally

ES modules + `fetch` require HTTP (not `file://`):

```sh
python3 -m http.server
# then open http://localhost:8000
```

## Tests

```sh
npm test
```

(`npm test` is scoped to `test/**/*.test.js` so fixtures/helpers under `test/` are not executed as tests.)

## Tech

Vanilla ES modules, no build step. Recipe/item data is loaded at runtime from a pinned
community dataset via jsDelivr and cached in `localStorage`. The LP solver is vendored
(MIT).

## Attribution

Recipe data and icons are community-maintained / in-game assets. This is a **fan-made**
tool, **not affiliated with or endorsed by Coffee Stain Studios**.
