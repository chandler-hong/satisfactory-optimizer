// Real-data optimize smoke check. Run: node scripts/verify-optimize.mjs
import { loadDataset } from '../js/data/loader.js';
import { maxOutput } from '../js/engine/optimize.js';

const ds = await loadDataset({ storage: { getItem: () => null, setItem: () => {} } }); // fresh fetch

const IRON_ORE = 'Desc_OreIron_C';
const mf = [...ds.items.values()].find((i) => i.name === 'Modular Frame');
if (!mf) { console.error('FAIL: Modular Frame item not found'); process.exit(1); }

// Standard recipes only (exclude alternates), so the answer is the deterministic base chain.
const standard = new Set(ds.recipes.filter((r) => !r.alternate).map((r) => r.id));
const caps = new Map([[IRON_ORE, 360]]);

const res = maxOutput({ dataset: ds, caps, enabledRecipeIds: standard, targetItemId: mf.id });
console.log(`max Modular Frame from 360 iron (standard recipes): ${res.maxRate.toFixed(4)}/min`);

if (Math.abs(res.maxRate - 15) > 1e-2) {
  console.error(`FAIL: expected ~15/min, got ${res.maxRate}`);
  console.error('Recipe machines:', JSON.stringify([...res.recipeRates].slice(0, 20)));
  process.exit(1);
}
console.log('\nReal-data optimize smoke passed: 360 iron -> 15 Modular Frames/min via the standard chain.');
