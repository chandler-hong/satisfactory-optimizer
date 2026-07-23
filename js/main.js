import { loadDataset } from './data/loader.js';
import { computePlan } from './ui/view-model.js';
import { renderResults } from './ui/render.js';

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

/**
 * Demo plan: max Modular Frame output from a 480/min Iron Ore cap, base
 * (non-alternate) recipes only. Exercises the renderer against real
 * dataset names/slugs/icons until Task 5 wires up the real input panel.
 */
async function renderDemoPlan(dataset, resultsEl) {
  const modularFrame = [...dataset.items.values()].find((item) => item.name === 'Modular Frame');
  if (!modularFrame) throw new Error('Modular Frame item not found in dataset');

  const enabledRecipeIds = new Set(dataset.recipes.filter((r) => !r.alternate).map((r) => r.id));

  const req = {
    mode: 'max',
    caps: new Map([['Desc_OreIron_C', 480]]),
    enabledRecipeIds,
    targetItemId: modularFrame.id,
    shardBudget: 0,
    beltTier: 'Mk4',
    pipeTier: 'Mk2',
  };

  renderResults(resultsEl, computePlan(dataset, req));
}

async function boot() {
  const resultsEl = document.getElementById('results');
  if (!resultsEl) return;
  resultsEl.textContent = 'Loading…';
  try {
    const dataset = await loadDataset();
    await renderDemoPlan(dataset, resultsEl);
  } catch (err) {
    resultsEl.textContent = `Failed to load dataset: ${err?.message ?? String(err)}`;
    console.error(err);
  }
}

boot();
