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

export function renderTilesPanel(tiles) {
  const wrap = el('div', 'tiles');
  wrap.appendChild(renderTile('Machines', tiles.machines));
  wrap.appendChild(renderTile('Power (MW)', tiles.powerMW));
  wrap.appendChild(renderTile('Shards', tiles.shards));
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
