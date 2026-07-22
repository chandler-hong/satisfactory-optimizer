const EPS = 1e-9;
export const BELT_CAPACITY = { Mk1: 60, Mk2: 120, Mk3: 270, Mk4: 480, Mk5: 780, Mk6: 1200 };
export const PIPE_CAPACITY = { Mk1: 300, Mk2: 600 };

const round6 = (x) => Math.round(x * 1e6) / 1e6;

/**
 * Belt/pipe line counts per material flow. `rate` = max(produced, consumed) across the build.
 * @param {{dataset, recipeRates: Map, beltTier?: string, pipeTier?: string}} args
 */
export function beltReport({ dataset, recipeRates, beltTier = 'Mk4', pipeTier = 'Mk2' }) {
  const beltCap = BELT_CAPACITY[beltTier];
  const pipeCap = PIPE_CAPACITY[pipeTier];
  const byId = new Map(dataset.recipes.map((r) => [r.id, r]));
  const flows = new Map(); // itemId -> {produced, consumed}
  for (const [rid, load] of recipeRates) {
    if (load <= 0) continue;
    const r = byId.get(rid);
    if (!r) continue;
    for (const o of r.outputs) {
      const f = flows.get(o.itemId) || { produced: 0, consumed: 0 };
      f.produced += load * o.perMin;
      flows.set(o.itemId, f);
    }
    for (const i of r.inputs) {
      const f = flows.get(i.itemId) || { produced: 0, consumed: 0 };
      f.consumed += load * i.perMin;
      flows.set(i.itemId, f);
    }
  }
  const report = [];
  for (const [itemId, f] of flows) {
    const rate = round6(Math.max(f.produced, f.consumed));
    if (rate <= EPS) continue;
    const fluid = !!dataset.items.get(itemId)?.liquid;
    const cap = fluid ? pipeCap : beltCap;
    report.push({
      itemId,
      rate,
      fluid,
      tier: fluid ? pipeTier : beltTier,
      lines: Math.ceil(rate / cap - EPS),
      saturated: rate > cap + EPS,
    });
  }
  report.sort((a, b) => b.rate - a.rate);
  return report;
}
