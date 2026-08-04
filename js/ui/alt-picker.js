/**
 * Collapsible, searchable list of alternate recipes with per-recipe checkboxes.
 * Shared by the Factory Optimizer sidebar and the Expansion view, which keep
 * independent sets — a recipe is either unlocked in your save or not, but each
 * view is allowed to explore a different hypothesis.
 *
 * Alternates are OFF by default: you have to unlock them in-game, so a fresh
 * plan should only assume the base recipes.
 */
import { iconUrl } from './icons.js';

function el(tag, className) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  return node;
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
  const enableAllBtn = el('button');
  enableAllBtn.type = 'button';
  enableAllBtn.textContent = 'Enable all';
  const disableAllBtn = el('button');
  disableAllBtn.type = 'button';
  disableAllBtn.textContent = 'Disable all';
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

  function setAll(value) {
    for (const e of entries) e.cb.checked = value;
    updateSummary();
    onChange();
  }
  enableAllBtn.addEventListener('click', () => setAll(true));
  disableAllBtn.addEventListener('click', () => setAll(false));

  search.addEventListener('input', () => {
    const q = search.value.trim().toLowerCase();
    for (const e of entries) {
      e.rowEl.style.display = !q || e.name.toLowerCase().includes(q) ? '' : 'none';
    }
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
    },
  };
}
