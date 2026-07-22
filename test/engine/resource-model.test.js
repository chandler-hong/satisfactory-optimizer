import test from 'node:test';
import assert from 'node:assert/strict';
import { capsFromInputs } from '../../js/engine/resource-model.js';

test('3 normal iron on Mk.2 = 360/min', () => {
  const caps = capsFromInputs({ Desc_OreIron_C: { kind: 'miner', minerTier: 'Mk2', normal: 3 } });
  assert.equal(caps.get('Desc_OreIron_C'), 360);
});

test('3 pure iron on Mk.2 = 720/min', () => {
  const caps = capsFromInputs({ Desc_OreIron_C: { kind: 'miner', minerTier: 'Mk2', pure: 3 } });
  assert.equal(caps.get('Desc_OreIron_C'), 720);
});

test('2 impure copper on Mk.1 = 60/min', () => {
  const caps = capsFromInputs({ Desc_OreCopper_C: { kind: 'miner', minerTier: 'Mk1', impure: 2 } });
  assert.equal(caps.get('Desc_OreCopper_C'), 60);
});

test('mixed purity sums (Mk.2: 1 imp + 2 norm + 1 pure = 540)', () => {
  const caps = capsFromInputs({ Desc_OreIron_C: { kind: 'miner', minerTier: 'Mk2', impure: 1, normal: 2, pure: 1 } });
  assert.equal(caps.get('Desc_OreIron_C'), 540);
});

test('clock scales output (Mk.2 normal @250% = 300)', () => {
  const caps = capsFromInputs({ Desc_OreIron_C: { kind: 'miner', minerTier: 'Mk2', normal: 1, clock: 2.5 } });
  assert.equal(caps.get('Desc_OreIron_C'), 300);
});

test('oil extractors use oil rates', () => {
  const caps = capsFromInputs({ Desc_LiquidOil_C: { kind: 'oil', normal: 2 } });
  assert.equal(caps.get('Desc_LiquidOil_C'), 240);
});

test('water extractors use flat rate', () => {
  const caps = capsFromInputs({ Desc_Water_C: { kind: 'water', count: 2 } });
  assert.equal(caps.get('Desc_Water_C'), 240);
});

test('resource well sums satellite purities', () => {
  const caps = capsFromInputs({ Desc_NitrogenGas_C: { kind: 'well', satellites: { normal: 2, pure: 1 } } });
  assert.equal(caps.get('Desc_NitrogenGas_C'), 240); // 2*60 + 1*120
});

test('override bypasses computation', () => {
  const caps = capsFromInputs({ Desc_OreIron_C: { override: 999 } });
  assert.equal(caps.get('Desc_OreIron_C'), 999);
});

test('defaults kind to miner and tier to Mk1', () => {
  const caps = capsFromInputs({ Desc_OreIron_C: { normal: 1 } });
  assert.equal(caps.get('Desc_OreIron_C'), 60);
});

test('Mk.3 miner rates (pure = 480, normal = 240)', () => {
  const caps = capsFromInputs({
    Desc_OreIron_C: { kind: 'miner', minerTier: 'Mk3', pure: 1 },
    Desc_OreCopper_C: { kind: 'miner', minerTier: 'Mk3', normal: 1 },
  });
  assert.equal(caps.get('Desc_OreIron_C'), 480);
  assert.equal(caps.get('Desc_OreCopper_C'), 240);
});
