/**
 * Searchable single-select combobox — a text input that filters a list of a few
 * hundred options, with the selected option's icon overlaid inside the input's
 * left edge.
 *
 * Shared by the Optimizer sidebar (js/ui/inputs.js) and the Expansion view
 * (js/ui/expansion.js): both need to pick from 175 items or 300+ recipes, where a
 * native <select> is unusable.
 *
 * The event sequencing is deliberate, not incidental. Selection fires on
 * `mousedown` with `preventDefault()` so the input never blurs first, and the blur
 * handler defers via setTimeout so a click-selection always wins the race against
 * the list-hide. Change it only with a reason.
 */
import { iconUrl } from './icons.js';

function el(tag, className) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  return node;
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
export function createSearchSelect({ options, placeholder = 'Search…', showIcon = false }) {
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
