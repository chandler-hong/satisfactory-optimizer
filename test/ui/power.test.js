import test from 'node:test';
import assert from 'node:assert/strict';
import { computePower } from '../../js/ui/power.js';

const approx = (a, b, e = 1e-4) => Math.abs(a - b) <= e;

test('computePower sizes whole generators + water extractors from a fuel supply', () => {
  const ds = {
    items: new Map([
      ['coal', { id: 'coal', name: 'Coal', slug: 'coal', liquid: false, energyValue: 300 }],
      ['water', { id: 'water', name: 'Water', slug: 'water', liquid: true, energyValue: 0 }],
    ]),
    rawResourceIds: new Set(['coal']),
    generators: [{ id: 'coalgen', name: 'Coal Gen', slug: 'coalgen', powerMW: 75, waterToPowerRatio: 10, fuels: [{ itemId: 'coal', supplementalItemId: 'water', byproductItemId: null, byproductAmount: 0 }] }],
  };
  // 2 normal coal nodes = 120/min; coal gen burns 15/min -> 8 generators.
  const p = computePower(ds, { generatorId: 'coalgen', fuelItemId: 'coal', supplyRate: 120 });
  assert.equal(p.generators, 8);
  assert.equal(p.mw, 600);
  assert.ok(approx(p.water, 360)); // 8 * (75*10*0.06 = 45)
  assert.equal(p.waterExtractors, 3); // ceil(360 / 120)
  assert.ok(approx(p.usedFuel, 120));
});

test('computePower rounds the generator count down on a partial supply', () => {
  const ds = {
    items: new Map([['coal', { id: 'coal', energyValue: 300, liquid: false }]]),
    rawResourceIds: new Set(['coal']),
    generators: [{ id: 'g', name: 'G', powerMW: 75, waterToPowerRatio: 0, fuels: [{ itemId: 'coal', supplementalItemId: null, byproductItemId: null, byproductAmount: 0 }] }],
  };
  const p = computePower(ds, { generatorId: 'g', fuelItemId: 'coal', supplyRate: 100 }); // 100/15 = 6.67 -> 6
  assert.equal(p.generators, 6);
  assert.equal(p.mw, 450);
});
