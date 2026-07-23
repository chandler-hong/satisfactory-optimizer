import { loadDataset } from './data/loader.js';
import { computePlan } from './ui/view-model.js';
import { renderResults } from './ui/render.js';
import { buildInputs } from './ui/inputs.js';

const THEME_KEY = 'theme';

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
}

function currentTheme() {
  return document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
}

function restoreTheme() {
  const stored = localStorage.getItem(THEME_KEY);
  if (stored === 'dark' || stored === 'light') applyTheme(stored);
}

function toggleTheme() {
  const next = currentTheme() === 'dark' ? 'light' : 'dark';
  applyTheme(next);
  localStorage.setItem(THEME_KEY, next);
}

restoreTheme();

document.getElementById('theme-toggle')?.addEventListener('click', toggleTheme);

console.log('boot');

/** Debounce: delay invoking `fn` until `wait` ms after the last call. */
function debounce(fn, wait) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), wait);
  };
}

function renderMessage(rootEl, text) {
  rootEl.replaceChildren();
  const p = document.createElement('p');
  p.textContent = text;
  rootEl.appendChild(p);
}

function renderLoadError(rootEl, err, onRetry) {
  rootEl.replaceChildren();
  const p = document.createElement('p');
  p.textContent = `Failed to load dataset: ${err?.message ?? String(err)}`;
  rootEl.appendChild(p);
  const retryBtn = document.createElement('button');
  retryBtn.type = 'button';
  retryBtn.textContent = 'Retry';
  retryBtn.addEventListener('click', onRetry);
  rootEl.appendChild(retryBtn);
}

/**
 * Boot the real app: load the dataset (showing loading/error states), build
 * the sidebar input panel, and wire live recompute. Re-entrant: on a failed
 * load, the Retry button calls `boot()` again from scratch; `buildInputs`
 * is never called on the failure path, so there are no stale listeners to
 * clean up on retry.
 */
async function boot() {
  const resultsEl = document.getElementById('results');
  const sidebarEl = document.getElementById('inputs');
  if (!resultsEl || !sidebarEl) return;

  resultsEl.textContent = 'Loading…';

  let dataset;
  try {
    dataset = await loadDataset();
  } catch (err) {
    console.error(err);
    renderLoadError(resultsEl, err, () => boot());
    return;
  }

  const { readRequest, onChange } = buildInputs(dataset, sidebarEl);

  function recompute() {
    const req = readRequest();
    if (req.mode === 'targets') {
      if (!req.targets || Object.keys(req.targets).length === 0) {
        renderMessage(resultsEl, 'Add at least one target rate to compute a build.');
        return;
      }
    } else if (!req.targetItemId) {
      renderMessage(resultsEl, 'Select a target part to compute a build.');
      return;
    }
    try {
      renderResults(resultsEl, computePlan(dataset, req));
    } catch (err) {
      console.error(err);
      renderMessage(resultsEl, `Failed to compute plan: ${err?.message ?? String(err)}`);
    }
  }

  onChange(debounce(recompute, 150));
  document.getElementById('optimize-btn')?.addEventListener('click', recompute);

  recompute();
}

boot();
