/**
 * Collapsible, searchable list of alternate recipes with per-recipe checkboxes.
 * Shared by the Factory Optimizer sidebar and the Expansion view, which keep
 * independent sets — a recipe is either unlocked in your save or not, but each
 * view is allowed to explore a different hypothesis.
 *
 * Alternates are OFF by default: you have to unlock them in-game, so a fresh
 * plan should only assume the base recipes.
 *
 * Enable all / Disable all are scoped to the search filter, and say so in their
 * own labels — see bulkLabel.
 */
import { iconUrl } from './icons.js';

function el(tag, className) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  return node;
}

/**
 * The rows a query is showing, in list order — the single source of truth for
 * "what is the user actually looking at". Both the row-hiding in the search
 * handler and the scope of the bulk buttons go through this, so the buttons
 * cannot act on rows the filter has hidden.
 *
 * Exported for tests: createAltPicker needs a DOM and the suite has no shim
 * (see README), so the decisions it gets wrong are pulled out here.
 */
export function filterRows(rows, query) {
  const q = String(query ?? '').trim().toLowerCase();
  if (!q) return [...rows];
  return rows.filter((r) => r.name.toLowerCase().includes(q));
}

/**
 * Label for a bulk button. Bulk actions are scoped to the filter — "Disable
 * all" wiping 99 enabled recipes you can't see is destructive and invisible,
 * and with the picker now driving two views (Expansion starts with all 110
 * off, so bulk enable is a common first move there) getting it wrong is easy
 * to do and hard to notice. So the label states the scope: plain "Enable all"
 * only when the list really is the whole list.
 */
export function bulkLabel(verb, shown, total) {
  return shown === total ? `${verb} all` : `${verb} ${shown} shown`;
}

export function createAltPicker({ dataset, onChange, warningText }) {
  const altRecipes = dataset.recipes.filter((r) => r.alternate).sort((a, b) => a.name.localeCompare(b.name));

  const details = el('details');
  const summary = el('summary');
  function updateSummary() {
    const on = entries.filter((e) => e.cb.checked).length;
    summary.textContent = `Alternate recipes (${on}/${altRecipes.length} enabled)`;
  }
  details.appendChild(summary);

  const search = el('input');
  search.type = 'search';
  search.placeholder = 'Filter recipes…';
  search.style.width = '100%';
  search.style.boxSizing = 'border-box';
  search.style.margin = '0.4rem 0';
  details.appendChild(search);

  const bulkRow = el('div');
  bulkRow.style.display = 'flex';
  bulkRow.style.gap = '0.4rem';
  bulkRow.style.margin = '0 0 0.5rem';
  // Labels are owned by updateBulkScope below (they track the filter), so none
  // are set here — two places writing them is how they'd drift apart.
  const enableAllBtn = el('button');
  enableAllBtn.type = 'button';
  const disableAllBtn = el('button');
  disableAllBtn.type = 'button';
  bulkRow.append(enableAllBtn, disableAllBtn);
  details.appendChild(bulkRow);

  const listEl = el('div');
  listEl.style.maxHeight = '16rem';
  listEl.style.overflowY = 'auto';
  details.appendChild(listEl);

  const entries = altRecipes.map((r) => {
    // Layout lives in the .alt-row CSS class (not inline) so the filter can
    // toggle style.display between 'none' and '' and have '' fall back to the
    // class's `display: flex` — setting inline flex here would revert to the
    // <label> default `inline` on show, collapsing rows onto shared lines.
    const label = el('label', 'alt-row');
    const cb = el('input');
    cb.type = 'checkbox';
    cb.checked = false;
    cb.addEventListener('change', () => { updateSummary(); onChange(); });
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
    listEl.appendChild(label);
    return { id: r.id, name: r.name, rowEl: label, cb };
  });
  updateSummary();

  // Both bulk buttons act on the filtered list, never the hidden remainder.
  function setAll(value) {
    const shown = filterRows(entries, search.value);
    if (shown.length === 0) return;
    for (const e of shown) e.cb.checked = value;
    updateSummary();
    onChange();
  }
  function updateBulkScope() {
    const shown = filterRows(entries, search.value).length;
    enableAllBtn.textContent = bulkLabel('Enable', shown, entries.length);
    disableAllBtn.textContent = bulkLabel('Disable', shown, entries.length);
    // A filter that matches nothing leaves the buttons with nothing to do, and
    // a button that silently no-ops reads as broken.
    enableAllBtn.disabled = shown === 0;
    disableAllBtn.disabled = shown === 0;
  }
  updateBulkScope();
  enableAllBtn.addEventListener('click', () => setAll(true));
  disableAllBtn.addEventListener('click', () => setAll(false));

  search.addEventListener('input', () => {
    const shown = new Set(filterRows(entries, search.value));
    for (const e of entries) e.rowEl.style.display = shown.has(e) ? '' : 'none';
    updateBulkScope();
  });

  const warningEl = el('p', 'alt-warning');
  warningEl.textContent = warningText;

  return {
    el: details,
    warningEl,
    getEnabledIds: () => new Set(entries.filter((e) => e.cb.checked).map((e) => e.id)),
    setEnabled(ids) {
      const on = new Set(ids || []);
      for (const e of entries) e.cb.checked = on.has(e.id);
      updateSummary();
    },
    enableOne(recipeId) {
      const entry = entries.find((e) => e.id === recipeId);
      if (!entry) return false;
      entry.cb.checked = true;
      updateSummary();
      onChange();
      return true;
    },
    reset() {
      for (const e of entries) { e.cb.checked = false; e.rowEl.style.display = ''; }
      search.value = '';
      updateSummary();
      updateBulkScope();   // the cleared search widens the bulk buttons back to "all"
    },
  };
}
