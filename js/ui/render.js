import { iconEl } from './icons.js';
import { fmt1 } from './view-model.js';
import { renderDiagram } from './diagram.js';
import { buildTable, renderMachineTotalsRow, renderBeltRow, renderTilesPanel, renderRequirements, renderShortfalls, renderSuggestions } from './report-panels.js';

function el(tag, className) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  return node;
}

/**
 * Icon for `slug` with `name` as its alt text. Argument order differs from
 * `iconEl`'s because every call site here has a name to describe the icon.
 * @param {string|undefined} slug
 * @param {string} name  used as the alt text (set as a property, not parsed as HTML)
 * @param {'building'|'fluid'|'item'} kind
 */
function makeIcon(slug, name, kind) {
  return iconEl(slug, kind, name || '');
}

function renderHeadline(planView) {
  const h = el('h2');
  h.textContent = planView.headline;
  if (!planView.feasible) h.classList.add('critical');
  return h;
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

function renderBuildTable(rows, totals) {
  const wrap = el('section');
  const heading = el('h3');
  heading.textContent = 'Build';
  wrap.appendChild(heading);

  // Totals per machine type (summed across recipes), before the per-recipe table.
  if (totals && totals.length > 0) {
    wrap.appendChild(renderMachineTotalsRow(totals));
  }

  wrap.appendChild(buildTable(rows, ['building', 'recipe', 'machines', 'clock', 'shards', 'power'], 'No production required.'));
  return wrap;
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
    for (const b of rows) list.appendChild(renderBeltRow(b, fmt1));
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
export function renderResults(rootEl, planView, handlers = {}) {
  rootEl.replaceChildren();

  rootEl.appendChild(renderHeadline(planView));

  if (planView.requirements && planView.requirements.hasIssues) {
    rootEl.appendChild(renderRequirements(planView.requirements));
  }

  // Rendered BEFORE the hide-empty-plan return so "enable X to build this at
  // all" still shows when the base recipes produce nothing.
  if (planView.suggestions && planView.suggestions.length > 0) {
    rootEl.appendChild(renderSuggestions(planView.suggestions, handlers.onEnableAlternate));
  }

  // Nothing to build — the requirements callout(s) above explain why. Skip the
  // empty tiles / "No production required" table / empty meters / diagram.
  if (!planView.hasProduction) return;

  if (planView.perPart && planView.perPart.length > 1) {
    rootEl.appendChild(renderPerPart(planView.perPart));
  }

  if (planView.shortfalls && planView.shortfalls.length > 0) {
    rootEl.appendChild(renderShortfalls(planView.shortfalls));
  }

  rootEl.appendChild(renderTilesPanel(planView.tiles));
  rootEl.appendChild(renderMeters(planView.resourceMeters));
  rootEl.appendChild(renderBuildTable(planView.buildRows, planView.machineTotals));
  rootEl.appendChild(renderBeltList(planView.beltRows));

  if (planView.graph && planView.graph.nodes.length > 0) {
    rootEl.appendChild(renderDiagramSection(planView.graph));
  }

  if (planView.refinements && planView.refinements.length > 0) {
    rootEl.appendChild(renderRefinements(planView.refinements));
  }
}
