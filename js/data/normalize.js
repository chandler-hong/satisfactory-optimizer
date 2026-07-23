export const DEFAULT_POWER_EXPONENT = 1.321928;

/**
 * Convert a raw greeny/SatisfactoryTools data.json object into a Dataset.
 * @param {object} raw parsed data.json
 * @returns {import('../domain/model.js').Dataset}
 */
export function normalize(raw) {
  const items = new Map();
  for (const key of Object.keys(raw.items || {})) {
    const it = raw.items[key];
    items.set(it.className, {
      id: it.className,
      name: it.name,
      slug: it.slug,
      liquid: !!it.liquid,
    });
  }

  const buildings = new Map();
  for (const key of Object.keys(raw.buildings || {})) {
    const b = raw.buildings[key];
    const md = b.metadata || {};
    const basePowerMW =
      typeof md.powerConsumption === 'number' ? md.powerConsumption
        : typeof md.maxPowerConsumption === 'number' ? md.maxPowerConsumption
          : 0;
    buildings.set(b.className, {
      id: b.className,
      name: b.name,
      slug: b.slug,
      basePowerMW,
      powerExponent:
        typeof md.powerConsumptionExponent === 'number'
          ? md.powerConsumptionExponent
          : DEFAULT_POWER_EXPONENT,
    });
  }

  const rawResourceIds = new Set(
    Object.values(raw.resources || {}).map((r) => r.item)
  );

  // greeny/SatisfactoryTools stores all recipe amounts already in per-item
  // units (fluids in m³, not the raw x1000 game value), so no fluid scaling.
  const amountToPerMin = (entry, timeSec) => (entry.amount / timeSec) * 60;

  const recipes = [];
  for (const key of Object.keys(raw.recipes || {})) {
    const r = raw.recipes[key];
    if (!r.inMachine) continue;                          // skip hand/workshop/build-gun
    const buildingId = (r.producedIn || []).find((c) => buildings.has(c));
    if (!buildingId) continue;                           // no automated building
    recipes.push({
      id: r.className,
      name: r.name,
      buildingId,
      alternate: !!r.alternate,
      inputs: (r.ingredients || []).map((e) => ({ itemId: e.item, perMin: amountToPerMin(e, r.time) })),
      outputs: (r.products || []).map((e) => ({ itemId: e.item, perMin: amountToPerMin(e, r.time) })),
    });
  }

  return { items, buildings, recipes, rawResourceIds };
}
