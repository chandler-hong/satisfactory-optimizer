import { capsFromInputs } from '../engine/resource-model.js';
import { iconUrl } from './icons.js';

const MINER_TIERS = ['Mk1', 'Mk2', 'Mk3'];
const BELT_TIERS = ['Mk1', 'Mk2', 'Mk3', 'Mk4', 'Mk5', 'Mk6'];
const PIPE_TIERS = ['Mk1', 'Mk2'];

function el(tag, className) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  return node;
}

/** `<label>` wrapping a text span + a control, stacked vertically. */
function fieldRow(labelText, controlNode) {
  const wrap = el('label');
  wrap.style.display = 'flex';
  wrap.style.flexDirection = 'column';
  wrap.style.gap = '0.25rem';
  wrap.style.fontSize = '0.8rem';
  wrap.style.marginBottom = '0.6rem';
  const span = el('span');
  span.textContent = labelText;
  wrap.append(span, controlNode);
  return wrap;
}

function sectionHeading(text) {
  const h = el('h3');
  h.textContent = text;
  return h;
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

function readCount(input) {
  return Math.max(0, Math.floor(Number(input.value) || 0));
}

/** Blank means "not set" -> null; anything non-numeric also -> null.
 * Negative values also -> null (never feed a negative resource cap to the LP). */
function readOverride(input) {
  const raw = input.value.trim();
  if (raw === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.max(0, n) : null;
}

function makeTierSelect(tiers, defaultTier) {
  const select = el('select');
  for (const t of tiers) {
    const opt = el('option');
    opt.value = t;
    opt.textContent = t;
    select.appendChild(opt);
  }
  select.value = defaultTier;
  return select;
}

/**
 * Minimal hand-rolled searchable combobox. There is no build step / no new
 * dependency allowed, and a native `<input list=datalist>` cannot render
 * icons in its suggestion popup, so this hand-rolls a text `<input>` plus a
 * filtered, absolutely-positioned option list. Reused for the raw-resource
 * picker, the max-mode target picker, and each target-rate row's item
 * picker.
 *
 * The dropdown's background/border reuse the existing `--surface`/`--border`
 * custom properties via inline styles rather than adding new rules to
 * css/styles.css, which is out of scope for this task (see task-5-report.md).
 *
 * @param {{options: {id:string,name:string,slug?:string}[], placeholder?: string, showIcon?: boolean}} opts
 * @returns {{el: HTMLElement, getValue: () => (string|null), setValue: (id: string) => void, onSelect: (cb: (id: string) => void) => void}}
 */
function createSearchSelect({ options, placeholder = 'Search…', showIcon = false }) {
  const sorted = [...options].sort((a, b) => a.name.localeCompare(b.name));
  const byId = new Map(sorted.map((o) => [o.id, o]));

  const wrap = el('div');
  wrap.style.position = 'relative';

  const input = el('input');
  input.type = 'text';
  input.placeholder = placeholder;
  input.autocomplete = 'off';
  input.style.width = '100%';
  input.style.boxSizing = 'border-box';
  wrap.appendChild(input);

  const list = el('div', 'search-list');
  list.style.position = 'absolute';
  list.style.top = 'calc(100% + 4px)';
  list.style.left = '0';
  list.style.right = '0';
  list.style.zIndex = '20';
  list.style.display = 'none';
  wrap.appendChild(list);

  let selectedId = null;
  let currentMatches = [];
  let onSelectCb = null;

  function labelFor(id) {
    return id ? byId.get(id)?.name ?? '' : '';
  }

  function selectOption(opt) {
    selectedId = opt.id;
    input.value = opt.name;
    list.style.display = 'none';
    if (onSelectCb) onSelectCb(opt.id);
  }

  function renderList(filterText) {
    list.replaceChildren();
    const q = filterText.trim().toLowerCase();
    currentMatches = (q ? sorted.filter((o) => o.name.toLowerCase().includes(q)) : sorted).slice(0, 50);

    if (currentMatches.length === 0) {
      const empty = el('div', 'search-empty');
      empty.textContent = 'No matches';
      list.appendChild(empty);
      return;
    }

    for (const opt of currentMatches) {
      const btn = el('button', 'search-option');
      btn.type = 'button';
      if (showIcon) {
        const url = iconUrl(opt.slug);
        if (url) {
          const img = el('img', 'icon');
          img.loading = 'lazy';
          img.src = url;
          img.alt = '';
          img.onerror = () => img.remove();
          btn.appendChild(img);
        }
      }
      const span = el('span');
      span.textContent = opt.name;
      btn.appendChild(span);
      // Selection happens on mousedown (with preventDefault) rather than
      // click: preventDefault stops the input from blurring first, so the
      // input keeps focus and this handler runs deterministically before
      // any blur-driven list-hide/reset logic.
      btn.addEventListener('mousedown', (e) => {
        e.preventDefault();
        selectOption(opt);
      });
      list.appendChild(btn);
    }
  }

  input.addEventListener('focus', () => {
    renderList('');
    list.style.display = 'block';
  });
  input.addEventListener('input', () => {
    renderList(input.value);
    list.style.display = 'block';
  });
  input.addEventListener('blur', () => {
    // Deferred so a mousedown-driven selectOption() (above) runs first.
    setTimeout(() => {
      list.style.display = 'none';
      input.value = labelFor(selectedId);
    }, 0);
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      list.style.display = 'none';
      input.blur();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (currentMatches[0]) selectOption(currentMatches[0]);
    }
  });

  return {
    el: wrap,
    getValue: () => selectedId,
    setValue: (id) => {
      selectedId = id;
      input.value = labelFor(id);
    },
    onSelect: (cb) => {
      onSelectCb = cb;
    },
  };
}

/**
 * One "add a resource" row: raw-resource picker + miner tier +
 * impure/normal/pure counts + live rate preview + manual override + remove
 * button. Rate computation is delegated entirely to `capsFromInputs` (keyed
 * under a throwaway key) so this file never re-implements the miner rate
 * table; the same helper is reused, batched across rows, for aggregation in
 * `readRequest`.
 */
function makeResourceRow(resourceOptions, onRowChange) {
  const row = el('div', 'res-card');

  const topRow = el('div', 'res-card__row');
  const picker = createSearchSelect({ options: resourceOptions, placeholder: 'Resource…' });
  picker.el.style.flex = '1 1 9rem';
  const tierSelect = makeTierSelect(MINER_TIERS, 'Mk1');
  topRow.append(picker.el, tierSelect);
  row.appendChild(topRow);

  const nodesRow = el('div', 'res-card__nodes');
  const impureInput = numberInput({ value: 0, width: '100%' });
  const normalInput = numberInput({ value: 0, width: '100%' });
  const pureInput = numberInput({ value: 0, width: '100%' });
  nodesRow.append(fieldRow('Impure', impureInput), fieldRow('Normal', normalInput), fieldRow('Pure', pureInput));
  row.appendChild(nodesRow);

  const footRow = el('div', 'res-card__row');
  const overrideInput = numberInput({ value: '', min: 0, step: 'any', placeholder: 'override /min', width: '7rem' });
  footRow.appendChild(fieldRow('Override', overrideInput));
  const rateSpan = el('span', 'res-card__rate');
  footRow.appendChild(rateSpan);
  const removeBtn = el('button');
  removeBtn.type = 'button';
  removeBtn.textContent = 'Remove';
  footRow.appendChild(removeBtn);
  row.appendChild(footRow);

  function config() {
    const cfg = {
      kind: 'miner',
      minerTier: tierSelect.value,
      impure: readCount(impureInput),
      normal: readCount(normalInput),
      pure: readCount(pureInput),
    };
    const override = readOverride(overrideInput);
    if (override !== null) cfg.override = override;
    return cfg;
  }

  function currentRate() {
    return capsFromInputs({ __row: config() }).get('__row') || 0;
  }

  function refresh() {
    rateSpan.textContent = `${currentRate()}/min`;
  }

  function handleChange() {
    refresh();
    onRowChange();
  }

  picker.onSelect(handleChange);
  tierSelect.addEventListener('change', handleChange);
  for (const input of [impureInput, normalInput, pureInput, overrideInput]) {
    input.addEventListener('input', handleChange);
  }

  refresh();

  return {
    el: row,
    getResourceId: () => picker.getValue(),
    currentRate,
    removeBtn,
    seed({ resourceId, minerTier, normal }) {
      if (resourceId) picker.setValue(resourceId);
      if (minerTier) tierSelect.value = minerTier;
      if (normal !== undefined) normalInput.value = String(normal);
      refresh();
    },
  };
}

/** One "add a target" row for Target-rates mode: item picker + rate + remove. */
function makeTargetRow(itemOptions, onRowChange) {
  const row = el('div');
  row.style.display = 'flex';
  row.style.gap = '0.4rem';
  row.style.alignItems = 'center';
  row.style.marginBottom = '0.4rem';

  const picker = createSearchSelect({ options: itemOptions, placeholder: 'Part…', showIcon: true });
  picker.el.style.flex = '1 1 9rem';
  row.appendChild(picker.el);

  const rateInput = numberInput({ value: '', min: 0, step: 'any', placeholder: 'rate /min', width: '6rem' });
  row.appendChild(rateInput);

  const removeBtn = el('button');
  removeBtn.type = 'button';
  removeBtn.textContent = 'Remove';
  row.appendChild(removeBtn);

  picker.onSelect(onRowChange);
  rateInput.addEventListener('input', onRowChange);

  return {
    el: row,
    getItemId: () => picker.getValue(),
    getRate: () => Math.max(0, Number(rateInput.value) || 0),
    removeBtn,
  };
}

/**
 * Build the sidebar input panel. Renders all controls into `sidebarEl` and
 * returns `{ readRequest, onChange }`:
 *  - `readRequest()` assembles exactly the request object `computePlan`
 *    expects: `{ mode, caps, enabledRecipeIds, shardBudget, beltTier,
 *    pipeTier, noWaste, targetItemId? , targets? }`.
 *  - `onChange(cb)` subscribes `cb` to fire on any control change; the
 *    caller (main.js) is responsible for debouncing.
 *
 * Seeds a sensible starting state (one Iron Ore node at Mk2/normal x2, and
 * Modular Frame pre-selected as the max-mode target) so the app shows a
 * real build on first load. Both are looked up by name so this degrades
 * gracefully (silently skipped, no throw) if the dataset ever lacks either
 * part.
 *
 * @param {import('../domain/model.js').Dataset} dataset
 * @param {HTMLElement} sidebarEl
 * @returns {{readRequest: () => object, onChange: (cb: () => void) => void}}
 */
export function buildInputs(dataset, sidebarEl) {
  const listeners = [];
  function emitChange() {
    for (const cb of listeners) cb();
  }

  const allItems = [...dataset.items.values()].map((it) => ({ id: it.id, name: it.name, slug: it.slug }));

  // Resource-row UI only models miner-tier extraction (impure/normal/pure
  // node counts), per this task's scope, so only solid (non-liquid) raw
  // resources are offered here; fluids (Water/Crude Oil/Nitrogen Gas) need
  // different extractor mechanics (capsFromInputs's 'oil'/'water'/'well'
  // kinds) that this control set does not expose. See task-5-report.md.
  const resourceOptions = [...dataset.rawResourceIds]
    .filter((id) => !dataset.items.get(id)?.liquid)
    .map((id) => ({ id, name: dataset.items.get(id)?.name ?? id }));

  sidebarEl.replaceChildren();

  // --- Resources ----------------------------------------------------------
  sidebarEl.appendChild(sectionHeading('Resources'));
  const resourceHint = el('p', 'hint');
  resourceHint.textContent = 'Solid ore resources only for now — fluid inputs (water, oil, …) are coming soon.';
  sidebarEl.appendChild(resourceHint);
  const resourceRowsEl = el('div');
  sidebarEl.appendChild(resourceRowsEl);

  let resourceRows = [];
  function addResourceRow(seed) {
    const row = makeResourceRow(resourceOptions, emitChange);
    row.removeBtn.addEventListener('click', () => {
      resourceRows = resourceRows.filter((r) => r !== row);
      row.el.remove();
      emitChange();
    });
    if (seed) row.seed(seed);
    resourceRows.push(row);
    resourceRowsEl.appendChild(row.el);
  }

  const addResourceBtn = el('button');
  addResourceBtn.type = 'button';
  addResourceBtn.textContent = '+ Add resource';
  addResourceBtn.style.marginBottom = '1rem';
  addResourceBtn.addEventListener('click', () => {
    addResourceRow(null);
    emitChange();
  });
  sidebarEl.appendChild(addResourceBtn);

  // --- Shards & logistics ---------------------------------------------------
  sidebarEl.appendChild(sectionHeading('Shards & logistics'));

  const shardInput = numberInput({ value: 0, min: 0, step: 1 });
  shardInput.addEventListener('input', emitChange);
  sidebarEl.appendChild(fieldRow('Shard budget', shardInput));

  const beltSelect = makeTierSelect(BELT_TIERS, 'Mk4');
  beltSelect.addEventListener('change', emitChange);
  sidebarEl.appendChild(fieldRow('Belt tier', beltSelect));

  const pipeSelect = makeTierSelect(PIPE_TIERS, 'Mk2');
  pipeSelect.addEventListener('change', emitChange);
  sidebarEl.appendChild(fieldRow('Pipe tier', pipeSelect));

  const noWasteInput = el('input');
  noWasteInput.type = 'checkbox';
  noWasteInput.addEventListener('change', emitChange);
  const noWasteLabel = el('label');
  noWasteLabel.style.display = 'flex';
  noWasteLabel.style.alignItems = 'center';
  noWasteLabel.style.gap = '0.4rem';
  noWasteLabel.style.marginBottom = '1rem';
  const noWasteSpan = el('span');
  noWasteSpan.textContent = 'No waste';
  noWasteLabel.append(noWasteInput, noWasteSpan);
  sidebarEl.appendChild(noWasteLabel);

  // --- Mode & target ----------------------------------------------------
  sidebarEl.appendChild(sectionHeading('Mode & target'));

  const modeSelect = el('select');
  for (const [value, label] of [
    ['max', 'Maximize one part'],
    ['targets', 'Target rates'],
  ]) {
    const opt = el('option');
    opt.value = value;
    opt.textContent = label;
    modeSelect.appendChild(opt);
  }
  modeSelect.value = 'max';
  sidebarEl.appendChild(fieldRow('Mode', modeSelect));

  const targetPicker = createSearchSelect({ options: allItems, placeholder: 'Target part…', showIcon: true });
  const maxSection = el('div');
  maxSection.appendChild(fieldRow('Target', targetPicker.el));
  sidebarEl.appendChild(maxSection);
  targetPicker.onSelect(emitChange);

  const targetsSection = el('div');
  targetsSection.style.display = 'none';
  const targetRowsEl = el('div');
  targetsSection.appendChild(targetRowsEl);

  let targetRows = [];
  function addTargetRow() {
    const row = makeTargetRow(allItems, emitChange);
    row.removeBtn.addEventListener('click', () => {
      targetRows = targetRows.filter((r) => r !== row);
      row.el.remove();
      emitChange();
    });
    targetRows.push(row);
    targetRowsEl.appendChild(row.el);
  }
  const addTargetBtn = el('button');
  addTargetBtn.type = 'button';
  addTargetBtn.textContent = '+ Add target';
  addTargetBtn.addEventListener('click', () => {
    addTargetRow();
    emitChange();
  });
  targetsSection.appendChild(addTargetBtn);
  sidebarEl.appendChild(targetsSection);

  modeSelect.addEventListener('change', () => {
    const isMax = modeSelect.value !== 'targets';
    maxSection.style.display = isMax ? '' : 'none';
    targetsSection.style.display = isMax ? 'none' : '';
    emitChange();
  });

  // --- Alt recipes (searchable, collapsible, default all-on) --------------
  const altRecipes = dataset.recipes.filter((r) => r.alternate).sort((a, b) => a.name.localeCompare(b.name));
  const altChecked = new Map(altRecipes.map((r) => [r.id, true]));

  const details = el('details');
  const summary = el('summary');
  function updateSummary() {
    const on = [...altChecked.values()].filter(Boolean).length;
    summary.textContent = `Alternate recipes (${on}/${altRecipes.length} enabled)`;
  }
  updateSummary();
  details.appendChild(summary);

  const altSearch = el('input');
  altSearch.type = 'search';
  altSearch.placeholder = 'Filter recipes…';
  altSearch.style.width = '100%';
  altSearch.style.boxSizing = 'border-box';
  altSearch.style.margin = '0.4rem 0';
  details.appendChild(altSearch);

  const altListEl = el('div');
  altListEl.style.maxHeight = '16rem';
  altListEl.style.overflowY = 'auto';
  details.appendChild(altListEl);

  const altRowEntries = altRecipes.map((r) => {
    const label = el('label');
    label.style.display = 'flex';
    label.style.alignItems = 'center';
    label.style.gap = '0.4rem';
    label.style.padding = '0.15rem 0';
    const cb = el('input');
    cb.type = 'checkbox';
    cb.checked = true;
    cb.addEventListener('change', () => {
      altChecked.set(r.id, cb.checked);
      updateSummary();
      emitChange();
    });
    const span = el('span');
    span.textContent = r.name;
    label.append(cb, span);
    altListEl.appendChild(label);
    return { name: r.name, rowEl: label };
  });

  altSearch.addEventListener('input', () => {
    const q = altSearch.value.trim().toLowerCase();
    for (const entry of altRowEntries) {
      entry.rowEl.style.display = !q || entry.name.toLowerCase().includes(q) ? '' : 'none';
    }
  });

  sidebarEl.appendChild(details);

  // --- Optimize button ------------------------------------------------------
  // main.js wires this button's click to an undebounced recompute via
  // getElementById('optimize-btn') (same pattern as the existing
  // #theme-toggle lookup); it is not part of the returned interface because
  // onChange/readRequest already cover the debounced live-update path.
  const optimizeBtn = el('button');
  optimizeBtn.id = 'optimize-btn';
  optimizeBtn.type = 'button';
  optimizeBtn.textContent = 'Optimize';
  optimizeBtn.style.marginTop = '0.5rem';
  sidebarEl.appendChild(optimizeBtn);

  // --- Seed a sensible default so the app shows a real build on load ------
  const ironOre = resourceOptions.find((o) => o.name === 'Iron Ore');
  addResourceRow(ironOre ? { resourceId: ironOre.id, minerTier: 'Mk2', normal: 2 } : null);

  const modularFrame = allItems.find((it) => it.name === 'Modular Frame');
  if (modularFrame) targetPicker.setValue(modularFrame.id);

  // --- readRequest ----------------------------------------------------------
  function readRequest() {
    const mode = modeSelect.value === 'targets' ? 'targets' : 'max';

    const caps = new Map();
    for (const row of resourceRows) {
      const id = row.getResourceId();
      if (!id) continue;
      caps.set(id, (caps.get(id) || 0) + row.currentRate());
    }

    const enabledRecipeIds = new Set();
    for (const r of dataset.recipes) {
      if (!r.alternate) enabledRecipeIds.add(r.id);
      else if (altChecked.get(r.id)) enabledRecipeIds.add(r.id);
    }

    const req = {
      mode,
      caps,
      enabledRecipeIds,
      shardBudget: readCount(shardInput),
      beltTier: beltSelect.value,
      pipeTier: pipeSelect.value,
      noWaste: noWasteInput.checked,
    };

    if (mode === 'max') {
      const id = targetPicker.getValue();
      if (id) req.targetItemId = id;
    } else {
      const targets = {};
      for (const row of targetRows) {
        const id = row.getItemId();
        if (!id) continue;
        targets[id] = (targets[id] || 0) + row.getRate();
      }
      req.targets = targets;
    }

    return req;
  }

  return {
    readRequest,
    onChange(cb) {
      listeners.push(cb);
    },
  };
}
