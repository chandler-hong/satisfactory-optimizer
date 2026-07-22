// Real-data smoke check against the pinned dataset. Run: node scripts/verify-data.mjs
import { loadDataset } from '../js/data/loader.js';

// No-op storage forces a fresh network fetch (skips any cache).
const ds = await loadDataset({ storage: { getItem: () => null, setItem: () => {} } });
console.log('items:',     ds.items.size);
console.log('buildings:', ds.buildings.size);
console.log('recipes:',   ds.recipes.length);
console.log('raw resources:', ds.rawResourceIds.size);

const assert = (cond, msg) => { if (!cond) { console.error('FAIL:', msg); process.exit(1); } };
assert(ds.items.size > 100, 'expected >100 items');
assert(ds.recipes.length > 100, 'expected >100 machine recipes');
assert(ds.rawResourceIds.has('Desc_OreIron_C'), 'iron ore should be a raw resource');

// Ground-truth rate check on a real recipe: standard Iron Ingot = 30 ore -> 30 ingot/min.
const ironIngot = ds.recipes.find((r) => r.id === 'Recipe_IngotIron_C');
assert(ironIngot, 'Recipe_IngotIron_C present');
assert(Math.abs(ironIngot.outputs[0].perMin - 30) < 1e-9, 'iron ingot = 30/min');

// Ground-truth fluid check: standard Plastic = 30 crude oil -> 20 plastic/min.
const plastic = ds.recipes.find((r) => r.id === 'Recipe_Plastic_C');
assert(plastic, 'Recipe_Plastic_C present');
const oilIn = plastic.inputs.find((i) => i.itemId === 'Desc_LiquidOil_C');
assert(oilIn && Math.abs(oilIn.perMin - 30) < 1e-9, `crude oil should be 30/min, got ${oilIn && oilIn.perMin}`);

console.log('\nAll real-data smoke checks passed. Dataset pin is good.');
