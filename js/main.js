import { loadDataset } from './data/loader.js';
import { computePlan } from './ui/view-model.js';
import { renderResults } from './ui/render.js';
import { buildInputs } from './ui/inputs.js';
import { buildPower } from './ui/power.js';

const THEME_KEY = 'theme';

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
}

function currentTheme() {
  return document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
}

function restoreTheme() {
  // localStorage can throw (e.g. SecurityError in sandboxed/private contexts
  // where storage is disabled); this runs at module top-level, so an
  // uncaught throw here would abort module evaluation and boot() would never
  // run, leaving a blank app. Fall back to the default theme (dark, already
  // set via <html data-theme="dark"> in index.html) on failure.
  let stored = null;
  try {
    stored = localStorage.getItem(THEME_KEY);
  } catch {
    stored = null;
  }
  if (stored === 'dark' || stored === 'light') applyTheme(stored);
}

function toggleTheme() {
  const next = currentTheme() === 'dark' ? 'light' : 'dark';
  applyTheme(next);
  try {
    localStorage.setItem(THEME_KEY, next);
  } catch {
    // Storage unavailable: ignore. The theme still applies for this
    // session, it just won't persist across reloads.
  }
}

restoreTheme();

document.getElementById('theme-toggle')?.addEventListener('click', toggleTheme);

// View tabs: Factory optimizer vs the standalone Power generation calculator.
function showView(view) {
  const isPower = view === 'power';
  const factory = document.getElementById('view-factory');
  const power = document.getElementById('view-power');
  if (factory) factory.hidden = isPower;
  if (power) power.hidden = !isPower;
  document.getElementById('tab-factory')?.classList.toggle('is-active', !isPower);
  document.getElementById('tab-power')?.classList.toggle('is-active', isPower);
}
document.getElementById('tab-factory')?.addEventListener('click', () => showView('factory'));
document.getElementById('tab-power')?.addEventListener('click', () => showView('power'));

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

  const { readRequest, onChange, enableAlternate } = buildInputs(dataset, sidebarEl);

  const powerEl = document.getElementById('view-power');
  if (powerEl) buildPower(dataset, powerEl);

  function recompute() {
    const req = readRequest();
    if (req.mode === 'targets') {
      if (!req.targets || Object.keys(req.targets).length === 0) {
        renderMessage(resultsEl, 'Add a resource and at least one target rate to compute a build.');
        return;
      }
    } else if (!req.targets || req.targets.length === 0) {
      renderMessage(resultsEl, 'Add a resource and at least one part to maximize.');
      return;
    }
    try {
      renderResults(resultsEl, computePlan(dataset, req), { onEnableAlternate: enableAlternate });
    } catch (err) {
      console.error(err);
      renderMessage(resultsEl, `Failed to compute plan: ${err?.message ?? String(err)}`);
    }
  }

  onChange(debounce(recompute, 150));

  recompute();
}

boot();
