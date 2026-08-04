/**
 * Expansion view: declare the machine blocks you've decided to build and whatever
 * is already on your bus, and see what has to feed them.
 *
 * DOM only — all arithmetic lives in js/engine/expansion.js. The eight report
 * panels are built by expansion-render.js, split out once this file crossed the
 * ~380-line guideline (task-7-brief.md Step 3); this half owns state, row
 * factories, and wiring, following js/ui/power.js as the lifecycle pattern:
 * clear the container, restore state from localStorage inside try/catch, wire
 * live recompute, and call it once more directly at the end for the initial
 * paint. Task 8 adds the goals panel to this same file.
 */
import { createSearchSelect } from './search-select.js';
import { planExpansion } from '../engine/expansion.js';
import { buildGoalCatalog, evaluateGoals } from '../domain/goals.js';
import { renderPlan, renderGoals } from './expansion-render.js';

const STATE_KEY = 'sat-optimizer:expansion:v1';
const DEFAULT_FILL_MINUTES = 10;
export const DEFAULT_STATE = { rows: [], goals: [], fillMinutes: DEFAULT_FILL_MINUTES };

function el(tag, className) {
  const n = document.createElement(tag);
  if (className) n.className = className;
  return n;
}

/**
 * Delay invoking `fn` until `wait` ms after the last call. js/main.js has its
 * own copy of this exact function but doesn't export it, so it's duplicated
 * here rather than reworking that module's exports for one helper.
 */
function debounce(fn, wait) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), wait);
  };
}

/**
 * Coerce whatever came out of localStorage into a usable state. Persisted state
 * outlives code, so an old or hand-edited payload must degrade to defaults rather
 * than throwing during boot.
 */
export function sanitizeState(raw) {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_STATE };
  const rows = [];
  for (const r of Array.isArray(raw.rows) ? raw.rows : []) {
    if (!r || typeof r !== 'object') continue;
    if (r.kind === 'block') {
      const machines = Number(r.machines);
      const clock = Number(r.clock);
      if (typeof r.recipeId !== 'string' || !Number.isFinite(machines)) continue;
      rows.push({ kind: 'block', recipeId: r.recipeId, machines, clock: Number.isFinite(clock) && clock > 0 ? clock : 1 });
    } else if (r.kind === 'want' || r.kind === 'have') {
      const rate = Number(r.rate);
      if (typeof r.itemId !== 'string' || !Number.isFinite(rate)) continue;
      rows.push({ kind: r.kind, itemId: r.itemId, rate });
    }
  }
  const goals = (Array.isArray(raw.goals) ? raw.goals : []).filter((g) => typeof g === 'string');
  const fill = Number(raw.fillMinutes);
  return { rows, goals, fillMinutes: Number.isFinite(fill) && fill > 0 ? fill : DEFAULT_FILL_MINUTES };
}

function loadState() {
  try { return sanitizeState(JSON.parse(localStorage.getItem(STATE_KEY) || 'null')); }
  catch { return { ...DEFAULT_STATE }; }
}

function saveState(state) {
  try { localStorage.setItem(STATE_KEY, JSON.stringify(state)); } catch { /* storage unavailable: session-only */ }
}

/**
 * Want rows for every part the selected goals still need. Where two goals want the
 * same part, the higher rate wins rather than the sum: the rates are independent
 * "deliver this much within the horizon" figures, and adding them would size the
 * factory for delivering both goals simultaneously, which isn't what was asked.
 */
export function uncoveredToRows(goalViews) {
  const best = new Map();
  for (const v of goalViews || []) {
    for (const u of v.uncovered || []) {
      if (!best.has(u.itemId) || u.rate > best.get(u.itemId)) best.set(u.itemId, u.rate);
    }
  }
  return [...best].map(([itemId, rate]) => ({ kind: 'want', itemId, rate }));
}

function numberInput({ value = 0, min = 0, step = 1, placeholder, width = '4.5rem' } = {}) {
  const input = el('input');
  input.type = 'number';
  input.min = String(min);
  input.step = String(step);
  if (placeholder) input.placeholder = placeholder;
  input.value = String(value);
  input.style.width = width;
  return input;
}

function sectionHeading(text) {
  const h = el('h3');
  h.textContent = text;
  return h;
}

/**
 * Every recipe whose building resolves, labelled "<recipe> · <building>" so an
 * alternate reads distinctly from the recipe it replaces (both make the same
 * product). The picker's icon shows the product, not the building.
 */
function recipeOptions(dataset) {
  const options = [];
  for (const r of dataset.recipes) {
    const building = dataset.buildings.get(r.buildingId);
    if (!building) continue;
    const outputSlug = dataset.items.get(r.outputs?.[0]?.itemId)?.slug;
    options.push({ id: r.id, name: `${r.name} · ${building.name}`, slug: outputSlug });
  }
  return options;
}

/** Every non-special__ item, for want/have row pickers. */
function itemOptions(dataset) {
  const options = [];
  for (const item of dataset.items.values()) {
    if (item.id.startsWith('special__')) continue;
    options.push({ id: item.id, name: item.name, slug: item.slug });
  }
  return options;
}

/**
 * One machine-block row: recipe picker, machine count, clock %, a derived
 * building-name label, and a remove button. `clock` is stored/read as the
 * 0-2.5 fraction planExpansion expects (1 = 100%, matching pinnedBalance's
 * convention), but shown/edited as a whole percent.
 */
function makeBlockRow(dataset, recipeOpts, recipeById, initial, onChange) {
  const row = el('div', 'target-row');
  const picker = createSearchSelect({ options: recipeOpts, placeholder: 'Recipe…', showIcon: true });
  picker.el.style.width = '100%';
  row.appendChild(picker.el);

  const foot = el('div', 'target-row__foot');
  const machinesLabel = el('span', 'target-row__label');
  machinesLabel.textContent = 'Machines';
  const machinesInput = numberInput({ value: initial?.machines ?? 1, min: 1, step: 1, width: '4rem' });
  const clockLabel = el('span', 'target-row__label');
  clockLabel.textContent = 'Clock %';
  const clockInput = numberInput({ value: Math.round((initial?.clock ?? 1) * 100), min: 1, step: 1, width: '4.5rem' });
  clockInput.max = '250';
  const buildingLabel = el('span', 'target-row__label');
  const removeBtn = el('button');
  removeBtn.type = 'button';
  removeBtn.textContent = 'Remove';
  removeBtn.style.marginLeft = 'auto';
  foot.append(machinesLabel, machinesInput, clockLabel, clockInput, buildingLabel, removeBtn);
  row.appendChild(foot);

  function refreshBuildingLabel() {
    const recipe = recipeById.get(picker.getValue());
    const building = recipe ? dataset.buildings.get(recipe.buildingId) : null;
    buildingLabel.textContent = building ? building.name : '';
  }
  picker.onSelect(() => { refreshBuildingLabel(); onChange(); });
  machinesInput.addEventListener('input', onChange);
  clockInput.addEventListener('input', onChange);
  if (initial?.recipeId) picker.setValue(initial.recipeId);
  refreshBuildingLabel();

  return {
    el: row,
    removeBtn,
    read: () => ({
      kind: 'block',
      recipeId: picker.getValue(),
      machines: Math.max(0, Number(machinesInput.value) || 0),
      clock: (Number(clockInput.value) || 0) / 100,
    }),
  };
}

/** One want/have rate row: item picker, a rate number input, and a remove button. */
function makeRateRow(kind, itemOpts, initial, onChange) {
  const row = el('div', 'target-row');
  const picker = createSearchSelect({ options: itemOpts, placeholder: 'Item…', showIcon: true });
  picker.el.style.width = '100%';
  row.appendChild(picker.el);

  const foot = el('div', 'target-row__foot');
  const label = el('span', 'target-row__label');
  label.textContent = 'Rate /min';
  const rateInput = numberInput({ value: initial?.rate ?? '', min: 0, step: 'any', placeholder: 'rate /min', width: '6rem' });
  const removeBtn = el('button');
  removeBtn.type = 'button';
  removeBtn.textContent = 'Remove';
  removeBtn.style.marginLeft = 'auto';
  foot.append(label, rateInput, removeBtn);
  row.appendChild(foot);

  picker.onSelect(onChange);
  rateInput.addEventListener('input', onChange);
  if (initial?.itemId) picker.setValue(initial.itemId);

  return {
    el: row,
    removeBtn,
    read: () => ({
      kind,
      itemId: picker.getValue(),
      rate: Math.max(0, Number(rateInput.value) || 0),
    }),
  };
}

/**
 * A labelled group of add/remove-able rows (Blocks / Want / Have): heading,
 * hint, the row list, and an "+ Add" button. Mirrors js/ui/inputs.js's own
 * target-row convention — an array kept in sync by filtering it on remove,
 * rather than re-deriving the list from the DOM at read time.
 */
function buildRowSection(parent, heading, hint, addLabel, makeRow, scheduleRecompute) {
  parent.appendChild(sectionHeading(heading));
  const hintEl = el('p', 'hint');
  hintEl.textContent = hint;
  parent.appendChild(hintEl);

  const listEl = el('div');
  parent.appendChild(listEl);

  let rows = [];
  function addRow(initial) {
    const row = makeRow(initial, scheduleRecompute);
    row.removeBtn.addEventListener('click', () => {
      rows = rows.filter((r) => r !== row);
      row.el.remove();
      scheduleRecompute();
    });
    rows.push(row);
    listEl.appendChild(row.el);
    return row;
  }

  const addBtn = el('button');
  addBtn.type = 'button';
  addBtn.textContent = addLabel;
  addBtn.addEventListener('click', () => {
    addRow(null);
    scheduleRecompute();
  });
  parent.appendChild(addBtn);

  return { addRow, readAll: () => rows.map((r) => r.read()) };
}

/**
 * The goals checkbox list (milestones grouped by tier, then the Space Elevator
 * phases) plus the "fill in [N] min" horizon input. `catalog` arrives already
 * in the right order — all milestones by tier, then all phases — because
 * `order` is only comparable within a `kind` (a tier-1 milestone and Phase 1
 * both carry `order: 1`), so this groups by walking that order and starting a
 * new heading whenever (kind, order) changes, rather than re-sorting.
 */
function buildGoalsSection(parent, catalog, initial, scheduleRecompute) {
  parent.appendChild(sectionHeading('Goals'));
  const hint = el('p', 'hint');
  hint.textContent = 'Tick a HUB milestone or Space Elevator phase to check your plan against its cost.';
  parent.appendChild(hint);

  const listEl = el('div', 'exp-goal-list');
  parent.appendChild(listEl);

  const selected = new Set(initial.goals);
  let lastGroup = null;
  for (const g of catalog) {
    const groupKey = `${g.kind}-${g.order}`;
    if (groupKey !== lastGroup) {
      const heading = el('p', 'exp-goal-group');
      heading.textContent = g.kind === 'milestone' ? `Tier ${g.order}` : 'Space Elevator';
      listEl.appendChild(heading);
      lastGroup = groupKey;
    }
    const row = el('label', 'exp-goal-row');
    const checkbox = el('input');
    checkbox.type = 'checkbox';
    checkbox.checked = selected.has(g.id);
    checkbox.addEventListener('change', () => {
      if (checkbox.checked) selected.add(g.id);
      else selected.delete(g.id);
      scheduleRecompute();
    });
    row.appendChild(checkbox);
    const label = el('span');
    label.textContent = g.label;
    row.appendChild(label);
    listEl.appendChild(row);
  }

  const fillRow = el('div', 'exp-goal-fill');
  const fillLabel = el('span', 'target-row__label');
  fillLabel.textContent = 'fill in';
  const fillInput = numberInput({ value: initial.fillMinutes, min: 1, step: 1, width: '4rem' });
  const fillSuffix = el('span', 'target-row__label');
  fillSuffix.textContent = 'min';
  fillRow.append(fillLabel, fillInput, fillSuffix);
  fillInput.addEventListener('input', scheduleRecompute);
  parent.appendChild(fillRow);

  return {
    getSelectedIds: () => [...selected],
    getFillMinutes: () => Math.max(1, Number(fillInput.value) || 1),
  };
}

/**
 * Build the Expansion view into `container`: a rows panel (blocks / want /
 * have / goals) on the left, the plan + goals report on the right.
 * `enabledRecipeIds` is every recipe — the Optimizer's alternate-recipe
 * checkboxes are that view's own state, and sharing them across views is out
 * of scope here.
 */
export function buildExpansion(dataset, container) {
  container.replaceChildren();

  const recipeOpts = recipeOptions(dataset);
  const itemOpts = itemOptions(dataset);
  const recipeById = new Map(dataset.recipes.map((r) => [r.id, r]));
  const enabledRecipeIds = new Set(dataset.recipes.map((r) => r.id));
  const saved = loadState();

  const grid = el('div', 'exp');
  container.appendChild(grid);
  const rowsPane = el('div', 'exp-rows');
  const resultsPane = el('div', 'exp-results');
  grid.append(rowsPane, resultsPane);

  function recompute() {
    const rows = [...blockSection.readAll(), ...wantSection.readAll(), ...haveSection.readAll()];
    const goals = goalsSection.getSelectedIds();
    const fillMinutes = goalsSection.getFillMinutes();
    saveState({ rows, goals, fillMinutes });
    const plan = planExpansion({ dataset, rows, enabledRecipeIds });
    renderPlan(resultsPane, dataset, plan);
    const goalViews = evaluateGoals(catalog, goals, plan.netOutput, fillMinutes);
    const shortfallRows = uncoveredToRows(goalViews);
    renderGoals(resultsPane, goalViews, shortfallRows.length, () => addShortfallRows(shortfallRows));
  }
  const scheduleRecompute = debounce(recompute, 150);

  /**
   * Turn each shortfall row into a new Want row, skipping any item that
   * already has one so the button never silently doubles a rate the user
   * already set. A discrete click rather than a stream of input events, so
   * this recomputes right away instead of going through the debounce.
   */
  function addShortfallRows(rows) {
    const existing = new Set(wantSection.readAll().map((r) => r.itemId).filter(Boolean));
    for (const row of rows) {
      if (existing.has(row.itemId)) continue;
      wantSection.addRow({ itemId: row.itemId, rate: row.rate });
      existing.add(row.itemId);
    }
    recompute();
  }

  const blockSection = buildRowSection(
    rowsPane,
    'Blocks',
    "Machines you've decided to build, e.g. 6× Assembler making Motors.",
    '+ Add block',
    (initial, onChange) => makeBlockRow(dataset, recipeOpts, recipeById, initial, onChange),
    scheduleRecompute,
  );
  const wantSection = buildRowSection(
    rowsPane,
    'Want',
    'Flat extra demand for an item, on top of whatever the blocks above consume.',
    '+ Add want',
    (initial, onChange) => makeRateRow('want', itemOpts, initial, onChange),
    scheduleRecompute,
  );
  const haveSection = buildRowSection(
    rowsPane,
    'Have',
    'Supply already on your bus (e.g. 300 Rubber/min from an existing plant) that the plan can draw from before asking for more.',
    '+ Add have',
    (initial, onChange) => makeRateRow('have', itemOpts, initial, onChange),
    scheduleRecompute,
  );
  const catalog = buildGoalCatalog(dataset);
  const catalogIds = new Set(catalog.map((g) => g.id));
  const goalsSection = buildGoalsSection(
    rowsPane,
    catalog,
    { goals: saved.goals.filter((id) => catalogIds.has(id)), fillMinutes: saved.fillMinutes },
    scheduleRecompute,
  );

  // Restore saved rows without firing change events; recompute() below paints
  // once at the end. An id from a since-removed recipe/item degrades to an
  // unselected picker (rather than skipping the row and losing its other
  // fields) instead of throwing, mirroring buildInputs' restoreState. Goals
  // need no such loop: buildGoalsSection above already built each checkbox's
  // initial `checked` state directly from the (already-filtered) saved list.
  const recipeIds = new Set(recipeOpts.map((o) => o.id));
  const itemIds = new Set(itemOpts.map((o) => o.id));
  for (const r of saved.rows) {
    if (r.kind === 'block') {
      blockSection.addRow(recipeIds.has(r.recipeId) ? r : { ...r, recipeId: null });
    } else if (r.kind === 'want') {
      wantSection.addRow(itemIds.has(r.itemId) ? r : { ...r, itemId: null });
    } else if (r.kind === 'have') {
      haveSection.addRow(itemIds.has(r.itemId) ? r : { ...r, itemId: null });
    }
  }

  recompute();
}
