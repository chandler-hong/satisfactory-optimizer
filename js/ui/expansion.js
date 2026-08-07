/**
 * Expansion view: declare the machine blocks you already have and whatever
 * is already on your bus, and see what has to feed them.
 *
 * DOM only — all arithmetic lives in js/engine/expansion.js. The eight report
 * panels are built by expansion-render.js, split out once this file crossed the
 * ~380-line guideline; this half owns state, row factories, and wiring,
 * following js/ui/power.js as the lifecycle pattern:
 * clear the container, restore state from localStorage inside try/catch, wire
 * live recompute, and call it once more directly at the end for the initial
 * paint. The goals panel lives in this file too, below the row sections.
 */
import { createSearchSelect } from './search-select.js';
import { createAltPicker } from './alt-picker.js';
import { planExpansion, normalizeClock } from '../engine/expansion.js';
import { buildGoalCatalog, evaluateGoals } from '../domain/goals.js';
import { renderPlan, renderGoals } from './expansion-render.js';

const STATE_KEY = 'sat-optimizer:expansion:v1';
const DEFAULT_FILL_MINUTES = 10;
export const DEFAULT_STATE = { rows: [], goals: [], fillMinutes: DEFAULT_FILL_MINUTES, alts: [], mode: 'targets' };

function el(tag, className) {
  const n = document.createElement(tag);
  if (className) n.className = className;
  return n;
}

/**
 * Ceilings on the two numbers that go straight from a text box into the plan.
 * The engine's shard search is bounded now (js/engine/physical-layer.js), so an
 * absurd value no longer takes the tab down, but it still produces a nonsense
 * plan and — because state is persisted — one that comes back on reload. Both
 * limits sit far past anything a real save can reach: 9999 machines is orders of
 * magnitude beyond a megabase, and 1e6/min is past any belt in the game. Note
 * that a `max` attribute does NOT clamp a typed value, so the read has to.
 */
const MAX_MACHINES = 9999;
const MAX_RATE = 1e6;
// A max-mode weight is a dimensionless parts-per-set ratio against the other
// declared targets, not a physical rate or count, so nothing about the game
// bounds it the way a belt bounds MAX_RATE. It still needs a reload-survives
// ceiling for the same reason the other two do: no sensible manual weighting
// needs five digits of ratio against a sibling target, so this stays a UI-layer
// sensibility bound only, module-scoped like MAX_MACHINES so Task 5's own max
// row can reach it too — not a claim about where the engine's LP would break,
// which is a separate question (it stays correct well past this value; see
// planExpansion's own maxTargets guard).
const MAX_WEIGHT = 10000;
const clampTo = (max, value) => Math.min(max, Math.max(0, Number(value) || 0));

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
export function sanitizeState(raw, knownRecipeIds) {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_STATE };
  const rows = [];
  for (const r of Array.isArray(raw.rows) ? raw.rows : []) {
    if (!r || typeof r !== 'object') continue;
    if (r.kind === 'block') {
      const machines = Number(r.machines);
      if (typeof r.recipeId !== 'string' || !Number.isFinite(machines)) continue;
      // Clamped here as well as at the input, so a payload written by an older
      // build, hand-edited, or copied from someone else can't reintroduce a
      // value the live inputs would now refuse.
      rows.push({
        kind: 'block',
        recipeId: r.recipeId,
        machines: clampTo(MAX_MACHINES, machines),
        clock: normalizeClock(r.clock),
      });
    } else if (r.kind === 'want' || r.kind === 'have') {
      const rate = Number(r.rate);
      if (typeof r.itemId !== 'string' || !Number.isFinite(rate)) continue;
      rows.push({ kind: r.kind, itemId: r.itemId, rate: clampTo(MAX_RATE, rate) });
    } else if (r.kind === 'max') {
      if (typeof r.itemId !== 'string' || !r.itemId) continue;
      const weight = Number(r.weight);
      const positive = Number.isFinite(weight) && weight > 0 ? weight : 1;
      rows.push({ kind: 'max', itemId: r.itemId, weight: Math.min(MAX_WEIGHT, positive) });
    }
  }
  const goals = (Array.isArray(raw.goals) ? raw.goals : []).filter((g) => typeof g === 'string');
  const fill = Number(raw.fillMinutes);
  // Feature-test rather than trust the type: a caller could pass anything
  // truthy without a .has method (an array, a plain object) and sanitizeState
  // must degrade to "skip the filter" for it, same as an omitted argument,
  // rather than throw — loadState below wraps this call in try/catch, so a
  // throw here wouldn't just fail to filter, it would discard the entire
  // saved plan and fall back to defaults. Hoisted out of the filter callback
  // since it's loop-invariant.
  const canFilter = typeof knownRecipeIds?.has === 'function';
  const alts = (Array.isArray(raw.alts) ? raw.alts : [])
    .filter((id) => typeof id === 'string')
    .filter((id) => !canFilter || knownRecipeIds.has(id));
  const mode = raw.mode === 'max' ? 'max' : 'targets';
  return { rows, goals, fillMinutes: Number.isFinite(fill) && fill > 0 ? fill : DEFAULT_FILL_MINUTES, alts, mode };
}

function loadState(knownRecipeIds) {
  try { return sanitizeState(JSON.parse(localStorage.getItem(STATE_KEY) || 'null'), knownRecipeIds); }
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
  // A hint for the spinner and for form validation only — neither this nor
  // clockInput.max below clamps a value the user types (or pastes, including
  // scientific notation like 1e10). The read at the bottom of this function is
  // what actually enforces MAX_MACHINES.
  machinesInput.max = String(MAX_MACHINES);
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
      machines: clampTo(MAX_MACHINES, machinesInput.value),
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
  rateInput.max = String(MAX_RATE); // a hint only; the read below is the real clamp
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
      rate: clampTo(MAX_RATE, rateInput.value),
    }),
  };
}

/**
 * One maximize target: item picker plus a relative weight (parts-per-set
 * ratio against sibling targets), no rate box — max mode solves for the rate,
 * it doesn't take one. `weight` is clamped through MAX_WEIGHT here, the same
 * way makeBlockRow/makeRateRow clamp their own numeric field through
 * MAX_MACHINES/MAX_RATE: recompute() feeds this read() output straight to
 * both the live solve and saveState, so an unclamped value here would solve
 * live at whatever the user typed but silently come back clamped after a
 * reload — sanitizeState only sanitizes on load, not on save.
 */
function makeMaxRow(itemOpts, initial, onChange) {
  const row = el('div', 'target-row');
  const picker = createSearchSelect({ options: itemOpts, placeholder: 'Item…', showIcon: true });
  picker.el.style.width = '100%';
  row.appendChild(picker.el);

  const foot = el('div', 'target-row__foot');
  const label = el('span', 'target-row__label');
  label.textContent = 'Weight';
  const weightInput = numberInput({ value: initial?.weight ?? 1, min: 1, step: 1, width: '4rem' });
  weightInput.max = String(MAX_WEIGHT); // a hint only; the read below is the real clamp
  const removeBtn = el('button');
  removeBtn.type = 'button';
  removeBtn.textContent = 'Remove';
  removeBtn.style.marginLeft = 'auto';
  foot.append(label, weightInput, removeBtn);
  row.appendChild(foot);

  picker.onSelect(onChange);
  weightInput.addEventListener('input', onChange);
  if (initial?.itemId) picker.setValue(initial.itemId);

  return {
    el: row,
    removeBtn,
    read: () => ({ kind: 'max', itemId: picker.getValue(), weight: clampTo(MAX_WEIGHT, weightInput.value) || 1 }),
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
    // Milestones group per tier; phases all sit under one heading, so they key on
    // kind alone — keying them on order too printed "Space Elevator" five times,
    // once per phase. `kind` stays in the key either way, which is what keeps a
    // tier-N milestone and Phase N apart: Goal.order is scale-relative to kind,
    // so both carry order 1.
    const groupKey = g.kind === 'milestone' ? `milestone-${g.order}` : g.kind;
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

/** Replace `target`'s contents with a single plain-text paragraph. */
function renderMessage(target, text) {
  target.replaceChildren();
  const p = el('p');
  p.textContent = text;
  target.appendChild(p);
}

/**
 * Run the engine and goals evaluation for one recompute, without touching the
 * DOM. Exists so a throw from planExpansion has somewhere to land besides
 * propagating out of recompute() uncaught: an extreme input (e.g. a want rate
 * large enough that the LP sizes some upstream recipe's load past what
 * physical-layer.js's allocateShards can handle — its shard search spreads
 * one array per recipe into Math.max, which throws "Maximum call stack size
 * exceeded" once that array is large enough) is a real, reachable case, not
 * hypothetical, and nothing about the guard should be specific to that one
 * failure mode. Split out (rather than inlining the try/catch in recompute())
 * so a test can call this directly with a plain object — no document, no
 * localStorage — and assert it returns `{ ok: false }` instead of throwing.
 * Returns `{ ok: true, plan, goalViews, shortfallRows }` on success.
 */
export function computeExpansionResult({ dataset, rows, enabledRecipeIds, catalog, goals, fillMinutes, mode }) {
  try {
    const plan = planExpansion({ dataset, rows, enabledRecipeIds, mode });
    // Goals is a Target-rates feature — the Maximize mode note says so, and
    // applyMode() hides goalsWrap (the checkbox list built by
    // buildGoalsSection) when the mode select reads "max". But that only
    // hides the input checkboxes, not the `selected` Set backing them, and
    // recompute() renders the Goals *report card* separately, straight into
    // resultsPane via renderGoals() — a pane applyMode() never touches. So
    // without this gate, a goal checked before switching to Maximize kept
    // being scored and its report card kept rendering in full view in the
    // results pane, complete with a live "Add N shortfalls as WANT rows"
    // button that could still inject a row into the Want section the user
    // can no longer see. Passing [] here is enough: renderGoals returns
    // immediately on an empty array and uncoveredToRows([]) is already a
    // no-op.
    const goalViews = mode === 'max' ? [] : evaluateGoals(catalog, goals, plan.netOutput, fillMinutes);
    const shortfallRows = uncoveredToRows(goalViews);
    return { ok: true, plan, goalViews, shortfallRows };
  } catch (error) {
    return { ok: false, error };
  }
}

/**
 * Build the Expansion view into `container`: a rows panel (blocks / want /
 * have / goals) on the left, the plan + goals report on the right.
 * `enabledRecipeIds` comes from this view's own alternates picker, off by
 * default — separate saved state from the Optimizer's picker, since each
 * view can explore a different "what's unlocked" hypothesis. A block row can
 * still name a disabled alternate: the picker gates what the LP may choose,
 * not what a block may declare.
 */
export function buildExpansion(dataset, container) {
  container.replaceChildren();

  const recipeOpts = recipeOptions(dataset);
  const itemOpts = itemOptions(dataset);
  const recipeById = new Map(dataset.recipes.map((r) => [r.id, r]));
  const saved = loadState(new Set(dataset.recipes.map((r) => r.id)));

  const altPicker = createAltPicker({
    dataset,
    // scheduleRecompute is defined further down; the arrow defers the lookup to
    // click time so this doesn't read it before initialisation.
    onChange: () => scheduleRecompute(),
    warningText: "⚠ Alternate recipes are disabled by default — expand below and enable the ones you've unlocked. Blocks can still use any recipe.",
  });
  altPicker.setEnabled(saved.alts || []);

  function currentEnabledRecipeIds() {
    const enabledAlts = altPicker.getEnabledIds();
    const ids = new Set();
    for (const r of dataset.recipes) {
      if (!r.alternate) ids.add(r.id);
      else if (enabledAlts.has(r.id)) ids.add(r.id);
    }
    return ids;
  }

  const modeSelect = el('select');
  for (const [value, label] of [['targets', 'Target rates'], ['max', 'Maximize']]) {
    const opt = el('option');
    opt.value = value;
    opt.textContent = label;
    modeSelect.appendChild(opt);
  }
  modeSelect.value = saved.mode === 'max' ? 'max' : 'targets';
  const modeRow = el('div', 'exp-mode');
  const modeLabel = el('span', 'target-row__label');
  modeLabel.textContent = 'Mode';
  modeRow.append(modeLabel, modeSelect);

  // These three are view-wide controls, so they sit above the two-pane grid
  // rather than inside either pane — but appended straight into `container`
  // they had no backing surface at all: .expansion-view is a SIBLING of .app
  // (index.html), so neither .sidebar's nor .results' panel treatment reaches
  // here, and the computed background chain ran all the way up to body's
  // wallpaper. 110 recipe rows and their icons painted directly on it, which
  // also made a liar of the invariant css/styles.css states over that
  // wallpaper ("UI panels are opaque, so content readability is never
  // affected"). .exp-controls gives them the same panel .sidebar/.exp-rows/
  // .exp-results already use.
  const controls = el('div', 'exp-controls');
  controls.append(altPicker.warningEl, altPicker.el, modeRow);
  container.appendChild(controls);

  const grid = el('div', 'exp');
  container.appendChild(grid);
  const rowsPane = el('div', 'exp-rows');
  const resultsPane = el('div', 'exp-results');
  grid.append(rowsPane, resultsPane);

  /**
   * A failing plan must not take the whole view down with it — rowsPane (the
   * blocks/want/have/goals sections built below) has to stay mounted and
   * editable so the bad value can actually be walked back. Mirrors js/main.js's
   * Optimizer recompute(), just against exp-rows/exp-results instead of
   * #inputs/#results.
   */
  function recompute() {
    const rows = [...blockSection.readAll(), ...wantSection.readAll(), ...maxSection.readAll(), ...haveSection.readAll()];
    const goals = goalsSection.getSelectedIds();
    const fillMinutes = goalsSection.getFillMinutes();
    const mode = modeSelect.value === 'max' ? 'max' : 'targets';
    const result = computeExpansionResult({
      dataset, rows, enabledRecipeIds: currentEnabledRecipeIds(), catalog, goals, fillMinutes, mode,
    });
    if (!result.ok) {
      // Deliberately not persisted. Saving before the compute meant a value that
      // killed it was already on disk, so the next page load replayed the same
      // failure — and buildSecondaryView's error path replaces the entire view,
      // taking the rows that would fix it along with it. The cost is that an
      // edit which fails to compute is lost on reload, which is the better half
      // of that trade: the app always boots.
      console.error(result.error);
      renderMessage(resultsPane, `Failed to compute plan: ${result.error?.message ?? String(result.error)}`);
      return;
    }
    saveState({ rows, goals, fillMinutes, alts: [...altPicker.getEnabledIds()], mode });
    try {
      renderPlan(resultsPane, dataset, result.plan);
      renderGoals(resultsPane, result.goalViews, result.shortfallRows.length, () => addShortfallRows(result.shortfallRows));
    } catch (err) {
      console.error(err);
      renderMessage(resultsPane, `Failed to render plan: ${err?.message ?? String(err)}`);
    }
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
    'Machines you already have. Their feedstock is assumed to be flowing, so only what they make counts toward the plan.',
    '+ Add block',
    (initial, onChange) => makeBlockRow(dataset, recipeOpts, recipeById, initial, onChange),
    scheduleRecompute,
  );
  const wantWrap = el('div');
  rowsPane.appendChild(wantWrap);
  const wantSection = buildRowSection(
    wantWrap,
    'Want',
    'Flat extra demand for an item, on top of whatever the blocks above consume.',
    '+ Add want',
    (initial, onChange) => makeRateRow('want', itemOpts, initial, onChange),
    scheduleRecompute,
  );
  // Task 5 post-plan review round 2, Important (README.md's Maximize
  // paragraph). Mirrors goalsNote below: Want has no flat rate to declare in
  // Maximize mode, so rather than the section just vanishing with nothing
  // left in its place, this one-line note stands in the gap and says why —
  // matching Goals' own treatment instead of being the one hidden section
  // that silently disappears.
  const wantNote = el('p', 'hint');
  wantNote.textContent = 'Want adds a flat demand rate, so it applies in Target rates mode.';
  rowsPane.appendChild(wantNote);
  const maxWrap = el('div');
  rowsPane.appendChild(maxWrap);
  const maxSection = buildRowSection(
    maxWrap,
    'Maximize',
    'Make as much of this as your declared lines allow. Weight sets the ratio when you pick more than one.',
    '+ Add target',
    (initial, onChange) => makeMaxRow(itemOpts, initial, onChange),
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
  const goalsWrap = el('div');
  rowsPane.appendChild(goalsWrap);
  const goalsSection = buildGoalsSection(
    goalsWrap,
    catalog,
    { goals: saved.goals.filter((id) => catalogIds.has(id)), fillMinutes: saved.fillMinutes },
    scheduleRecompute,
  );
  const goalsNote = el('p', 'hint');
  goalsNote.textContent = 'Goals plan a fixed milestone cost, so they apply in Target rates mode.';
  rowsPane.appendChild(goalsNote);

  // Toggle wrappers, never the rows inside them, so switching modes doesn't
  // lose what the user typed. `have` has no wrapper: a have row is a supply
  // floor the plan can draw on either way, so it applies in both modes.
  function applyMode() {
    const isMax = modeSelect.value === 'max';
    wantWrap.hidden = isMax;
    wantNote.hidden = !isMax;
    maxWrap.hidden = !isMax;
    goalsWrap.hidden = isMax;
    goalsNote.hidden = !isMax;
  }
  modeSelect.addEventListener('change', () => { applyMode(); scheduleRecompute(); });

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
    } else if (r.kind === 'max') {
      maxSection.addRow(itemIds.has(r.itemId) ? r : { ...r, itemId: null });
    }
  }

  applyMode();
  recompute();
}
