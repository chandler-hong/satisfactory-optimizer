/**
 * Expansion view result rendering: the eight report panels (tiles, to-build
 * table, machine totals, your blocks, net output, supply used, raw needed,
 * belts) built from a planExpansion() result.
 *
 * Split out of expansion.js once the DOM-input half and the result-rendering
 * half together crossed the file's ~380-line guideline — this file is the
 * rendering half; expansion.js keeps state, row factories, and wiring.
 *
 * DOM only — all arithmetic lives in js/engine/expansion.js.
 */
import { iconEl as icon } from './icons.js';
import { renderTilesPanel, buildTable, renderMachineTotalsRow, renderBeltRow, renderRequirements, renderShortfalls } from './report-panels.js';
import { buildGraph } from '../engine/graph.js';
import { renderDiagram } from './diagram.js';

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

const extractorSummary = (options) => options.map((o) => `${o.count}× ${o.label}`).join(', ');

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
  section.appendChild(buildTable(rows, ['building', 'recipe', 'machines', 'clock', 'shards', 'power']));
  return section;
}

function renderMachineTotalsPanel(totals) {
  if (!totals || totals.length === 0) return null;
  const section = panel('Machine totals');
  section.appendChild(renderMachineTotalsRow(totals));
  return section;
}

function renderYourBlocksPanel(rows) {
  if (!rows || rows.length === 0) return null;
  const section = panel('Your blocks');
  section.appendChild(buildTable(rows, ['building', 'recipe', 'machines', 'clock']));
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
  for (const b of rows) list.appendChild(renderBeltRow(b, fmt1));
  section.appendChild(list);
  return section;
}

/**
 * "Factory diagram" — the same tiered flow SVG the Optimizer shows, built from
 * this plan's graphRates/graphMachinesById with the net-output items as
 * targets (mirrors js/ui/view-model.js's graph call). Deliberately NOT
 * plan.recipeRates/machinesById — those are LP-solved recipes only, so a
 * plan built entirely from pinned blocks would show none of them and their
 * direct inputs would dangle as false "surplus" (see js/engine/expansion.js's
 * comment on graphRates for the full story). Built here rather than in
 * planExpansion: buildGraph is pure and dataset-shaped, so there's no reason
 * to route it through the engine return value just to hand it straight back.
 *
 * Also passes plan.externallyFedLoad so a block's share of a recipe's merged
 * load renders as a source (a node plus its output edges only) rather than a
 * consumer of its own inputs, even when the LP independently solves that same
 * recipe to cover a shortfall — see js/engine/expansion.js's comment on
 * externallyFedLoad and js/engine/graph.js's buildGraph for why that
 * distinction has to survive into the diagram.
 */
function renderDiagramPanel(dataset, plan) {
  const graph = buildGraph(dataset, plan.graphRates, plan.graphMachinesById, [...plan.netOutput.keys()], plan.externallyFedLoad);
  if (!graph || graph.nodes.length === 0) return null;
  const section = panel('Factory diagram');
  const scroll = el('div', 'diagram-scroll');
  renderDiagram(scroll, graph);
  section.appendChild(scroll);
  return section;
}

/**
 * The maximize headline. An unexplained maximum isn't actionable, so it names
 * whatever supply is fully consumed (see the "At their limit" comment below
 * for why "fully consumed," not "caused" or "bound by," is the claim this
 * makes) — and when nothing is bounded at all, it refuses to print a rate at
 * all rather than showing a number the raw clamp invented.
 */
function renderMaximizePanel(m) {
  const section = panel('Most you can make');
  if (!m.bounded) {
    const p = el('p', 'hint');
    p.textContent = m.perPart.length === 0
      ? 'Pick something to maximize.'
      : `Your declared lines don't feed ${m.perPart.map((x) => x.name).join(' or ')} — there's nothing here to bound the answer. Add a block or a have row it depends on.`;
    section.appendChild(p);
    return section;
  }
  const list = el('ul', 'belt-list');
  for (const p of m.perPart) {
    const li = el('li');
    li.appendChild(icon(p.slug, p.fluid ? 'fluid' : 'item', p.name));
    const nameSpan = el('span');
    nameSpan.textContent = p.name;
    li.appendChild(nameSpan);
    const rateSpan = el('span');
    rateSpan.textContent = `${fmt1(p.rate)}${p.fluid ? ' m³' : ''}/min`;
    li.appendChild(rateSpan);
    list.appendChild(li);
  }
  section.appendChild(list);
  const bound = el('p', 'hint');
  // "At their limit", NOT "bound by": naming which line CAUSES the maximum is
  // ill-posed — where two declared lines are interchangeable feeds the LP has
  // multiple optima and picks one arbitrarily. "Fully consumed" is true in every
  // case. See the spec's note on this; it cost four fix rounds to establish.
  bound.textContent = `At their limit: ${m.atLimitItems.map((b) => `${b.name} ${fmt1(b.rate)}/min`).join(', ')} (fully used).`;
  section.appendChild(bound);
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
 * Whether the plan has a BUILD to show. Deliberately NOT a count of submitted
 * rows: a row whose picker was never given a value, or whose recipeId has since
 * gone stale, would leave every panel below empty while a row count still
 * reported true — the empty-state message would never show. This checks the
 * validated output actually driving the panels instead. (planExpansion used to
 * return exactly such a row-count flag, `hasPlan`, which the original design
 * meant this check to use; it was dead from the day this function replaced it
 * and has since been removed.)
 *
 * Diagnostics are deliberately NOT part of this. They're handled separately by
 * hasDiagnostics, because they answer a different question: this one gates the
 * tiles and the eight build panels, that one gates the callouts above them. An
 * earlier version folded diagnostics in here, which meant an unsatisfiable want
 * row rendered its callout and then a panel of zeroed tiles under it.
 */
export function hasContent(plan) {
  return plan.blockRows.length > 0
    || plan.buildRows.length > 0
    || plan.netOutputRows.length > 0
    || plan.supplyUsage.length > 0
    || plan.rawNeeded.length > 0
    || plan.beltRows.length > 0;
}

/**
 * Whether the plan has something to explain: a want row — or, in Maximize mode,
 * a max row — for an item with no enabled recipe (requirements), or one the LP
 * couldn't fully satisfy (shortfalls). Either produces zero build rows, so
 * without this the plan would fail silently behind the "add a block" hint.
 */
export function hasDiagnostics(plan) {
  return Boolean((plan.requirements && plan.requirements.hasIssues)
    || (plan.shortfalls && plan.shortfalls.length > 0));
}

export function renderPlan(wrap, dataset, plan) {
  wrap.replaceChildren();
  // Diagnostics first and unconditionally on hasDiagnostics — matching the
  // Optimizer's order in render.js, which renders its callouts before the
  // has-production early return rather than after it.
  if (hasDiagnostics(plan)) {
    if (plan.requirements && plan.requirements.hasIssues) wrap.appendChild(renderRequirements(plan.requirements));
    if (plan.shortfalls && plan.shortfalls.length > 0) wrap.appendChild(renderShortfalls(plan.shortfalls));
  }
  // Ahead of the hasContent gate, not after it: an unbounded max-mode plan
  // still has non-empty buildRows/netOutputRows/beltRows (the raw clamp drove
  // them up to a huge-but-finite stand-in), so hasContent(plan) is true even
  // when there's nothing to actually show. Returning here on the unbounded
  // branch keeps that fabricated build-out off the screen entirely, leaving
  // only the refusal message — matching renderMaximizePanel's own contract.
  if (plan.mode === 'max' && plan.maximize) {
    wrap.appendChild(renderMaximizePanel(plan.maximize));
    if (!plan.maximize.bounded) return;
  }
  if (!hasContent(plan)) {
    // The hint only helps someone who hasn't described anything yet; after a
    // diagnostic it would talk over the actual explanation.
    if (!hasDiagnostics(plan)) {
      const p = el('p', 'hint');
      // Not "what has to feed it": 5a6d19e retired that pitch, and a block is
      // always already built and already fed, so the one thing this view will
      // never work out is a block's own feedstock.
      p.textContent = 'Add a block — say 6 Assemblers making Motors — and this will work out what else you need to build.';
      wrap.appendChild(p);
    }
    return;
  }
  wrap.appendChild(renderTilesPanel(plan.tiles, {
    machines: 'Machines to build',
    powerMW: 'Upstream power (MW)',
  }));
  for (const section of [
    renderBuildTablePanel(plan.buildRows),
    renderMachineTotalsPanel(plan.machineTotals),
    renderYourBlocksPanel(plan.blockRows),
    renderNetOutputPanel(plan.netOutputRows),
    renderSupplyUsagePanel(plan.supplyUsage, dataset),
    renderRawNeededPanel(plan.rawNeeded),
    renderBeltsPanel(plan.beltRows),
    renderDiagramPanel(dataset, plan),
  ]) {
    if (section) wrap.appendChild(section);
  }
}
