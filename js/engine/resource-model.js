// Miner output per minute at 100% clock, by tier and node purity.
export const MINER_RATES = {
  Mk1: { impure: 30,  normal: 60,  pure: 120 },
  Mk2: { impure: 60,  normal: 120, pure: 240 },
  Mk3: { impure: 120, normal: 240, pure: 480 },
};

// Fluid extraction per minute at 100% clock.
export const OIL_EXTRACTOR_RATES = { impure: 60, normal: 120, pure: 240 };
export const WATER_EXTRACTOR_RATE = 120;                       // no purity variants
export const WELL_SATELLITE_RATES = { impure: 30, normal: 60, pure: 120 };

const byPurity = (c, rates) =>
  (c.impure || 0) * rates.impure + (c.normal || 0) * rates.normal + (c.pure || 0) * rates.pure;

/**
 * Compute raw-resource capacity (per minute) from a node configuration.
 * @param {Object.<string, object>} config keyed by raw-resource item id
 * @returns {Map<string, number>}
 */
export function capsFromInputs(config) {
  const caps = new Map();
  for (const itemId of Object.keys(config)) {
    const c = config[itemId];
    if (typeof c.override === 'number') { caps.set(itemId, c.override); continue; }
    const clock = typeof c.clock === 'number' ? c.clock : 1;
    const kind = c.kind || 'miner';
    let rate = 0;
    if (kind === 'miner') rate = byPurity(c, MINER_RATES[c.minerTier || 'Mk1']);
    else if (kind === 'oil') rate = byPurity(c, OIL_EXTRACTOR_RATES);
    else if (kind === 'water') rate = (c.count || 0) * WATER_EXTRACTOR_RATE;
    else if (kind === 'well') rate = byPurity(c.satellites || {}, WELL_SATELLITE_RATES);
    caps.set(itemId, rate * clock);
  }
  return caps;
}
