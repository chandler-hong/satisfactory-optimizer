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
      energyValue: typeof it.energyValue === 'number' ? it.energyValue : 0, // MJ; used for power-generator fuel rates
      // Reference metadata for the Codex view; unused by the optimizer.
      description: typeof it.description === 'string' ? it.description : '',
      stackSize: typeof it.stackSize === 'number' ? it.stackSize : 0,
      sinkPoints: typeof it.sinkPoints === 'number' ? it.sinkPoints : 0,
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
  // The per-craft `amount` and the recipe's craft time are what the Codex shows
  // (the game states recipes per craft); the optimizer uses `perMin`.
  const ioEntry = (entry, timeSec) => ({
    itemId: entry.item,
    perMin: amountToPerMin(entry, timeSec),
    amount: Number(entry.amount) || 0,
  });

  const recipes = [];
  for (const key of Object.keys(raw.recipes || {})) {
    const r = raw.recipes[key];
    if (!r.inMachine) continue;                          // skip hand/workshop/build-gun
    const buildingId = (r.producedIn || []).find((c) => buildings.has(c));
    if (!buildingId) continue;                           // no automated building
    recipes.push({
      id: r.className,
      // 109 of the 110 alternate recipes are named "Alternate: <recipe>", which
      // just repeats the `alternate` flag every view already shows as its own
      // marker. In-game the recipe is simply "<recipe>".
      name: String(r.name ?? '').replace(/^Alternate:\s+/, ''),
      buildingId,
      alternate: !!r.alternate,
      timeSec: Number(r.time) || 0,
      inputs: (r.ingredients || []).map((e) => ioEntry(e, r.time)),
      outputs: (r.products || []).map((e) => ioEntry(e, r.time)),
    });
  }

  // Power generators (fuel options, MW, water/byproduct per fuel). Name/slug
  // come from the matching building. Consumption rates are derived at use time:
  //   fuel/min  = powerMW / item.energyValue * 60
  //   water/min = powerMW * waterToPowerRatio * 0.06   (when supplemental=water)
  //   byproduct/min = fuel/min * byproductAmount
  const generators = Object.values(raw.generators || {}).map((g) => {
    const b = buildings.get(g.className);
    return {
      id: g.className,
      name: b?.name ?? g.className,
      slug: b?.slug,
      powerMW: g.powerProduction || 0,
      waterToPowerRatio: g.waterToPowerRatio || 0,
      fuels: (g.fuels || []).map((f) => ({
        itemId: f.item,
        supplementalItemId: f.supplementalItem || null,
        byproductItemId: f.byproduct || null,
        byproductAmount: f.byproductAmount || 0,
      })),
    };
  });

  // Recipe → the schematics that unlock it (tier milestone, MAM research,
  // hard-drive alternate, HUB tutorial). Kept as a list because a recipe can be
  // granted by several; choosing which one to show is presentation (see
  // js/domain/codex.js). Recipes with no entry simply aren't in the map.
  const recipeUnlocks = new Map();
  for (const key of Object.keys(raw.schematics || {})) {
    const s = raw.schematics[key];
    for (const recipeId of s.unlock?.recipes || []) {
      if (!recipeUnlocks.has(recipeId)) recipeUnlocks.set(recipeId, []);
      recipeUnlocks.get(recipeId).push({
        // Coerced: these are sorted and compared downstream, so a malformed
        // entry after a dataset bump should degrade, not throw.
        name: typeof s.name === 'string' ? s.name : '',
        type: typeof s.type === 'string' ? s.type : '',
        tier: typeof s.tier === 'number' ? s.tier : 0,
      });
    }
  }

  return { items, buildings, recipes, rawResourceIds, generators, recipeUnlocks };
}
