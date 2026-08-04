import { loadDataset } from './data/loader.js';
import { computePlan } from './ui/view-model.js';
import { renderResults } from './ui/render.js';
import { buildInputs } from './ui/inputs.js';
import { buildPower } from './ui/power.js';
import { buildCodex } from './ui/codex.js';
import { buildExpansion } from './ui/expansion.js';

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

// View tabs: the Factory optimizer, the standalone Power generation calculator,
// the Codex item/recipe reference, and the Expansion planner.
const VIEWS = {
  factory: { viewId: 'view-factory', tabId: 'tab-factory' },
  power: { viewId: 'view-power', tabId: 'tab-power' },
  codex: { viewId: 'view-codex', tabId: 'tab-codex' },
  expansion: { viewId: 'view-expansion', tabId: 'tab-expansion' },
};

function showView(active) {
  for (const [name, ids] of Object.entries(VIEWS)) {
    const isActive = name === active;
    const viewEl = document.getElementById(ids.viewId);
    if (viewEl) viewEl.hidden = !isActive;
    document.getElementById(ids.tabId)?.classList.toggle('is-active', isActive);
  }
}

for (const [name, ids] of Object.entries(VIEWS)) {
  document.getElementById(ids.tabId)?.addEventListener('click', () => showView(name));
}

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

function renderBootError(rootEl, text, onRetry) {
  rootEl.replaceChildren();
  const p = document.createElement('p');
  p.textContent = text;
  rootEl.appendChild(p);
  const retryBtn = document.createElement('button');
  retryBtn.type = 'button';
  retryBtn.textContent = 'Retry';
  retryBtn.addEventListener('click', onRetry);
  rootEl.appendChild(retryBtn);
}

/**
 * Build one of the secondary views (power, codex) so that a failure in it
 * cannot take the factory optimizer down with it — that view shows why it's
 * empty and boot continues.
 */
function buildSecondaryView(dataset, viewId, label, build) {
  const viewEl = document.getElementById(viewId);
  if (!viewEl) return;
  try {
    build(dataset, viewEl);
  } catch (err) {
    console.error(err);
    renderMessage(viewEl, `${label} couldn’t load: ${err?.message ?? String(err)}`);
  }
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
    renderBootError(resultsEl, `Failed to load dataset: ${err?.message ?? String(err)}`, start);
    return;
  }

  const { readRequest, onChange, enableAlternate } = buildInputs(dataset, sidebarEl);

  buildSecondaryView(dataset, 'view-power', 'Power generation', buildPower);
  buildSecondaryView(dataset, 'view-codex', 'Codex', buildCodex);
  buildSecondaryView(dataset, 'view-expansion', 'Expansion', buildExpansion);

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

/**
 * Run `boot`, catching anything it didn't handle itself. Without this a throw
 * during startup would leave the results pane stuck on "Loading…" next to a
 * sidebar whose changes recompute nothing — a silent dead app rather than a
 * visible error. Also the Retry handler, so a retry keeps the same net.
 */
function start() {
  boot().catch((err) => {
    console.error(err);
    const resultsEl = document.getElementById('results');
    if (resultsEl) renderBootError(resultsEl, `Couldn’t start the app: ${err?.message ?? String(err)}`, start);
  });
}

start();
