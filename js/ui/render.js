import { iconUrl } from './icons.js';
import { fmt1 } from './view-model.js';
import { renderDiagram } from './diagram.js';

const FALLBACK_EMOJI = { building: '⚙', fluid: '💧', item: '📦' };

function el(tag, className) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  return node;
}

function makeFallbackIcon(kind) {
  const span = el('span', 'icon-fallback');
  span.textContent = FALLBACK_EMOJI[kind] || FALLBACK_EMOJI.item;
  return span;
}

/**
 * `<img class="icon">` for `slug`, falling back to a `.icon-fallback` emoji
 * (kind: 'building' | 'fluid' | 'item') when there is no icon URL or the
 * image fails to load. Never throws — a missing icon never breaks a row.
 * @param {string|undefined} slug
 * @param {string} name  used as the alt text (set as a property, not parsed as HTML)
 * @param {'building'|'fluid'|'item'} kind
 */
function makeIcon(slug, name, kind) {
  const url = iconUrl(slug);
  if (!url) return makeFallbackIcon(kind);
  const img = el('img', 'icon');
  img.loading = 'lazy';
  img.src = url;
  img.alt = name || '';
  img.onerror = () => {
    img.replaceWith(makeFallbackIcon(kind));
  };
  return img;
}

/**
 * Inline icon+text pair. There's no dedicated CSS class for this layout, so
 * alignment is set inline rather than adding a new class to styles.css.
 */
function iconLabel(iconNode, label) {
  const wrap = el('span');
  wrap.style.display = 'inline-flex';
  wrap.style.alignItems = 'center';
  wrap.style.gap = '0.4rem';
  wrap.appendChild(iconNode);
  const span = document.createElement('span');
  span.textContent = label;
  wrap.appendChild(span);
  return wrap;
}

function renderHeadline(planView) {
  const h = el('h2');
  h.textContent = planView.headline;
  if (!planView.feasible) h.classList.add('critical');
  return h;
}

/** Targets-mode shortfalls as a `.warning` callout: "<name> short by <amount>/min". */
function renderShortfalls(shortfalls) {
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

function renderTile(label, value) {
  const tile = el('div', 'tile');
  const lab = el('span', 'tile__label');
  lab.textContent = label;
  const val = el('span', 'tile__value');
  val.textContent = String(value);
  tile.append(lab, val);
  return tile;
}

function renderTiles(tiles) {
  const wrap = el('div', 'tiles');
  wrap.appendChild(renderTile('Machines', tiles.machines));
  wrap.appendChild(renderTile('Power (MW)', tiles.powerMW));
  wrap.appendChild(renderTile('Shards', tiles.shards));
  return wrap;
}

function renderMeterRow(m) {
  const row = el('div', 'meter-row');
  row.style.marginBottom = '0.75rem';

  const label = el('div');
  label.style.display = 'flex';
  label.style.alignItems = 'center';
  label.style.gap = '0.4rem';
  label.style.marginBottom = '0.25rem';
  label.appendChild(makeIcon(m.slug, m.name, 'item'));
  const nameSpan = el('span');
  nameSpan.textContent = m.name;
  label.appendChild(nameSpan);
  const statsSpan = el('span');
  statsSpan.textContent = m.unlimited
    ? `${m.used}${m.fluid ? ' m³' : ''}/min · unlimited`
    : `${m.used} / ${m.available}${m.fluid ? ' m³' : ''}/min`;
  label.appendChild(statsSpan);
  if (m.binding) {
    const chip = el('span', 'chip warning');
    chip.textContent = 'maxed';
    label.appendChild(chip);
  }
  row.appendChild(label);

  // Unlimited resources (auto-water) have no cap to fill, so no meter bar.
  if (!m.unlimited) {
    const meter = el('div', m.binding ? 'meter meter--binding' : 'meter');
    const fill = el('span', 'meter__fill');
    const pct = Math.max(0, Math.min(1, m.pct));
    fill.style.width = `${pct * 100}%`;
    meter.appendChild(fill);
    row.appendChild(meter);
  }

  return row;
}

function renderMeters(meters) {
  const wrap = el('section');
  const heading = el('h3');
  heading.textContent = 'Resources';
  wrap.appendChild(heading);
  if (!meters || meters.length === 0) {
    const p = el('p');
    p.textContent = 'No capped resources.';
    wrap.appendChild(p);
    return wrap;
  }
  for (const m of meters) wrap.appendChild(renderMeterRow(m));
  return wrap;
}

function renderBuildRow(r) {
  const tr = el('tr');

  const buildingTd = el('td');
  buildingTd.appendChild(iconLabel(makeIcon(r.buildingSlug, r.buildingName, 'building'), r.buildingName));
  tr.appendChild(buildingTd);

  const recipeTd = el('td');
  recipeTd.appendChild(iconLabel(makeIcon(r.itemSlug, r.itemName, 'item'), r.recipeName));
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

  return tr;
}

function renderBuildTable(rows) {
  const wrap = el('section');
  const heading = el('h3');
  heading.textContent = 'Build';
  wrap.appendChild(heading);

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
  if (!rows || rows.length === 0) {
    const tr = el('tr');
    const td = el('td');
    td.colSpan = 6;
    td.textContent = 'No production required.';
    tr.appendChild(td);
    tbody.appendChild(tr);
  } else {
    for (const r of rows) tbody.appendChild(renderBuildRow(r));
  }
  table.appendChild(tbody);
  wrap.appendChild(table);
  return wrap;
}

/** "Mk2" -> "Mk.2"; fluids get a "Pipe " prefix so belts vs pipes are distinguishable. */
function tierLabel(tier, fluid) {
  const dotted = /^Mk\d+$/.test(tier) ? tier.replace('Mk', 'Mk.') : tier;
  return fluid ? `Pipe ${dotted}` : dotted;
}

function renderBeltRow(b) {
  const li = el('li');
  li.appendChild(makeIcon(b.slug, b.name, b.fluid ? 'fluid' : 'item'));

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

function renderBeltList(rows) {
  const wrap = el('section');
  const heading = el('h3');
  heading.textContent = 'Belts & pipes';
  wrap.appendChild(heading);

  const list = el('ul', 'belt-list');
  if (!rows || rows.length === 0) {
    const li = el('li');
    li.textContent = 'No flows.';
    list.appendChild(li);
  } else {
    for (const b of rows) list.appendChild(renderBeltRow(b));
  }
  wrap.appendChild(list);
  return wrap;
}

/**
 * Per-part rate chips, shown under the headline when maximizing more than one
 * part (the headline reads "N sets/min", so the per-part rates go here). For a
 * single part the headline already carries the rate, so this is skipped.
 */
function renderPerPart(perPart) {
  const wrap = el('div', 'perpart');
  for (const p of perPart) {
    const chip = el('span', 'perpart__item');
    chip.appendChild(makeIcon(p.slug, p.name, 'item'));
    const label = el('span');
    label.textContent = `${fmt1(p.rate)}${p.fluid ? ' m³' : ''} ${p.name}/min`;
    chip.appendChild(label);
    wrap.appendChild(chip);
  }
  return wrap;
}

/** "Factory diagram" section wrapping the SVG in a horizontally scrollable box. */
function renderDiagramSection(graph) {
  const wrap = el('section');
  const heading = el('h3');
  heading.textContent = 'Factory diagram';
  wrap.appendChild(heading);
  const scroll = el('div', 'diagram-scroll');
  renderDiagram(scroll, graph);
  wrap.appendChild(scroll);
  return wrap;
}

/**
 * "Refinement options" — for each leftover byproduct (surplus), the recipes
 * that could consume it, each rendered as a mini flow diagram scaled to the
 * surplus rate so you can see what you'd get.
 */
function renderRefinements(refinements) {
  const wrap = el('section');
  const heading = el('h3');
  heading.textContent = 'Refinement options';
  wrap.appendChild(heading);
  const hint = el('p', 'hint');
  hint.textContent = 'Ways to use each leftover byproduct — enable the recipe and add its product as a part.';
  wrap.appendChild(hint);

  for (const ref of refinements) {
    const group = el('div', 'refine-group');
    const head = el('div', 'refine-group__head');
    head.appendChild(makeIcon(ref.slug, ref.name, ref.fluid ? 'fluid' : 'item'));
    const label = el('span');
    label.textContent = `${ref.name} surplus · ${fmt1(ref.rate)}${ref.fluid ? ' m³' : ''}/min`;
    head.appendChild(label);
    group.appendChild(head);

    for (const opt of ref.options) {
      const card = el('div', 'refine-option');
      const title = el('div', 'refine-option__title');
      title.textContent = opt.recipeName;
      card.appendChild(title);
      const scroll = el('div', 'diagram-scroll');
      renderDiagram(scroll, opt.graph);
      card.appendChild(scroll);
      group.appendChild(card);
    }
    wrap.appendChild(group);
  }
  return wrap;
}

/**
 * Render a PlanView into rootEl. Idempotent: clears rootEl then rebuilds.
 * All item/recipe/building names are inserted via textContent — never
 * innerHTML — so untrusted dataset strings can't inject markup.
 * @param {HTMLElement} rootEl
 * @param {import('./view-model.js').PlanView} planView
 */
export function renderResults(rootEl, planView) {
  rootEl.replaceChildren();

  rootEl.appendChild(renderHeadline(planView));

  if (planView.perPart && planView.perPart.length > 1) {
    rootEl.appendChild(renderPerPart(planView.perPart));
  }

  if (planView.shortfalls && planView.shortfalls.length > 0) {
    rootEl.appendChild(renderShortfalls(planView.shortfalls));
  }

  rootEl.appendChild(renderTiles(planView.tiles));
  rootEl.appendChild(renderMeters(planView.resourceMeters));
  rootEl.appendChild(renderBuildTable(planView.buildRows));
  rootEl.appendChild(renderBeltList(planView.beltRows));

  if (planView.graph && planView.graph.nodes.length > 0) {
    rootEl.appendChild(renderDiagramSection(planView.graph));
  }

  if (planView.refinements && planView.refinements.length > 0) {
    rootEl.appendChild(renderRefinements(planView.refinements));
  }
}
