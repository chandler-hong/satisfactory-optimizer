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

/** Candidate {machines, clock, shards} for a recipe load (machine-equivalents @100%). */
export function recipeOptions(load) {
  if (load <= 0) return [{ machines: 0, clock: 0, shards: 0 }];
  const lo = Math.max(1, Math.ceil(load / 2.5 - EPS));
  const hi = Math.max(1, Math.ceil(load - EPS));
  const opts = [];
  for (let n = lo; n <= hi; n++) {
    const clock = load / n;
    const s = shardsToReach(clock);
    if (s !== Infinity) opts.push({ machines: n, clock, shards: n * s });
  }
  return opts;
}

/**
 * Minimize total machines subject to total shards ≤ budget (multiple-choice knapsack DP).
 * @param {{id:string, options:{machines,clock,shards}[]}[]} items
 * @param {number} budget
 */
export function allocateShards(items, budget) {
  const maxUseful = items.reduce((s, it) => s + Math.max(0, ...it.options.map((o) => o.shards)), 0);
  const B = Math.max(0, Math.min(budget, maxUseful));
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
    const powerMW = sel.machines * base * Math.pow(sel.clock, exp);
    totalPowerMW += powerMW;
    perRecipe.push({ recipeId: rid, buildingId: recipe?.buildingId ?? null, machines: sel.machines, clock: sel.clock, shards: sel.shards, powerMW });
  }
  return { perRecipe, totalMachines, totalShardsUsed: totalShards, totalPowerMW };
}
