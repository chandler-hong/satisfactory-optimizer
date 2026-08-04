/**
 * Expansion view result rendering: the eight report panels (tiles, to-build
 * table, machine totals, your blocks, net output, supply used, raw needed,
 * belts) built from a planExpansion() result.
 *
 * Split out of expansion.js (see task-7-brief.md Step 3) once the DOM-input
 * half and the result-rendering half together crossed the file's ~380-line
 * guideline — this file is the rendering half; expansion.js keeps state, row
 * factories, and wiring.
 *
 * DOM only — all arithmetic lives in js/engine/expansion.js.
 */
import { iconEl as icon } from './icons.js';

// Duplicated from js/ui/view-model.js rather than imported: that module pulls
// in the whole Optimizer engine chain (optimize/physical-layer/belt-layer/
// requirements/suggestions) for a view-model this file has no other reason to
// depend on. Two one-line formatters aren't worth that coupling.
const fmt1 = (x) => Math.round(x * 10) / 10;
const fmt2 = (x) => Math.round(x * 100) / 100;

function el(tag, className) {
  const n = document.createElement(tag);
  if (className) n.className = className;
  return n;
}

/**
 * Inline icon+text pair. Needed anywhere an icon sits next to text inside a
 * non-flex container (e.g. a <td>): img/.icon-fallback default to
 * display:block (see the global `img` reset in styles.css), so without this
 * wrapper the icon stacks onto its own line instead of sitting beside the text.
 */
function iconLabel(node, label) {
  const wrap = el('span');
  wrap.style.display = 'inline-flex';
  wrap.style.alignItems = 'center';
  wrap.style.gap = '0.4rem';
  wrap.appendChild(node);
  const span = el('span');
  span.textContent = label;
  wrap.appendChild(span);
  return wrap;
}

/** "Mk2" -> "Mk.2"; fluids get a "Pipe " prefix so belts vs pipes are distinguishable. */
function tierLabel(tier, fluid) {
  const dotted = /^Mk\d+$/.test(tier) ? tier.replace('Mk', 'Mk.') : tier;
  return fluid ? `Pipe ${dotted}` : dotted;
}

const extractorSummary = (options) => options.map((o) => `${o.count}× ${o.label}`).join(', ');

function renderTile(label, value) {
  const tile = el('div', 'tile');
  const lab = el('span', 'tile__label');
  lab.textContent = label;
  const val = el('span', 'tile__value');
  val.textContent = String(value);
  tile.append(lab, val);
  return tile;
}

function renderTilesPanel(tiles) {
  const wrap = el('div', 'tiles');
  wrap.appendChild(renderTile('Machines', tiles.machines));
  wrap.appendChild(renderTile('Power (MW)', tiles.powerMW));
  wrap.appendChild(renderTile('Shards', tiles.shards));
  return wrap;
}

function panel(title) {
  const section = el('section');
  const h = el('h3');
  h.textContent = title;
  section.appendChild(h);
  return section;
}

function renderBuildTablePanel(rows) {
  if (!rows || rows.length === 0) return null;
  const section = panel('To build');
  const table = el('table', 'build-table');
  const thead = el('thead');
  const headRow = el('tr');
  for (const label of ['Building', 'Recipe', 'Machines', 'Clock', 'Shards', 'Power']) {
    const th = el('th');
    th.textContent = label;
    headRow.appendChild(th);
  }
  thead.appendChild(headRow);
  table.appendChild(thead);

  const tbody = el('tbody');
  for (const r of rows) {
    const tr = el('tr');
    const buildingTd = el('td');
    buildingTd.appendChild(iconLabel(icon(r.buildingSlug, 'building', r.buildingName), r.buildingName));
    tr.appendChild(buildingTd);
    const recipeTd = el('td');
    recipeTd.appendChild(iconLabel(icon(r.itemSlug, 'item', r.itemName), r.recipeName));
    tr.appendChild(recipeTd);
    const machinesTd = el('td');
    machinesTd.textContent = `×${r.machines}`;
    tr.appendChild(machinesTd);
    const clockTd = el('td');
    clockTd.textContent = `${r.clockPct}%`;
    tr.appendChild(clockTd);
    const shardsTd = el('td');
    shardsTd.textContent = `${r.shards} shards`;
    tr.appendChild(shardsTd);
    const powerTd = el('td');
    powerTd.textContent = `${r.powerMW} MW`;
    tr.appendChild(powerTd);
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  section.appendChild(table);
  return section;
}

function renderMachineTotalsPanel(totals) {
  if (!totals || totals.length === 0) return null;
  const section = panel('Machine totals');
  const row = el('div', 'machine-totals');
  for (const t of totals) {
    const chip = el('div', 'machine-total');
    chip.appendChild(icon(t.buildingSlug, 'building', t.buildingName));
    const s = el('span');
    s.textContent = `${t.buildingName} ×${t.machines}`;
    chip.appendChild(s);
    row.appendChild(chip);
  }
  section.appendChild(row);
  return section;
}

function renderYourBlocksPanel(rows) {
  if (!rows || rows.length === 0) return null;
  const section = panel('Your blocks');
  const table = el('table', 'build-table');
  const thead = el('thead');
  const headRow = el('tr');
  for (const label of ['Building', 'Recipe', 'Machines', 'Clock']) {
    const th = el('th');
    th.textContent = label;
    headRow.appendChild(th);
  }
  thead.appendChild(headRow);
  table.appendChild(thead);

  const tbody = el('tbody');
  for (const r of rows) {
    const tr = el('tr');
    const buildingTd = el('td');
    buildingTd.appendChild(iconLabel(icon(r.buildingSlug, 'building', r.buildingName), r.buildingName));
    tr.appendChild(buildingTd);
    const recipeTd = el('td');
    recipeTd.appendChild(iconLabel(icon(r.itemSlug, 'item', r.itemName), r.recipeName));
    tr.appendChild(recipeTd);
    const machinesTd = el('td');
    machinesTd.textContent = `×${r.machines}`;
    tr.appendChild(machinesTd);
    const clockTd = el('td');
    clockTd.textContent = `${r.clockPct}%`;
    tr.appendChild(clockTd);
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  section.appendChild(table);
  return section;
}

function renderNetOutputPanel(rows) {
  if (!rows || rows.length === 0) return null;
  const section = panel('Net output');
  const list = el('ul', 'belt-list');
  for (const r of rows) {
    const li = el('li');
    li.appendChild(icon(r.slug, r.fluid ? 'fluid' : 'item', r.name));
    const nameSpan = el('span');
    nameSpan.textContent = r.name;
    li.appendChild(nameSpan);
    const rateSpan = el('span');
    rateSpan.textContent = `${fmt1(r.rate)}${r.fluid ? ' m³' : ''}/min`;
    li.appendChild(rateSpan);
    list.appendChild(li);
  }
  section.appendChild(list);
  return section;
}

function renderSupplyUsagePanel(rows, dataset) {
  if (!rows || rows.length === 0) return null;
  const section = panel('Supply used');
  const list = el('ul', 'belt-list');
  for (const s of rows) {
    const item = dataset.items.get(s.itemId);
    const name = item?.name ?? s.itemId;
    const fluid = !!item?.liquid;
    const li = el('li');
    li.appendChild(icon(item?.slug, fluid ? 'fluid' : 'item', name));
    const nameSpan = el('span');
    nameSpan.textContent = name;
    li.appendChild(nameSpan);
    const text = el('span');
    text.textContent = `used ${fmt1(s.used)} of ${fmt1(s.rate)}${fluid ? ' m³' : ''}/min`;
    li.appendChild(text);
    if (s.capped) {
      // Color alone (chip--warning) isn't CVD-distinct, so the label spells it out too.
      const chip = el('span', 'chip chip--warning');
      chip.textContent = 'capped';
      li.appendChild(chip);
    }
    list.appendChild(li);
  }
  section.appendChild(list);
  return section;
}

function renderRawNeededPanel(rows) {
  if (!rows || rows.length === 0) return null;
  const section = panel('Raw needed');
  const list = el('ul', 'exp-raw-list');
  for (const r of rows) {
    const li = el('li', 'exp-raw-row');
    const head = el('div', 'exp-raw-row__head');
    head.appendChild(icon(r.slug, r.fluid ? 'fluid' : 'item', r.name));
    const nameSpan = el('span');
    nameSpan.textContent = r.name;
    head.appendChild(nameSpan);
    const unit = r.fluid ? ' m³' : '';
    const statSpan = el('span');
    statSpan.textContent = r.supplied > 0
      ? `${fmt2(r.needed)}${unit}/min needed · ${fmt2(r.supplied)}${unit}/min already supplied`
      : `${fmt2(r.needed)}${unit}/min needed`;
    head.appendChild(statSpan);
    li.appendChild(head);

    const detail = el('p', 'hint');
    detail.textContent = r.newRate === 0
      ? 'covered by your existing supply'
      : `→ ${fmt2(r.newRate)}${unit}/min new = ${extractorSummary(r.options)}`;
    li.appendChild(detail);

    list.appendChild(li);
  }
  section.appendChild(list);
  return section;
}

function renderBeltsPanel(rows) {
  if (!rows || rows.length === 0) return null;
  const section = panel('Belts & pipes');
  const list = el('ul', 'belt-list');
  for (const b of rows) {
    const li = el('li');
    li.appendChild(icon(b.slug, b.fluid ? 'fluid' : 'item', b.name));
    const nameSpan = el('span');
    nameSpan.textContent = b.name;
    li.appendChild(nameSpan);
    const rateSpan = el('span');
    rateSpan.textContent = `${fmt1(b.rate)}${b.fluid ? ' m³' : ''}/min`;
    li.appendChild(rateSpan);
    const chip = el('span', b.saturated ? 'chip chip--saturated' : 'chip');
    const base = `${b.lines} × ${tierLabel(b.tier, b.fluid)}`;
    chip.textContent = b.saturated ? `${base} · saturated` : base;
    li.appendChild(chip);
    list.appendChild(li);
  }
  section.appendChild(list);
  return section;
}

/**
 * Per-goal progress for the ticked HUB milestones / Space Elevator phases, plus
 * the "push shortfalls into Want rows" action. Appended straight onto `wrap`
 * rather than clearing it first: expansion.js's recompute() always calls
 * renderPlan(wrap, ...) — which does its own replaceChildren() — immediately
 * before this, so by the time this runs `wrap` already holds exactly the plan
 * panels and nothing stale from a prior goal selection.
 *
 * `shortfallCount` and `onAddShortfalls` are passed in rather than computed
 * here: the higher-rate-wins dedup (uncoveredToRows) lives in expansion.js, and
 * this file already goes the other direction (expansion.js imports renderPlan
 * from here), so importing back from expansion.js would be circular.
 */
export function renderGoals(wrap, goalViews, shortfallCount, onAddShortfalls) {
  if (!goalViews || goalViews.length === 0) return;

  const section = panel('Goals');
  for (const g of goalViews) {
    const card = el('div', 'exp-goal-card');
    const head = el('div', 'exp-goal-card__head');
    const label = el('span', 'exp-goal-card__label');
    label.textContent = g.label;
    head.appendChild(label);
    const eta = el('span', 'exp-goal-card__eta');
    eta.textContent = g.etaMinutes == null ? '—' : `~${fmt1(g.etaMinutes)} min`;
    head.appendChild(eta);
    card.appendChild(head);

    const list = el('ul', 'belt-list');
    for (const p of g.parts) {
      const li = el('li');
      li.appendChild(icon(p.slug, p.fluid ? 'fluid' : 'item', p.name));
      const nameSpan = el('span');
      nameSpan.textContent = `${p.name} ×${p.amount}`;
      li.appendChild(nameSpan);
      const statusSpan = p.covered ? el('span') : el('span', 'exp-goal-part--uncovered');
      statusSpan.textContent = p.covered
        ? `✓ ${fmt1(p.netRate)}/min → ${fmt1(p.etaMinutes)} min`
        : '✗ not produced';
      li.appendChild(statusSpan);
      list.appendChild(li);
    }
    card.appendChild(list);
    section.appendChild(card);
  }

  const addBtn = el('button', 'exp-goal-add');
  addBtn.type = 'button';
  addBtn.textContent = `Add ${shortfallCount} shortfall${shortfallCount === 1 ? '' : 's'} as WANT rows`;
  addBtn.disabled = shortfallCount === 0;
  addBtn.addEventListener('click', onAddShortfalls);
  section.appendChild(addBtn);

  wrap.appendChild(section);
}

/**
 * Whether there's anything to show at all. Deliberately NOT `plan.hasPlan`:
 * that flag is computed by planExpansion from pre-validation row counts (any
 * row tagged kind:'block'/'want', even one whose picker was never given a
 * value), so a row that fails validation would leave every panel below empty
 * while `hasPlan` still reported true — the empty-state message would never
 * show. This checks the validated output actually driving the eight panels
 * instead. `requirements`/`shortfalls` are intentionally excluded: this view
 * renders exactly the eight panels below (no diagnostics panel), so a plan
 * whose only "content" is an unmet/impossible target still falls through to
 * the friendly empty-state hint rather than a page of zeroed tiles.
 */
function hasContent(plan) {
  return plan.blockRows.length > 0
    || plan.buildRows.length > 0
    || plan.netOutputRows.length > 0
    || plan.supplyUsage.length > 0
    || plan.rawNeeded.length > 0
    || plan.beltRows.length > 0;
}

export function renderPlan(wrap, dataset, plan) {
  wrap.replaceChildren();
  if (!hasContent(plan)) {
    const p = el('p', 'hint');
    p.textContent = 'Add a block — say 6 Assemblers making Motors — and this will work out what has to feed it.';
    wrap.appendChild(p);
    return;
  }
  wrap.appendChild(renderTilesPanel(plan.tiles));
  for (const section of [
    renderBuildTablePanel(plan.buildRows),
    renderMachineTotalsPanel(plan.machineTotals),
    renderYourBlocksPanel(plan.blockRows),
    renderNetOutputPanel(plan.netOutputRows),
    renderSupplyUsagePanel(plan.supplyUsage, dataset),
    renderRawNeededPanel(plan.rawNeeded),
    renderBeltsPanel(plan.beltRows),
  ]) {
    if (section) wrap.appendChild(section);
  }
}
