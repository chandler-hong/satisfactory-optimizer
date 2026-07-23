import { iconUrl } from './icons.js';
import { capsFromInputs, WATER_EXTRACTOR_RATE } from '../engine/resource-model.js';

const POWER_STATE_KEY = 'sat-optimizer:power:v1';
const MINER_TIERS = ['Mk1', 'Mk2', 'Mk3'];
const fmt1 = (x) => Math.round(x * 10) / 10;

function el(tag, className) {
  const n = document.createElement(tag);
  if (className) n.className = className;
  return n;
}

function icon(slug, kind) {
  const url = iconUrl(slug);
  if (!url) {
    const s = el('span', 'icon-fallback');
    s.textContent = kind === 'building' ? '⚙' : kind === 'fluid' ? '💧' : '📦';
    return s;
  }
  const img = el('img', 'icon');
  img.loading = 'lazy';
  img.src = url;
  img.alt = '';
  img.onerror = () => img.remove();
  return img;
}

function num(value, width = '4rem') {
  const i = el('input');
  i.type = 'number';
  i.min = '0';
  i.step = '1';
  i.value = String(value);
  i.style.width = width;
  return i;
}
const rd = (i) => Math.max(0, Math.floor(Number(i.value) || 0));

function field(labelText, control) {
  const w = el('label', 'power-field');
  const s = el('span');
  s.textContent = labelText;
  w.append(s, control);
  return w;
}

/**
 * Pure: how many WHOLE generators a fuel supply runs (rounded down), plus the
 * total MW, water (+ extractors), and byproduct. `supplyRate` is fuel/min.
 */
export function computePower(dataset, { generatorId, fuelItemId, supplyRate }) {
  const gen = (dataset.generators || []).find((g) => g.id === generatorId);
  if (!gen) return null;
  const fuelSpec = gen.fuels.find((f) => f.itemId === fuelItemId) || gen.fuels[0];
  if (!fuelSpec) return null;
  const fuelEnergy = dataset.items.get(fuelSpec.itemId)?.energyValue || 0;
  const perGenFuel = fuelEnergy > 0 ? (gen.powerMW / fuelEnergy) * 60 : 0;
  const generators = perGenFuel > 0 ? Math.floor((supplyRate + 1e-9) / perGenFuel) : 0;
  const usedFuel = generators * perGenFuel;
  const mw = generators * gen.powerMW;
  const waterPerGen = fuelSpec.supplementalItemId ? gen.powerMW * (gen.waterToPowerRatio || 0) * 0.06 : 0;
  const water = generators * waterPerGen;
  const waterExtractors = water > 0 ? Math.ceil(water / WATER_EXTRACTOR_RATE) : 0;
  const byproductPerGen = fuelSpec.byproductItemId ? perGenFuel * (fuelSpec.byproductAmount || 0) : 0;
  const byproduct = generators * byproductPerGen;
  return { gen, fuelSpec, perGenFuel, generators, usedFuel, mw, water, waterExtractors, byproduct };
}

function statRow(slug, isFluid, text) {
  const d = el('div', 'power-stat');
  d.appendChild(icon(slug, isFluid ? 'fluid' : 'item'));
  const s = el('span');
  s.textContent = text;
  d.appendChild(s);
  return d;
}

function renderResult(wrap, dataset, p, supplyRate) {
  wrap.replaceChildren();
  if (!p) return;
  const nm = (id) => dataset.items.get(id)?.name ?? id;
  const slug = (id) => dataset.items.get(id)?.slug;
  const fluid = (id) => !!dataset.items.get(id)?.liquid;
  const fuelId = p.fuelSpec.itemId;
  const fUnit = fluid(fuelId) ? ' m³' : '';

  if (p.generators <= 0) {
    const msg = el('p', 'power-empty');
    msg.textContent = supplyRate > 0
      ? `Not enough ${nm(fuelId)} for even one ${p.gen.name} — need ${fmt1(p.perGenFuel)}${fUnit}/min per generator.`
      : `Set your ${nm(fuelId)} supply above to see how many generators it can run.`;
    wrap.appendChild(msg);
    return;
  }

  const big = el('div', 'power-big');
  big.textContent = `${fmt1(p.mw)} MW`;
  wrap.appendChild(big);

  const gline = el('div', 'power-gen');
  gline.appendChild(icon(p.gen.slug, 'building'));
  const gt = el('span');
  gt.textContent = `${p.generators} × ${p.gen.name}`;
  gline.appendChild(gt);
  wrap.appendChild(gline);

  const stats = el('div', 'power-stats');
  stats.appendChild(statRow(slug(fuelId), fluid(fuelId), `Fuel: uses ${fmt1(p.usedFuel)} of ${fmt1(supplyRate)}${fUnit} ${nm(fuelId)}/min`));
  if (p.water > 0) stats.appendChild(statRow('desc-water-c', true, `Water: ${fmt1(p.water)} m³/min → ${p.waterExtractors} Water Extractor${p.waterExtractors === 1 ? '' : 's'}`));
  if (p.byproduct > 0 && p.fuelSpec.byproductItemId) {
    const bId = p.fuelSpec.byproductItemId;
    stats.appendChild(statRow(slug(bId), fluid(bId), `Byproduct: ${nm(bId)} ${fmt1(p.byproduct)}${fluid(bId) ? ' m³' : ''}/min`));
  }
  wrap.appendChild(stats);
}

/**
 * Build the standalone Power Generation calculator into `container`:
 * pick a generator + fuel, describe the fuel supply (solid raw fuels get miner
 * node inputs; other fuels a direct rate), and see how many whole generators it
 * runs, the total MW, water extractors, and byproducts. State persists.
 */
export function buildPower(dataset, container) {
  container.replaceChildren();
  const gens = dataset.generators || [];

  const state = { generatorId: gens[0]?.id, fuelItemId: null, minerTier: 'Mk1', impure: 0, normal: 2, pure: 0, manualRate: 240 };
  try {
    const saved = JSON.parse(localStorage.getItem(POWER_STATE_KEY) || 'null');
    if (saved && typeof saved === 'object') Object.assign(state, saved);
  } catch { /* ignore */ }

  const panel = el('div', 'power-panel');
  container.appendChild(panel);

  const h = el('h2', 'power-title');
  h.textContent = 'Power generation';
  panel.appendChild(h);
  const hint = el('p', 'hint');
  hint.textContent = 'How many generators can a fuel supply run — and what total power? Pick a generator, its fuel, and describe your supply.';
  panel.appendChild(hint);

  const genSelect = el('select');
  for (const g of gens) {
    const o = el('option');
    o.value = g.id;
    o.textContent = `${g.name} · ${g.powerMW} MW`;
    genSelect.appendChild(o);
  }
  if (state.generatorId && gens.some((g) => g.id === state.generatorId)) genSelect.value = state.generatorId;
  panel.appendChild(field('Generator', genSelect));

  const fuelSelect = el('select');
  panel.appendChild(field('Fuel', fuelSelect));

  const supplyHead = el('div', 'power-supply-head');
  supplyHead.textContent = 'Fuel supply';
  panel.appendChild(supplyHead);
  const supplyWrap = el('div', 'power-supply');
  panel.appendChild(supplyWrap);

  const resultWrap = el('div', 'power-result');
  panel.appendChild(resultWrap);

  const currentGen = () => gens.find((g) => g.id === genSelect.value) || gens[0];
  const isSolidRawFuel = (fuelId) => dataset.rawResourceIds.has(fuelId) && !dataset.items.get(fuelId)?.liquid;

  function fillFuels() {
    const g = currentGen();
    fuelSelect.replaceChildren();
    for (const f of g?.fuels || []) {
      const o = el('option');
      o.value = f.itemId;
      o.textContent = dataset.items.get(f.itemId)?.name ?? f.itemId;
      fuelSelect.appendChild(o);
    }
    if (state.fuelItemId && [...fuelSelect.options].some((o) => o.value === state.fuelItemId)) fuelSelect.value = state.fuelItemId;
  }

  let supply = {};
  function buildSupply() {
    supplyWrap.replaceChildren();
    if (isSolidRawFuel(fuelSelect.value)) {
      const tier = el('select');
      for (const t of MINER_TIERS) {
        const o = el('option');
        o.value = t;
        o.textContent = `Miner ${t.replace('Mk', 'Mk.')}`;
        tier.appendChild(o);
      }
      tier.value = state.minerTier;
      const impure = num(state.impure);
      const normal = num(state.normal);
      const pure = num(state.pure);
      supply = { kind: 'nodes', tier, impure, normal, pure };
      const row = el('div', 'power-nodes');
      row.append(field('Miner', tier), field('Impure', impure), field('Normal', normal), field('Pure', pure));
      supplyWrap.appendChild(row);
      for (const inp of [tier, impure, normal, pure]) inp.addEventListener('input', recompute);
    } else {
      const rate = num(state.manualRate, '7rem');
      supply = { kind: 'rate', rate };
      supplyWrap.appendChild(field('Available fuel (/min)', rate));
      rate.addEventListener('input', recompute);
    }
  }

  function supplyRate() {
    if (supply.kind === 'nodes') {
      return capsFromInputs({ __k: { kind: 'miner', minerTier: supply.tier.value, impure: rd(supply.impure), normal: rd(supply.normal), pure: rd(supply.pure), clock: 1 } }).get('__k') || 0;
    }
    return Math.max(0, Number(supply.rate.value) || 0);
  }

  function save() {
    state.generatorId = genSelect.value;
    state.fuelItemId = fuelSelect.value;
    if (supply.kind === 'nodes') {
      state.minerTier = supply.tier.value;
      state.impure = rd(supply.impure);
      state.normal = rd(supply.normal);
      state.pure = rd(supply.pure);
    } else if (supply.kind === 'rate') {
      state.manualRate = Math.max(0, Number(supply.rate.value) || 0);
    }
    try { localStorage.setItem(POWER_STATE_KEY, JSON.stringify(state)); } catch { /* ignore */ }
  }

  function recompute() {
    save();
    const rate = supplyRate();
    renderResult(resultWrap, dataset, computePower(dataset, { generatorId: genSelect.value, fuelItemId: fuelSelect.value, supplyRate: rate }), rate);
  }

  genSelect.addEventListener('change', () => { fillFuels(); buildSupply(); recompute(); });
  fuelSelect.addEventListener('change', () => { buildSupply(); recompute(); });

  fillFuels();
  buildSupply();
  recompute();
}
