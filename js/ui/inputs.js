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

  // When showIcon, the currently-selected item's icon sits inside the input's
  // left edge (a plain text <input> can't hold an <img>, so it's overlaid and
  // the input gets matching left padding). Created lazily on first icon.
  let prefixImg = null;
  function updatePrefix(id) {
    if (!showIcon) return;
    const url = id ? iconUrl(byId.get(id)?.slug) : null;
    if (url) {
      if (!prefixImg) {
        prefixImg = el('img', 'search-prefix');
        prefixImg.alt = '';
        prefixImg.addEventListener('error', () => {
          prefixImg.style.display = 'none';
          input.style.paddingLeft = '';
        });
        wrap.appendChild(prefixImg);
      }
      prefixImg.src = url;
      prefixImg.style.display = '';
      input.style.paddingLeft = '2rem';
    } else if (prefixImg) {
      prefixImg.style.display = 'none';
      input.style.paddingLeft = '';
    }
  }

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
    updatePrefix(opt.id);
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
      updatePrefix(id);
    },
    onSelect: (cb) => {
      onSelectCb = cb;
    },
  };
}

/**
 * One "add a resource" row: raw-resource picker + miner tier +
 * impure/normal/pure counts + live rate preview + overclock slider + remove
 * button. Rate computation is delegated entirely to `capsFromInputs` (keyed
 * under a throwaway key) so this file never re-implements the miner rate
 * table; the same helper is reused, batched across rows, for aggregation in
 * `readRequest`.
 */
function makeResourceRow(resourceOptions, onRowChange) {
  const kindById = new Map(resourceOptions.map((o) => [o.id, o.kind || 'miner']));

  const row = el('div', 'res-card');

  const topRow = el('div', 'res-card__row');
  const picker = createSearchSelect({ options: resourceOptions, placeholder: 'Resource…', showIcon: true });
  picker.el.style.flex = '1 1 9rem';
  topRow.appendChild(picker.el);
  const tierSelect = makeTierSelect(MINER_TIERS, 'Mk1'); // appended to topRow only for solids
  row.appendChild(topRow);

  const nodesRow = el('div', 'res-card__nodes');
  row.appendChild(nodesRow);

  // Overclock (100%–250%) scales the whole row's extraction rate, matching
  // in-game overclocking. The slider free-slides but is magnetically pulled to
  // the 50% marks; the number box sets an exact value. `pct` is the single
  // source of truth both controls reflect (clockValue() reads it).
  let pct = 100;
  const OC_MARKS = [100, 150, 200, 250];
  const OC_SNAP = 6; // ± window (in %) where the slider snaps onto a mark
  const clampPct = (p) => Math.min(250, Math.max(100, p));
  const round2 = (x) => Math.round(x * 100) / 100;

  const ocRow = el('div', 'res-card__oc');
  const ocLabel = el('span', 'res-card__oc-label');
  ocLabel.textContent = 'Overclock';
  const ocInput = el('input', 'res-card__oc-input');
  ocInput.type = 'number';
  ocInput.min = '100';
  ocInput.max = '250';
  ocInput.step = '1'; // overclock % is always a whole number
  ocInput.value = '100';
  const ocPct = el('span', 'res-card__oc-pct');
  ocPct.textContent = '%';
  ocRow.append(ocLabel, ocInput, ocPct);
  row.appendChild(ocRow);

  const ocSlider = el('input', 'res-card__oc-slider');
  ocSlider.type = 'range';
  ocSlider.min = '100';
  ocSlider.max = '250';
  ocSlider.step = 'any'; // free slide; magnetic snap handled in the input event
  ocSlider.value = '100';
  row.appendChild(ocSlider);

  const footRow = el('div', 'res-card__row');
  const rateSpan = el('span', 'res-card__rate');
  footRow.appendChild(rateSpan);
  const removeBtn = el('button');
  removeBtn.type = 'button';
  removeBtn.textContent = 'Remove';
  removeBtn.style.marginLeft = 'auto';
  footRow.appendChild(removeBtn);
  row.appendChild(footRow);

  // Extraction inputs are rebuilt whenever the selected resource's kind
  // changes. `inputs` holds the live refs for the current kind.
  let kind = 'miner';
  let inputs = {};

  function buildExtraction(k) {
    kind = k;
    nodesRow.replaceChildren();
    tierSelect.remove();
    if (k === 'water') {
      const count = numberInput({ value: 0, width: '100%' });
      inputs = { count };
      nodesRow.appendChild(fieldRow('Extractors', count));
    } else {
      if (k === 'miner') topRow.appendChild(tierSelect);
      const impure = numberInput({ value: 0, width: '100%' });
      const normal = numberInput({ value: 0, width: '100%' });
      const pure = numberInput({ value: 0, width: '100%' });
      inputs = { impure, normal, pure };
      const suffix = k === 'well' ? ' sat.' : '';
      nodesRow.append(
        fieldRow('Impure' + suffix, impure),
        fieldRow('Normal' + suffix, normal),
        fieldRow('Pure' + suffix, pure),
      );
    }
    for (const inp of Object.values(inputs)) inp.addEventListener('input', handleChange);
  }

  function clockValue() {
    return pct / 100;
  }

  function config() {
    const clock = clockValue();
    if (kind === 'water') return { kind: 'water', count: readCount(inputs.count), clock };
    if (kind === 'oil') {
      return { kind: 'oil', impure: readCount(inputs.impure), normal: readCount(inputs.normal), pure: readCount(inputs.pure), clock };
    }
    if (kind === 'well') {
      return { kind: 'well', satellites: { impure: readCount(inputs.impure), normal: readCount(inputs.normal), pure: readCount(inputs.pure) }, clock };
    }
    return { kind: 'miner', minerTier: tierSelect.value, impure: readCount(inputs.impure), normal: readCount(inputs.normal), pure: readCount(inputs.pure), clock };
  }

  function currentRate() {
    return capsFromInputs({ __row: config() }).get('__row') || 0;
  }

  function refresh() {
    // Rate readout: at most 2 decimals, trailing zeros dropped.
    rateSpan.textContent = `${round2(currentRate())}/min`;
  }

  function handleChange() {
    refresh();
    onRowChange();
  }

  picker.onSelect((id) => {
    buildExtraction(kindById.get(id) || 'miner');
    handleChange();
  });
  tierSelect.addEventListener('change', handleChange);

  // Set pct from any source, sync both controls, recompute.
  function setPct(p) {
    pct = Math.round(clampPct(p)); // whole-number percent
    ocInput.value = String(pct);
    ocSlider.value = String(pct);
    handleChange();
  }
  ocSlider.addEventListener('input', () => {
    const raw = Number(ocSlider.value);
    const mark = OC_MARKS.find((m) => Math.abs(raw - m) <= OC_SNAP);
    setPct(mark ?? raw); // magnetic pull onto a 50% mark when close
  });
  ocInput.addEventListener('input', () => {
    // While typing, apply valid values but don't rewrite the box (keeps caret);
    // 'change' (blur/Enter) normalizes it.
    const v = Number(ocInput.value);
    if (ocInput.value.trim() === '' || !Number.isFinite(v)) return;
    pct = Math.round(clampPct(v));
    ocSlider.value = String(pct);
    handleChange();
  });
  ocInput.addEventListener('change', () => {
    const v = Number(ocInput.value);
    setPct(Number.isFinite(v) ? v : 100);
  });

  buildExtraction('miner');
  refresh();

  return {
    el: row,
    getResourceId: () => picker.getValue(),
    currentRate,
    removeBtn,
    seed({ resourceId, minerTier, normal }) {
      if (resourceId) {
        picker.setValue(resourceId);
        buildExtraction(kindById.get(resourceId) || 'miner');
      }
      if (minerTier && kind === 'miner') tierSelect.value = minerTier;
      if (normal !== undefined && inputs.normal) inputs.normal.value = String(normal);
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

/** One "maximize" target row: item picker + weight (parts per set) + remove. */
function makeMaxTargetRow(itemOptions, onRowChange) {
  const row = el('div', 'target-row');
  const picker = createSearchSelect({ options: itemOptions, placeholder: 'Part…', showIcon: true });
  picker.el.style.flex = '1 1 9rem';
  row.appendChild(picker.el);
  const weightInput = numberInput({ value: 1, min: 0, step: 'any', width: '4rem' });
  weightInput.title = 'Weight — parts per set (equal = balanced)';
  row.appendChild(weightInput);
  const removeBtn = el('button');
  removeBtn.type = 'button';
  removeBtn.textContent = 'Remove';
  row.appendChild(removeBtn);
  picker.onSelect(onRowChange);
  weightInput.addEventListener('input', onRowChange);
  return {
    el: row,
    removeBtn,
    getItemId: () => picker.getValue(),
    getWeight: () => {
      const w = Number(weightInput.value);
      return Number.isFinite(w) && w > 0 ? w : 1;
    },
    setItem: (id) => picker.setValue(id),
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
 * Starts empty (no resource or target rows); a "Reset" button at the top
 * clears every control back to this initial state.
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

  // Every raw resource is offered; each row adapts its extraction inputs to
  // the resource's kind — solid ore (miner tier + purity), water (extractor
  // count), crude oil (oil-extractor purity), or gas (resource-well
  // satellites). capsFromInputs handles all four kinds.
  const FLUID_KIND = { Desc_Water_C: 'water', Desc_LiquidOil_C: 'oil', Desc_NitrogenGas_C: 'well' };
  const resourceOptions = [...dataset.rawResourceIds].map((id) => {
    const it = dataset.items.get(id);
    const kind = !it?.liquid ? 'miner' : FLUID_KIND[id] || 'water';
    return { id, name: it?.name ?? id, slug: it?.slug, kind };
  });

  sidebarEl.replaceChildren();

  // --- Reset (clears everything back to the empty initial state) ----------
  const resetRow = el('div');
  resetRow.style.display = 'flex';
  resetRow.style.justifyContent = 'flex-start';
  resetRow.style.marginBottom = '0.75rem';
  const resetBtn = el('button', 'reset-btn');
  resetBtn.type = 'button';
  resetBtn.textContent = 'Reset';
  resetRow.appendChild(resetBtn);
  sidebarEl.appendChild(resetRow);

  // --- Resources ----------------------------------------------------------
  sidebarEl.appendChild(sectionHeading('Resources'));
  const resourceHint = el('p', 'hint');
  resourceHint.textContent = 'Add ore, water, oil, or gas — each row adapts to how the resource is extracted.';
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
    ['max', 'Maximize'],
    ['targets', 'Target rates'],
  ]) {
    const opt = el('option');
    opt.value = value;
    opt.textContent = label;
    modeSelect.appendChild(opt);
  }
  modeSelect.value = 'max';
  sidebarEl.appendChild(fieldRow('Mode', modeSelect));

  // Maximize mode: one or more target parts as balanced (optionally weighted) sets.
  const maxSection = el('div');
  const maxHint = el('p', 'hint');
  maxHint.textContent = 'Maximize matched "sets". Equal weights → equal amounts; raise one weight to make more of it per set.';
  maxSection.appendChild(maxHint);
  const maxRowsEl = el('div');
  maxSection.appendChild(maxRowsEl);
  let maxRows = [];
  function addMaxRow(seedItemId) {
    const row = makeMaxTargetRow(allItems, emitChange);
    row.removeBtn.addEventListener('click', () => {
      maxRows = maxRows.filter((r) => r !== row);
      row.el.remove();
      emitChange();
    });
    if (seedItemId) row.setItem(seedItemId);
    maxRows.push(row);
    maxRowsEl.appendChild(row.el);
  }
  const addMaxBtn = el('button');
  addMaxBtn.type = 'button';
  addMaxBtn.textContent = '+ Add part';
  addMaxBtn.addEventListener('click', () => {
    addMaxRow();
    emitChange();
  });
  maxSection.appendChild(addMaxBtn);
  sidebarEl.appendChild(maxSection);

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

  const altBulkRow = el('div');
  altBulkRow.style.display = 'flex';
  altBulkRow.style.gap = '0.4rem';
  altBulkRow.style.margin = '0 0 0.5rem';
  const enableAllBtn = el('button');
  enableAllBtn.type = 'button';
  enableAllBtn.textContent = 'Enable all';
  const disableAllBtn = el('button');
  disableAllBtn.type = 'button';
  disableAllBtn.textContent = 'Disable all';
  altBulkRow.append(enableAllBtn, disableAllBtn);
  details.appendChild(altBulkRow);

  const altListEl = el('div');
  altListEl.style.maxHeight = '16rem';
  altListEl.style.overflowY = 'auto';
  details.appendChild(altListEl);

  const altRowEntries = altRecipes.map((r) => {
    // Layout lives in the .alt-row CSS class (not inline) so the filter can
    // toggle style.display between 'none' and '' and have '' fall back to the
    // class's `display: flex` — setting inline flex here would revert to the
    // <label> default `inline` on show, collapsing rows onto shared lines.
    const label = el('label', 'alt-row');
    const cb = el('input');
    cb.type = 'checkbox';
    cb.checked = true;
    cb.addEventListener('change', () => {
      altChecked.set(r.id, cb.checked);
      updateSummary();
      emitChange();
    });
    label.appendChild(cb);
    // Icon of the recipe's primary output (dropped silently if it has none).
    const outSlug = dataset.items.get(r.outputs?.[0]?.itemId)?.slug;
    const url = iconUrl(outSlug);
    if (url) {
      const img = el('img', 'icon');
      img.loading = 'lazy';
      img.src = url;
      img.alt = '';
      img.onerror = () => img.remove();
      label.appendChild(img);
    }
    const span = el('span');
    span.textContent = r.name;
    label.appendChild(span);
    altListEl.appendChild(label);
    return { id: r.id, name: r.name, rowEl: label, cb };
  });

  function setAllAlts(value) {
    for (const entry of altRowEntries) {
      entry.cb.checked = value;
      altChecked.set(entry.id, value);
    }
    updateSummary();
    emitChange();
  }
  enableAllBtn.addEventListener('click', () => setAllAlts(true));
  disableAllBtn.addEventListener('click', () => setAllAlts(false));

  altSearch.addEventListener('input', () => {
    const q = altSearch.value.trim().toLowerCase();
    for (const entry of altRowEntries) {
      entry.rowEl.style.display = !q || entry.name.toLowerCase().includes(q) ? '' : 'none';
    }
  });

  sidebarEl.appendChild(details);

  // No Optimize button — the build recomputes live (debounced) on every change.

  // --- Reset: clear every control back to the empty initial state ---------
  function reset() {
    for (const r of [...resourceRows]) r.el.remove();
    resourceRows = [];
    for (const r of [...maxRows]) r.el.remove();
    maxRows = [];
    for (const r of [...targetRows]) r.el.remove();
    targetRows = [];

    shardInput.value = '0';
    beltSelect.value = 'Mk4';
    pipeSelect.value = 'Mk2';
    noWasteInput.checked = false;

    modeSelect.value = 'max';
    maxSection.style.display = '';
    targetsSection.style.display = 'none';

    for (const entry of altRowEntries) {
      entry.cb.checked = true;
      entry.rowEl.style.display = '';
      altChecked.set(entry.id, true);
    }
    altSearch.value = '';
    updateSummary();

    emitChange();
  }
  resetBtn.addEventListener('click', reset);

  // Start empty — no resource or target rows are seeded.

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
      req.targets = maxRows
        .map((r) => ({ itemId: r.getItemId(), weight: r.getWeight() }))
        .filter((t) => t.itemId);
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
