/**
 * Shared building blocks for the Optimizer's (render.js) and Expansion's
 * (expansion-render.js) report panels. The two files grew near-identical
 * tiles/build-table/machine-totals/belt-row markup independently; the pieces
 * that were genuinely the same (not just similarly-shaped) live here.
 *
 * DOM only, imported by both. fmt1/fmt2 are deliberately NOT here — see
 * expansion-render.js's own comment on why it keeps a local copy rather than
 * importing view-model.js's; routing a formatter through this module would
 * recreate that same unwanted coupling one hop removed. renderBeltRow takes
 * fmt1 as a parameter instead, so each caller supplies its own.
 */
import { iconEl } from './icons.js';

function el(tag, className) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  return node;
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

export function renderTile(label, value) {
  const tile = el('div', 'tile');
  const lab = el('span', 'tile__label');
  lab.textContent = label;
  const val = el('span', 'tile__value');
  val.textContent = String(value);
  tile.append(lab, val);
  return tile;
}

/**
 * `labels` overrides individual tile captions. The Optimizer wants the defaults —
 * its totals cover the whole build — but the Expansion view's tiles cover the
 * UPSTREAM only, excluding the blocks the user declared, so a bare "Machines"
 * there reads as the full commitment and undercounts it.
 */
export function renderTilesPanel(tiles, labels = {}) {
  const wrap = el('div', 'tiles');
  wrap.appendChild(renderTile(labels.machines ?? 'Machines', tiles.machines));
  wrap.appendChild(renderTile(labels.powerMW ?? 'Power (MW)', tiles.powerMW));
  wrap.appendChild(renderTile(labels.shards ?? 'Shards', tiles.shards));
  return wrap;
}

/** "Mk2" -> "Mk.2"; fluids get a "Pipe " prefix so belts vs pipes are distinguishable. */
function tierLabel(tier, fluid) {
  const dotted = /^Mk\d+$/.test(tier) ? tier.replace('Mk', 'Mk.') : tier;
  return fluid ? `Pipe ${dotted}` : dotted;
}

// Column spec for the build-table family: key -> [header label, cell factory].
// render.js's Build table and expansion-render.js's "To build" panel both use
// all six; expansion-render.js's "Your blocks" panel uses just the first four.
const BUILD_COLUMNS = {
  building: ['Building', (r) => {
    const td = el('td');
    td.appendChild(iconLabel(iconEl(r.buildingSlug, 'building', r.buildingName), r.buildingName));
    return td;
  }],
  recipe: ['Recipe', (r) => {
    const td = el('td');
    td.appendChild(iconLabel(iconEl(r.itemSlug, 'item', r.itemName), r.recipeName));
    return td;
  }],
  machines: ['Machines', (r) => {
    const td = el('td');
    td.textContent = `×${r.machines}`;
    return td;
  }],
  clock: ['Clock', (r) => {
    const td = el('td');
    td.textContent = `${r.clockPct}%`;
    return td;
  }],
  shards: ['Shards', (r) => {
    const td = el('td');
    td.textContent = `${r.shards} shards`;
    return td;
  }],
  power: ['Power', (r) => {
    const td = el('td');
    td.textContent = `${r.powerMW} MW`;
    return td;
  }],
};

/**
 * A `.build-table` for `rows`, with one header/cell pair per key in
 * `columnKeys` (see BUILD_COLUMNS above). If `rows` is empty and `emptyText`
 * is given, renders one colspan-wide row with that text instead of an empty
 * tbody. Callers that already skip rendering entirely on an empty list (both
 * of expansion-render.js's build tables) simply omit `emptyText`.
 */
export function buildTable(rows, columnKeys, emptyText) {
  const table = el('table', 'build-table');
  const thead = el('thead');
  const headRow = el('tr');
  for (const key of columnKeys) {
    const th = el('th');
    th.textContent = BUILD_COLUMNS[key][0];
    headRow.appendChild(th);
  }
  thead.appendChild(headRow);
  table.appendChild(thead);

  const tbody = el('tbody');
  if ((!rows || rows.length === 0) && emptyText) {
    const tr = el('tr');
    const td = el('td');
    td.colSpan = columnKeys.length;
    td.textContent = emptyText;
    tr.appendChild(td);
    tbody.appendChild(tr);
  } else {
    for (const r of rows || []) {
      const tr = el('tr');
      for (const key of columnKeys) tr.appendChild(BUILD_COLUMNS[key][1](r));
      tbody.appendChild(tr);
    }
  }
  table.appendChild(tbody);
  return table;
}

/** The `.machine-totals` chip row: one `.machine-total` chip per building type. */
export function renderMachineTotalsRow(totals) {
  const row = el('div', 'machine-totals');
  for (const t of totals) {
    const chip = el('div', 'machine-total');
    chip.appendChild(iconEl(t.buildingSlug, 'building', t.buildingName));
    const s = el('span');
    s.textContent = `${t.buildingName} ×${t.machines}`;
    chip.appendChild(s);
    row.appendChild(chip);
  }
  return row;
}

/**
 * One belt/pipe flow row (an `<li>` for a `.belt-list`). `fmt1` is passed in
 * rather than imported — see the header comment on why.
 */
export function renderBeltRow(b, fmt1) {
  const li = el('li');
  li.appendChild(iconEl(b.slug, b.fluid ? 'fluid' : 'item', b.name));

  const nameSpan = el('span');
  nameSpan.textContent = b.name;
  li.appendChild(nameSpan);

  const rateSpan = el('span');
  rateSpan.textContent = `${fmt1(b.rate)}${b.fluid ? ' m³' : ''}/min`;
  li.appendChild(rateSpan);

  const chip = el('span', b.saturated ? 'chip chip--saturated' : 'chip');
  const base = `${b.lines} × ${tierLabel(b.tier, b.fluid)}`;
  // Saturated is spelled out in the chip text too — color alone (chip--saturated)
  // isn't CVD-distinct, so the label carries the status.
  chip.textContent = b.saturated ? `${base} · saturated` : base;
  li.appendChild(chip);

  return li;
}

/** ✓/✗ dependency chips for a requirements callout. */
function renderReqDeps(deps) {
  const wrap = el('div', 'req-deps');
  for (const d of deps) {
    const chip = el('span', d.added ? 'req-dep req-dep--have' : 'req-dep req-dep--need');
    const mark = el('span', 'req-dep__mark');
    mark.textContent = d.added ? '✓' : '✗';
    chip.appendChild(mark);
    chip.appendChild(iconEl(d.slug, d.fluid ? 'fluid' : 'item', d.name || ''));
    const name = el('span');
    name.textContent = d.name;
    chip.appendChild(name);
    wrap.appendChild(chip);
  }
  return wrap;
}

/**
 * Requirements diagnostics: a red `.critical` callout per impossible target and
 * an amber `.warning` callout per missing target, each listing raw dependencies
 * as ✓ added / ✗ missing chips. Names via textContent (XSS-safe).
 *
 * Shared between the Optimizer (render.js) and Expansion (expansion-render.js):
 * both build this from analyzeRequirements via the identical
 * {hasIssues, impossible, missing} shape (js/engine/requirements.js,
 * consumed by js/ui/view-model.js and js/engine/expansion.js respectively).
 */
export function renderRequirements(requirements) {
  const frag = document.createDocumentFragment();
  for (const t of requirements.impossible) {
    const box = el('div', 'requirements requirements--critical');
    const p = el('p');
    p.textContent = t.reason === 'no-recipe'
      ? `No enabled recipe produces ${t.name}. Try enabling the alternate recipe it needs.`
      : `${t.name} can’t be made from the resources you’ve added — recheck your resources or target.`;
    box.appendChild(p);
    if (t.deps.length) {
      const label = el('p', 'req-label');
      label.textContent = 'Requires:';
      box.appendChild(label);
      box.appendChild(renderReqDeps(t.deps));
    }
    frag.appendChild(box);
  }
  for (const t of requirements.missing) {
    const box = el('div', 'requirements requirements--warning');
    const p = el('p');
    p.textContent = `To make ${t.name} you need:`;
    box.appendChild(p);
    box.appendChild(renderReqDeps(t.deps));
    frag.appendChild(box);
  }
  return frag;
}

/**
 * Targets-mode shortfalls as a `.warning` callout: "<name> short by <amount>/min".
 * Shared between the Optimizer and Expansion — both produce the same
 * {name, amount, fluid} shape (js/engine/optimize.js's hitTargets output via
 * view-model.js, and js/engine/expansion.js's planExpansion directly).
 */
export function renderShortfalls(shortfalls) {
  const box = el('div', 'warning');
  const heading = el('p');
  heading.textContent = 'Targets not met:';
  box.appendChild(heading);
  const list = el('ul');
  for (const s of shortfalls) {
    const li = el('li');
    li.textContent = `${s.name} short by ${s.amount}${s.fluid ? ' m³' : ''}/min`;
    list.appendChild(li);
  }
  box.appendChild(list);
  return box;
}
