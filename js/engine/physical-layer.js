const EPS = 1e-9;
export const DEFAULT_POWER_EXPONENT = 1.321928;

/** Power shards needed to REACH a clock: ≤100%→0, ≤150%→1, ≤200%→2, ≤250%→3, else Infinity. */
export function shardsToReach(clock) {
  if (clock <= 1 + EPS) return 0;
  if (clock <= 1.5 + EPS) return 1;
  if (clock <= 2 + EPS) return 2;
  if (clock <= 2.5 + EPS) return 3;
  return Infinity;
}

/** The clock each shard level reaches, descending — so machine counts come out ascending. */
const SHARD_LEVEL_CLOCKS = [2.5, 2, 1.5, 1];

/**
 * Candidate {machines, clock, shards} for a recipe load (machine-equivalents @100%).
 *
 * One candidate per shard level, not one per machine count: at a given
 * per-machine shard level, the fewest machines that cover the load dominates
 * every larger count on both machines AND total shards, so the rest can never
 * win allocateShards' minimize-machines objective. That keeps this O(1) in
 * load, which matters because load is user-driven — a big enough want rate
 * used to allocate one object per machine count until the tab died.
 */
export function recipeOptions(load) {
  if (load <= 0) return [{ machines: 0, clock: 0, shards: 0 }];
  const opts = [];
  let prev = 0;
  for (const cap of SHARD_LEVEL_CLOCKS) {
    const n = Math.max(1, Math.ceil(load / cap - EPS));
    if (n === prev) continue; // a small load collapses several levels onto one count
    prev = n;
    const clock = load / n;
    const s = shardsToReach(clock);
    if (s !== Infinity) opts.push({ machines: n, clock, shards: n * s });
  }
  return opts;
}

/** Ceiling on the DP's shard dimension — see the note where B is computed. */
const MAX_SHARD_DP = 100_000;

/**
 * Minimize total machines subject to total shards ≤ budget (multiple-choice knapsack DP).
 * @param {{id:string, options:{machines,clock,shards}[]}[]} items
 * @param {number} budget
 */
export function allocateShards(items, budget) {
  const maxUseful = items.reduce((s, it) => s + Math.max(0, ...it.options.map((o) => o.shards)), 0);
  // Shards are whole numbers; floor + clamp so a non-integer/NaN budget can't
  // produce a fractional/invalid Array length below.
  const safeBudget = Number.isFinite(budget) ? budget : 0;
  // B sizes the arrays in the DP, and both numbers feeding it are user input —
  // the shard-budget box directly, and the load via maxUseful. Left unbounded,
  // a big enough pair allocates until the process dies, which in a browser is a
  // renderer OOM no try/catch can catch. Nothing real comes close: passing this
  // ceiling needs ~83k machine-equivalents of load, so capping it costs
  // realistic builds nothing and makes absurd ones degrade to fewer shards.
  const B = Math.max(0, Math.min(MAX_SHARD_DP, Math.floor(Math.min(safeBudget, maxUseful))));
  let dp = new Array(B + 1).fill(Infinity);
  dp[0] = 0;
  const choice = [];
  for (let i = 0; i < items.length; i++) {
    const ndp = new Array(B + 1).fill(Infinity);
    const ch = new Array(B + 1).fill(null);
    for (let b = 0; b <= B; b++) {
      if (dp[b] === Infinity) continue;
      for (const o of items[i].options) {
        const nb = b + o.shards;
        if (nb > B) continue;
        if (dp[b] + o.machines < ndp[nb]) {
          ndp[nb] = dp[b] + o.machines;
          ch[nb] = { machines: o.machines, clock: o.clock, shards: o.shards, prevB: b };
        }
      }
    }
    dp = ndp;
    choice.push(ch);
  }
  let bestB = 0, bestM = Infinity;
  for (let b = 0; b <= B; b++) if (dp[b] < bestM) { bestM = dp[b]; bestB = b; }
  const chosen = new Map();
  let b = bestB;
  for (let i = items.length - 1; i >= 0; i--) {
    const c = choice[i][b];
    chosen.set(items[i].id, { machines: c.machines, clock: c.clock, shards: c.shards });
    b = c.prevB;
  }
  return { chosen, totalMachines: bestM === Infinity ? 0 : bestM, totalShards: bestB };
}

const round6 = (x) => Math.round(x * 1e6) / 1e6;

/** Turn recipeRates into a physical build, spending shardBudget to minimize buildings. */
export function realize({ dataset, recipeRates, shardBudget = 0 }) {
  const byId = new Map(dataset.recipes.map((r) => [r.id, r]));
  const items = [];
  for (const [rid, raw] of recipeRates) {
    const load = round6(raw);
    if (load <= 0) continue;
    items.push({ id: rid, options: recipeOptions(load) });
  }
  const { chosen, totalMachines, totalShards } = allocateShards(items, shardBudget);
  const perRecipe = [];
  let totalPowerMW = 0;
  for (const [rid, sel] of chosen) {
    const recipe = byId.get(rid);
    const building = recipe ? dataset.buildings.get(recipe.buildingId) : undefined;
    const base = building?.basePowerMW ?? 0;
    const exp = building?.powerExponent ?? DEFAULT_POWER_EXPONENT;
    // NOTE (spec backlog §18/§20): variable-power buildings (Particle Accelerator,
    // Quantum Encoder, etc.) carry power on the recipe (isVariablePower/min/maxPower),
    // NOT basePowerMW, so their power is currently under-reported. Deliberately
    // deferred; revisit before Phase 4 surfaces accurate power totals.
    const powerMW = sel.machines * base * Math.pow(sel.clock, exp);
    totalPowerMW += powerMW;
    perRecipe.push({ recipeId: rid, buildingId: recipe?.buildingId ?? null, machines: sel.machines, clock: sel.clock, shards: sel.shards, powerMW });
  }
  return { perRecipe, totalMachines, totalShardsUsed: totalShards, totalPowerMW };
}
