# Expansion: Alternates Picker + Built/To-build Blocks — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop the Expansion view assuming every alternate recipe is unlocked, and let a block row mean "this already exists and is fed" so its feedstock is left out of the plan.

**Architecture:** Two independent changes sharing one state payload. The alternates picker is extracted from `js/ui/inputs.js` into a shared `js/ui/alt-picker.js` and mounted in both views with independent state. The Built/To-build split is one branch in `pinnedBalance` — `splitDemand` already routes positive balances to supply and negative ones to demand, so a block that emits no negatives drops out of the LP targets and the raw footer with no further change.

**Tech Stack:** Vanilla ES modules, no build step. Tests: `node --test` via `npm test`. No dependencies may be added.

**Spec:** `docs/superpowers/specs/2026-08-04-expansion-alternates-and-built-blocks-design.md`

## Global Constraints

- **Test command is `npm test`.** Never `node --test test/` — wrong glob, produces spurious failures.
- **`test/fixtures/mini-data.js` must not be modified.** Other tests assert its exact shape. Reading it is fine. `test/fixtures/iron-chain.js` must also be left alone in this plan — where a test needs a recipe the fixture lacks, build a throwaway dataset **inside the test file** using the pattern already established at `test/engine/expansion.test.js:23-29` (`{ ...ironChain, recipes: [...ironChain.recipes, extra] }`).
- **Read rates off `perMin`; never recompute one.** A normalized entry is `{ itemId, perMin, amount }` and the recipe carries `timeSec` (`js/data/normalize.js:54-58`) — `amount` and `timeSec` exist because the Codex displays per-craft figures. They are not the optimizer's units. Any rate arithmetic uses `perMin`.
- **Layering:** `js/engine/**` and `js/domain/**` are pure and must never import from `js/ui/**`. `js/ui/**` is the only DOM-touching layer.
- **No `innerHTML`/`outerHTML`/`insertAdjacentHTML`** with dataset-derived strings. Use `textContent`, or `img.src`/`img.alt` property assignment.
- **No new dependencies.** The repo is zero-dependency by design; `package.json` exists only for the test runner.
- **CSS custom properties available:** `--surface`, `--border`, `--ink`, `--ink-muted`, `--accent`, `--accent-ink`, `--good`, `--warning`, `--critical`. There is no `--text-dim`. Both themes define the same names (`css/styles.css:14-38`).
- **This plan runs on the branch `expansion-alternates-and-built-blocks`** (branched from `main` @ `33c342d`), unlike previous rounds which worked directly on `main` — six tasks is enough to want a clean rewind. Commit per task; do not push; do not merge.
- **Alternates are OFF by default** in both views.
- **A block row may be declared on any recipe**, including an alternate that is unchecked. `enabledRecipeIds` gates what the LP may *choose*, never what the user may *declare*.
- There is **no DOM shim** in the test suite. Tests cover pure exports only; DOM is verified by running the app with a throwaway `_probe.html` which must be deleted before committing.
- **Baseline is 206 tests passing, `fail 0`.** Every task states its expected count.

### Deviation from the spec, recorded

Spec §8.11 asks for `test/ui/alt-picker.test.js` covering "whatever of the widget is pure". After writing Task 1, there is nothing pure to test: the sort, the filter and the id set all live inside the DOM builder, and the repo has no DOM shim. Rather than invent an exported helper purely to have something to assert, Task 1's evidence is the DOM-identity check in its Step 6, which is stronger — it proves the whole widget renders byte-identically to the shipped version. No `test/ui/alt-picker.test.js` is created.

---

### Task 1: Extract the alternates picker into `js/ui/alt-picker.js`

Pure refactor — **zero behaviour change**. The Optimizer's rendered DOM must be byte-identical before and after.

**Files:**
- Create: `js/ui/alt-picker.js`
- Modify: `js/ui/inputs.js` — the picker block (`:517-611`), `reset()` (`:634-639`), serialize (`:659`), restore (`:677-682`), the enabled set (`:723-727`), `enableAlternate` (`:762-769`), and the import block (`:1-3`)

**Interfaces:**
- Consumes: `iconUrl(slug) -> string|null` from `js/ui/icons.js`.
- Produces: `createAltPicker({ dataset, onChange, warningText }) -> { el, warningEl, getEnabledIds, setEnabled, enableOne, reset }`
  - `el` — the `<details>` element
  - `warningEl` — the `<p class="alt-warning">`, returned **separately** so callers append two siblings exactly as `inputs.js` does today. Wrapping them in a container would change existing DOM structure and fail Step 6.
  - `getEnabledIds() -> Set<string>` of checked recipe ids
  - `setEnabled(ids: Iterable<string>) -> void` — replaces the set; **does not** fire `onChange` (the restore path recomputes once itself)
  - `enableOne(recipeId: string) -> boolean` — checks one, fires `onChange`, returns whether the id was found
  - `reset() -> void` — unchecks all, clears the filter box and row visibility; does **not** fire `onChange`

- [ ] **Step 1: Create the widget**

Create `js/ui/alt-picker.js`:

```js
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
```

Two intentional differences from the shipped code, neither observable in the DOM:

1. The parallel `altChecked` Map is dropped. The checkboxes are the single source of truth; the Map was always written in lockstep, so every read returns the same answer.
2. `updateSummary()` is first called after `entries` exists rather than before. The shipped version could call it early because it read the Map; the resulting summary text is identical (`Alternate recipes (0/110 enabled)`).

- [ ] **Step 2: Snapshot the pre-change Optimizer for comparison**

Before touching `inputs.js`, copy the current file aside **inside the repo** so its relative imports still resolve:

```bash
cd /Users/chong/Documents/GitHub/satisfactory-optimizer
git show HEAD:js/ui/inputs.js > js/ui/_inputs_pre.js
```

`js/ui/_inputs_pre.js` is temporary. It MUST be deleted in Step 7 and must never be committed.

- [ ] **Step 3: Rewrite the picker block in `inputs.js`**

Add to the import block at the top:

```js
import { createAltPicker } from './alt-picker.js';
```

Replace everything from `// --- Alt recipes (searchable, collapsible, default all-on) ---` through `sidebarEl.appendChild(details);` with:

```js
  // --- Alt recipes (searchable, collapsible; OFF by default) ---------------
  const altPicker = createAltPicker({
    dataset,
    onChange: emitChange,
    warningText: "⚠ Alternate recipes are disabled by default — expand below and enable the ones you've unlocked or want to use.",
  });
  sidebarEl.appendChild(altPicker.warningEl);
  sidebarEl.appendChild(altPicker.el);
```

The old comment's `default all-on` is gone — it contradicted both the code beneath it and its own next line.

- [ ] **Step 4: Update the five remaining consumers**

In `reset()`, replace the `altRowEntries` loop plus `altSearch.value = ''` plus `updateSummary()` with:

```js
    altPicker.reset();
```

In serialize, replace the `altEnabled:` line with:

```js
      altEnabled: [...altPicker.getEnabledIds()],
```

In restore, replace the `const on = new Set(s.altEnabled || [])` block and its loop and `updateSummary()` with:

```js
    altPicker.setEnabled(s.altEnabled || []);
```

In `readRequest`, replace the enabled-set loop. Note `getEnabledIds()` is **hoisted out of the loop** — calling it per recipe would build a fresh Set 825 times per recompute:

```js
    const enabledAlts = altPicker.getEnabledIds();
    const enabledRecipeIds = new Set();
    for (const r of dataset.recipes) {
      if (!r.alternate) enabledRecipeIds.add(r.id);
      else if (enabledAlts.has(r.id)) enabledRecipeIds.add(r.id);
    }
```

And replace `enableAlternate`:

```js
    // Tick an alternate recipe on (from a results-panel suggestion) and recompute.
    enableAlternate(recipeId) {
      altPicker.enableOne(recipeId);
    },
```

- [ ] **Step 5: Run the suite**

Run: `npm test`
Expected: **206 pass, fail 0** — unchanged. No test targets the picker, so this only proves nothing else broke.

- [ ] **Step 6: Prove the Optimizer's DOM is unchanged**

Create `_probe.html` in the repo root:

```html
<!doctype html>
<meta charset="utf-8">
<title>alt-picker extraction check</title>
<div id="log" style="font:12px monospace; white-space:pre-wrap"></div>
<div id="a" hidden></div><div id="b" hidden></div>
<script type="module">
  import { loadDataset } from './js/data/loader.js';
  import { buildInputs as after } from './js/ui/inputs.js';
  import { buildInputs as before } from './js/ui/_inputs_pre.js';
  const log = (m) => { document.getElementById('log').textContent += m + '\n'; };
  try {
    const dataset = await loadDataset();
    // Both calls restore from the same localStorage key, so they start identical.
    before(dataset, document.getElementById('a'));
    after(dataset, document.getElementById('b'));
    const x = document.getElementById('a').innerHTML;
    const y = document.getElementById('b').innerHTML;
    log('before: ' + x.length + ' chars');
    log('after : ' + y.length + ' chars');
    log(x === y ? 'IDENTICAL' : 'DIFFERENT');
    if (x !== y) {
      let i = 0; while (i < x.length && x[i] === y[i]) i++;
      log('first divergence at ' + i);
      log('before: …' + x.slice(Math.max(0, i - 80), i + 80));
      log('after : …' + y.slice(Math.max(0, i - 80), i + 80));
    }
  } catch (e) { log('THREW: ' + e.message); }
</script>
```

Run:

```bash
python3 -m http.server 8791 >/tmp/httpd.log 2>&1 &
sleep 2
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --disable-gpu \
  --virtual-time-budget=20000 --window-size=1200,1400 \
  --screenshot=/tmp/alt-extract.png 'http://localhost:8791/_probe.html'
```

Then read `/tmp/alt-extract.png`. Expected: `IDENTICAL`. If DIFFERENT, the printed divergence point names the node or attribute that drifted — fix it and re-run. **Do not proceed until it reports IDENTICAL.**

- [ ] **Step 7: Clean up**

```bash
rm -f _probe.html js/ui/_inputs_pre.js
pkill -f "http.server 8791"
git status --short
```

Expected: only `js/ui/alt-picker.js` (untracked) and `js/ui/inputs.js` (modified). If `_probe.html` or `_inputs_pre.js` appear, delete them before committing.

- [ ] **Step 8: Commit**

```bash
git add js/ui/alt-picker.js js/ui/inputs.js
git commit -m "refactor(ui): extract the alternates picker for reuse

Moved out of inputs.js into js/ui/alt-picker.js so the Expansion view can
mount its own instance rather than growing a second copy. Follows the
search-select.js precedent.

The parallel altChecked Map is gone — the checkboxes were always the real
state and the Map was written in lockstep, so reads are unchanged. Verified
by rendering the sidebar from both trees over the real dataset and comparing
innerHTML: identical. Also drops a stale comment claiming alternates default
to all-on, which contradicted the line directly beneath it."
```

---

### Task 2: Annotate every existing block row as To-build

Test-only and **inert** — `built` is ignored by the current engine, so this must not change a single assertion or result. It exists so that Task 3's semantic flip lands against tests that already say which behaviour they mean.

Every one of the 38 block rows in `test/engine/expansion.test.js` was written against today's netting behaviour, which becomes **To-build**. Annotating them preserves their intent exactly; without this, Task 3 would break ~20 tests at once and the temptation would be to weaken assertions.

**Files:**
- Modify: `test/engine/expansion.test.js` (38 sites)

**Interfaces:**
- Consumes: nothing.
- Produces: nothing. Purely preparatory.

- [ ] **Step 1: Confirm the site count before editing**

```bash
cd /Users/chong/Documents/GitHub/satisfactory-optimizer
grep -c "kind: 'block'" test/engine/expansion.test.js          # expect 38
grep -c "recipeId: '" test/engine/expansion.test.js            # expect 38
grep -n "recipeId: '" test/engine/expansion.test.js | grep -v "kind: 'block'"   # expect NO output
```

The third command proves every block row carries an explicit `kind: 'block'`, so a single substitution is exact and complete. If it prints anything, that row needs annotating by hand.

- [ ] **Step 2: Annotate**

```bash
sed -i '' "s/kind: 'block',/kind: 'block', built: false,/g" test/engine/expansion.test.js
grep -c "built: false" test/engine/expansion.test.js           # expect 38
```

Do **not** touch `test/ui/expansion.test.js`. Its 5 block rows are inputs to `sanitizeState`, whose *expected output* gains `built` — that belongs to Task 4.

- [ ] **Step 3: Verify the annotation is inert**

Run: `npm test`
Expected: **206 pass, fail 0** — the exact same count and the same passing tests as before Step 2. `built` is not read by any code yet, so any change here would mean the sed corrupted something.

Also confirm no assertion text changed:

```bash
git diff --stat test/engine/expansion.test.js     # expect 38 insertions, 38 deletions
git diff test/engine/expansion.test.js | grep '^[-+]' | grep -c "assert"   # expect 0
```

The second command proves no assertion line was touched. If it is non-zero, revert and redo.

- [ ] **Step 4: Commit**

```bash
git add test/engine/expansion.test.js
git commit -m "test(engine): say explicitly that existing block rows are to-build

Every block row in this file was written against the netting behaviour that
is about to become the To-build case, so each one now says so. Inert on its
own — nothing reads the flag yet — which is the point: it lands before the
semantic change so the next commit's diff shows only genuinely new behaviour
instead of twenty broken assertions.

38 sites, 38 insertions, 38 deletions, no assertion touched, same 206 passing."
```

---

### Task 3: `pinnedBalance` splits Built from To-build

**Files:**
- Modify: `js/engine/expansion.js:74-85` (`pinnedBalance`), `:356-374` (`blockView`, to carry the flag)
- Test: `test/engine/expansion.test.js`

**Interfaces:**
- Consumes: the `built: false` annotations from Task 2.
- Produces: `pinnedBalance(dataset, blockRows)` keeps its signature; a row with `built !== false` contributes **gross output only**, a row with `built === false` contributes its **net** balance. `blockView` entries (and therefore `plan.blockRows`) gain `built: boolean`. Tasks 4–6 rely on `built` being the flag name and `false` meaning To-build.

- [ ] **Step 1: Write the failing unit tests**

The file's helper is `const plan = (rows, extra = {}) => planExpansion({ dataset: ironChain, rows, enabledRecipeIds: ALL_IRON_RECIPES, ...extra })` at `:14-16`, and `rateOf(map, id)` is already in scope. `ironChain`'s chain is `ore → ingot → plate|rod → screw → rip → mf|rotor`, all `alternate: false`, entries shaped `{ itemId, perMin }`.

Append:

```js
// --- Built vs To-build blocks ------------------------------------------------

test('pinnedBalance: a Built block contributes its output and no demand', () => {
  // ingot: 30 ore -> 30 ingot per machine. Built means the ore already flows.
  const net = pinnedBalance(ironChain, [{ kind: 'block', recipeId: 'ingot', machines: 2, clock: 1, built: true }]);
  assert.equal(rateOf(net, 'ingot'), 60);
  assert.equal(net.has('ore'), false, 'the ore it eats is not the plan\'s problem');
  for (const [itemId, v] of net) assert.ok(v >= 0, `Built emits no demand, but ${itemId} is ${v}`);
});

test('pinnedBalance: an absent built flag means Built, not To-build', () => {
  const net = pinnedBalance(ironChain, [{ kind: 'block', recipeId: 'ingot', machines: 2, clock: 1 }]);
  assert.equal(net.has('ore'), false, 'a saved row with no flag reads as Built');
  assert.equal(rateOf(net, 'ingot'), 60);
});

test('pinnedBalance: Built uses gross output, not positive net', () => {
  // A recipe with the same item on both sides. The real dataset has three
  // (Encased Uranium Cell, Alternate: Instant Scrap, Alternate: Distilled
  // Silica); iron-chain.js has none and must not be modified, so this is a
  // throwaway dataset built here — same pattern as oreMakerDataset above.
  const loopDataset = {
    ...ironChain,
    recipes: [...ironChain.recipes, {
      id: 'loop', name: 'loop', buildingId: 'b', alternate: false,
      inputs: [{ itemId: 'ore', perMin: 10 }, { itemId: 'goo', perMin: 2 }],
      outputs: [{ itemId: 'goo', perMin: 5 }],
    }],
  };
  const net = pinnedBalance(loopDataset, [{ kind: 'block', recipeId: 'loop', machines: 1, clock: 1, built: true }]);
  // Gross output is 5/min. Net would be 5 - 2 = 3/min, which under-reports.
  assert.equal(rateOf(net, 'goo'), 5, 'the whole output rate is available, not output minus its own input');
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npm test`
Expected: all three FAIL. The first two because a Built block currently nets, so `ore` is present at `-60`; the third because it reports `3` instead of `5`.

- [ ] **Step 3: Implement the split**

In `js/engine/expansion.js`, replace the loop body in `pinnedBalance`:

```js
  for (const b of blockRows || []) {
    const resolved = blockLoad(byId, b);
    if (!resolved || resolved.load <= 0) continue;
    const { recipe, load } = resolved;
    for (const itemId of touched(recipe)) add(net, itemId, load * netPerMin(recipe, itemId));
  }
```

with:

```js
  for (const b of blockRows || []) {
    const resolved = blockLoad(byId, b);
    if (!resolved || resolved.load <= 0) continue;
    const { recipe, load } = resolved;
    if (b?.built === false) {
      // To build: net the two sides, so the feedstock comes out negative and
      // splitDemand turns it into an LP target.
      for (const itemId of touched(recipe)) add(net, itemId, load * netPerMin(recipe, itemId));
    } else {
      // Built: the machines exist and are already fed, so only what leaves them
      // enters the plan. Gross output, NOT max(0, net) — for a recipe with an
      // item on both sides the input side is covered externally by definition,
      // so the whole output rate is genuinely available and netting would
      // under-report it. Entries already carry per-minute rates (normalize.js).
      for (const o of recipe.outputs || []) add(net, o.itemId, load * o.perMin);
    }
  }
```

No new helper: `o.perMin` is the normalized rate. Do not reach for `netPerMin` here — that is the netting accessor and is what this branch exists to avoid.

- [ ] **Step 4: Run to verify they pass**

Run: `npm test`
Expected: **209 pass, fail 0**. Critically, the 38 rows annotated in Task 2 keep every existing assertion green — if any of them fails, the To-build branch is not faithfully preserving old behaviour.

- [ ] **Step 5: Thread the flag into `blockView`**

The "Your blocks" panel needs to show which kind each row is. `blockView` at `:356` builds its objects field by field and does not currently pass `built` through. Add it to the returned object:

```js
        built: b.built !== false,
```

- [ ] **Step 6: Write the end-to-end tests**

These are the actual payoff — they pin the behaviour that motivated the work. Append:

```js
test('planExpansion: a Built block feeds a want without planning its own upstream', () => {
  // Built ingot block + a want for plate, which ingots feed. The ingot recipe
  // must not be re-planned and its ore must not reach the footer.
  const p = plan([
    { kind: 'block', recipeId: 'ingot', machines: 2, clock: 1, built: true },
    { kind: 'want', itemId: 'plate', rate: 20 },
  ]);
  const built = p.buildRows.map((r) => r.recipeId);
  assert.equal(built.includes('ingot'), false, 'the Built block is not re-planned');
  assert.equal(p.rawNeeded.some((r) => r.itemId === 'ore'), false, 'and its ore is not in the footer');
  assert.ok(built.includes('plate'), 'but the want is planned');
});

test('planExpansion: the same block flipped to To-build brings its upstream back', () => {
  const p = plan([
    { kind: 'block', recipeId: 'ingot', machines: 2, clock: 1, built: false },
    { kind: 'want', itemId: 'plate', rate: 20 },
  ]);
  assert.ok(p.rawNeeded.some((r) => r.itemId === 'ore'), 'ore returns to the footer');
});

test('planExpansion: a Built line offsets what the LP has to build', () => {
  // 2 Built ingot machines put 60 ingot/min on the bus; the plate want needs
  // 30 ingot/min, so the LP should not have to build any ingot capacity.
  const withBuilt = plan([
    { kind: 'block', recipeId: 'ingot', machines: 2, clock: 1, built: true },
    { kind: 'want', itemId: 'plate', rate: 20 },
  ]);
  const withoutBuilt = plan([{ kind: 'want', itemId: 'plate', rate: 20 }]);
  const ingotMachines = (p) => p.buildRows.find((r) => r.recipeId === 'ingot')?.machines ?? 0;
  assert.ok(ingotMachines(withoutBuilt) > 0, 'sanity: without the Built line the LP builds ingots');
  assert.equal(ingotMachines(withBuilt), 0, 'with it, the LP builds none');
});

test('planExpansion: blockRows report which kind each block is', () => {
  const p = plan([
    { kind: 'block', recipeId: 'ingot', machines: 1, clock: 1, built: true },
    { kind: 'block', recipeId: 'rod', machines: 1, clock: 1, built: false },
  ]);
  assert.deepEqual(p.blockRows.map((r) => r.built), [true, false]);
});

// Added after Task 2's review: annotating all 38 existing rows To-build left the
// two behaviours below proven ONLY in To-build form, even though both also
// govern Built. Without these, the Built path inherits no guard for either.

// computeNetOutput's double-count guard: the upstream's consumption of a block's
// surplus is already a negative term in netFromLPRecipes, so subtracting the
// drawn supply as well would under-report. That has to hold for a Built block's
// gross output exactly as it does for a To-build block's net surplus.
test('computeNetOutput: the double-count guard holds for a Built block too', () => {
  const asBuilt = plan([
    { kind: 'block', built: false, recipeId: 'rip', machines: 2, clock: 1 },  // wants 120 screw
    { kind: 'block', built: true, recipeId: 'rod', machines: 10, clock: 1 },  // makes 150 rod
  ]);
  const asPlanned = plan([
    { kind: 'block', built: false, recipeId: 'rip', machines: 2, clock: 1 },
    { kind: 'block', built: false, recipeId: 'rod', machines: 10, clock: 1 },
  ]);
  // 150 rod made, 30 eaten by the screw machines feeding rip, so 120 leaves —
  // the same either way. What changes is whether the rod block's own ingot (and
  // the ore behind it) is the plan's problem.
  assert.equal(rateOf(asBuilt.netOutput, 'rod'), 120);
  assert.equal(rateOf(asPlanned.netOutput, 'rod'), 120, 'unchanged from the To-build case');
  assert.ok(rawFor(asBuilt, 'ore').needed < rawFor(asPlanned, 'ore').needed,
    'but the Built line stops driving ore for its own ingot');
});

// The Built branch multiplies by `load`, which comes from blockLoad — so it must
// go through the same normalizeClock the displayed clockPct uses. If the two ever
// diverge again, a garbage clock would display as 100% while the gross output was
// computed at something else.
test('planExpansion: an invalid clock on a Built block computes as it displays', () => {
  const invalid = plan([{ kind: 'block', built: true, recipeId: 'rip', machines: 2, clock: -0.5 }]);
  const normal = plan([{ kind: 'block', built: true, recipeId: 'rip', machines: 2, clock: 1 }]);
  assert.equal(invalid.blockRows[0].clockPct, 100, 'a negative clock must not display as -50%');
  assert.equal(rateOf(invalid.netOutput, 'rip'), rateOf(normal.netOutput, 'rip'),
    'and the gross-output rate must use that same normalized clock');
});
```

- [ ] **Step 7: Run them**

Run: `npm test`
Expected: **215 pass, fail 0**. If the third test's sanity assertion fails, the plate want isn't driving ingot construction in this fixture — raise the want rate until it does, so the comparison discriminates rather than comparing 0 to 0.

- [ ] **Step 8: Commit**

```bash
git add js/engine/expansion.js test/engine/expansion.test.js
git commit -m "feat(engine): a Built block contributes output only, not demand

A block row now means one of two things. Built (the default) says the
machines exist and are already fed, so only their gross output enters the
plan. To build keeps the old meaning and has its feedstock planned upstream.

Gross output rather than max(0, net): for a recipe with an item on both sides
the input side is covered externally by definition, so the whole output rate
is available and netting would under-report it.

splitDemand needed no change — it already routes positives to supply and
negatives to demand, so a block that emits no negatives drops out of the LP
targets and the raw footer on its own. blockRows carries the flag so the
panel can show which kind each row is."
```

---

### Task 4: Persist `built` and `alts`

**Files:**
- Modify: `js/ui/expansion.js` — `DEFAULT_STATE`, `sanitizeState`, `loadState`
- Test: `test/ui/expansion.test.js`

**Interfaces:**
- Consumes: the `built` convention from Task 3 (`false` means To-build; anything else means Built).
- Produces: `sanitizeState(raw, knownRecipeIds?)` — second parameter optional; when omitted, alternate-id filtering is skipped. Sanitized state gains `rows[].built` (boolean) and top-level `alts` (array of enabled alternate recipe ids). Task 5 reads `built`; Task 6 reads `alts` and passes `knownRecipeIds`.

- [ ] **Step 1: Write the failing tests**

Append to `test/ui/expansion.test.js`:

```js
test('sanitizeState: built defaults to true and only an exact false means to-build', () => {
  const s = sanitizeState({ rows: [
    { kind: 'block', recipeId: 'a', machines: 1, clock: 1 },
    { kind: 'block', recipeId: 'b', machines: 1, clock: 1, built: false },
    { kind: 'block', recipeId: 'c', machines: 1, clock: 1, built: true },
    { kind: 'block', recipeId: 'd', machines: 1, clock: 1, built: 'false' },
  ] });
  assert.deepEqual(s.rows.map((r) => r.built), [true, false, true, true],
    'absent, true and a non-boolean all mean Built; only false means To build');
});

test('sanitizeState: alts keeps known recipe id strings and nothing else', () => {
  const s = sanitizeState({ alts: ['ingot', 42, null, 'not-a-recipe', 'plate'] }, new Set(['ingot', 'plate']));
  assert.deepEqual(s.alts, ['ingot', 'plate'], 'non-strings and unknown ids are dropped');
});

test('sanitizeState: alts defaults to empty, so alternates start off', () => {
  assert.deepEqual(sanitizeState(null).alts, []);
  assert.deepEqual(sanitizeState({}).alts, []);
  assert.deepEqual(sanitizeState({ alts: 'nope' }).alts, []);
});

test('sanitizeState: without a known-id set, alt ids are kept as-is', () => {
  // The boot path passes the set; callers that don't care skip the filter.
  assert.deepEqual(sanitizeState({ alts: ['anything'] }).alts, ['anything']);
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npm test`
Expected: FAIL — `built` is undefined on every row and `alts` does not exist.

- [ ] **Step 3: Implement**

Add `alts: []` to `DEFAULT_STATE`:

```js
export const DEFAULT_STATE = { rows: [], goals: [], fillMinutes: DEFAULT_FILL_MINUTES, alts: [] };
```

Change the signature:

```js
export function sanitizeState(raw, knownRecipeIds) {
```

In the `r.kind === 'block'` branch, add `built` to the pushed row:

```js
      rows.push({
        kind: 'block',
        recipeId: r.recipeId,
        machines: clampTo(MAX_MACHINES, machines),
        clock: normalizeClock(r.clock),
        // Only an explicit false means To build. Absent (an older payload),
        // true, or a non-boolean from a hand-edited file all mean Built, which
        // is the default for a new row.
        built: r.built !== false,
      });
```

Before the `return`, sanitize `alts`, and add it to the returned object:

```js
  const alts = (Array.isArray(raw.alts) ? raw.alts : [])
    .filter((id) => typeof id === 'string')
    .filter((id) => !knownRecipeIds || knownRecipeIds.has(id));
```

Thread the id set through `loadState`:

```js
function loadState(knownRecipeIds) {
  try { return sanitizeState(JSON.parse(localStorage.getItem(STATE_KEY) || 'null'), knownRecipeIds); }
  catch { return { ...DEFAULT_STATE }; }
}
```

At its call site, pass `new Set(dataset.recipes.map((r) => r.id))`.

- [ ] **Step 4: Fix the one existing test this changes**

`sanitizeState: coerces numbers and drops non-numeric rates` asserts a whole row with `deepEqual`:

```js
  assert.deepEqual(s.rows[0], { kind: 'block', recipeId: 'r', machines: 6, clock: 1.5 });
```

That row now also carries `built`. Add the field to the **expected** object rather than weakening the assertion to a field-by-field check:

```js
  assert.deepEqual(s.rows[0], { kind: 'block', recipeId: 'r', machines: 6, clock: 1.5, built: true });
```

- [ ] **Step 5: Run to verify all pass**

Run: `npm test`
Expected: **225 pass, fail 0**.

- [ ] **Step 6: Commit**

```bash
git add js/ui/expansion.js test/ui/expansion.test.js
git commit -m "feat(ui): persist each block's built flag and the enabled alternates

built follows the rule that only an exact false means To build, so an older
saved payload with no flag reads as Built — the new default. That does change
what an existing saved plan means: its blocks stop planning their feedstock.

alts stores only the ENABLED ids, so the all-off default is the empty array
and a dataset bump that drops a recipe degrades to 'not enabled' rather than
throwing. Unknown ids are filtered on load, matching how goals already
behaves. STATE_KEY is deliberately not bumped: both additions degrade."
```

---

### Task 5: Built / To-build control in the Blocks rows

**Files:**
- Modify: `js/ui/expansion.js` — `makeBlockRow` and its `read()`, the Blocks section hint, the module doc comment at `:2`; `js/ui/expansion-render.js` — the "Your blocks" panel; `css/styles.css` — append only
- Test: none new. This is DOM and the suite has no shim; verified in the browser at Step 5.

**Interfaces:**
- Consumes: `built` from Tasks 3 and 4. `plan.blockRows[].built` exists as of Task 3 Step 5.
- Produces: nothing later tasks depend on.

- [ ] **Step 1: Add the radio pair to `makeBlockRow`**

Read `makeBlockRow` first. It builds `row`, a `picker`, and a `foot` containing `machinesLabel`, `machinesInput`, `clockLabel`, `clockInput`, `buildingLabel`, `removeBtn`, and returns `{ el, removeBtn, read }`.

Radios rather than a checkbox: the states are a symmetric either/or and both labels need to be readable. Add a module-scope counter beside the other module constants:

```js
let nextBlockRowId = 0;
```

Insert before the `foot.append(...)` call:

```js
  // Each row's radios need their own group name, or picking Built in one row
  // would clear it in every other row.
  const groupName = `exp-built-${nextBlockRowId++}`;
  const builtWrap = el('span', 'exp-built');
  const builtOn = initial?.built !== false;
  const builtRadio = el('input');
  builtRadio.type = 'radio';
  builtRadio.name = groupName;
  builtRadio.checked = builtOn;
  const builtOpt = el('label', 'exp-built__opt');
  builtOpt.append(builtRadio, document.createTextNode(' Built'));
  const planRadio = el('input');
  planRadio.type = 'radio';
  planRadio.name = groupName;
  planRadio.checked = !builtOn;
  const planOpt = el('label', 'exp-built__opt');
  planOpt.append(planRadio, document.createTextNode(' To build'));
  builtWrap.append(builtOpt, planOpt);
  builtRadio.addEventListener('change', onChange);
  planRadio.addEventListener('change', onChange);
```

Add `builtWrap` to `foot.append(...)` **before** `removeBtn`, so Remove keeps its `marginLeft: auto` position at the end of the row.

Add to the returned `read()`:

```js
      built: builtRadio.checked,
```

- [ ] **Step 2: Reword the two pieces of stale copy**

The Blocks section hint currently reads `"Machines you've decided to build, e.g. 6× Assembler making Motors."`. Replace with:

```js
    'Machine blocks in your plan. Built ones are assumed already fed, so only what they make counts. To-build ones get their feedstock planned too.',
```

And `js/ui/expansion.js:2` begins "Expansion view: declare the machine blocks you've decided to build and whatever is already on your bus". Change "you've decided to build" to "you have or plan to build" — the default is Built now.

- [ ] **Step 3: Show the kind in the "Your blocks" panel**

In `js/ui/expansion-render.js`, find `renderYourBlocksPanel` and read how it builds rows and which column spec it uses. Add a cell for the kind, reusing the chip classes the "capped" badge already uses (`.chip` at `css/styles.css:340`, `.chip--warning` at `:362`) so it matches the rest of the UI:

```js
// Built vs To build, so the panel doesn't read as one undifferentiated list —
// only the To-build rows have had their feedstock planned.
const kind = el('span', row.built ? 'chip' : 'chip chip--warning');
kind.textContent = row.built ? 'Built' : 'To build';
```

If the panel uses the shared `buildTable`/`BUILD_COLUMNS` spec from `js/ui/report-panels.js`, add the column to the Your-blocks spec only — do not change the shared build-table spec, which the Optimizer also renders.

- [ ] **Step 4: Style the control**

Append to `css/styles.css`. Use `--ink-muted`; there is no `--text-dim`:

```css
.exp-built {
  display: inline-flex;
  gap: 0.6rem;
  align-items: center;
}

.exp-built__opt {
  display: inline-flex;
  gap: 0.2rem;
  align-items: center;
  font-size: 0.8rem;
  color: var(--ink-muted);
  cursor: pointer;
}
```

- [ ] **Step 5: Verify in the browser**

```bash
python3 -m http.server 8791 >/tmp/httpd.log 2>&1 &
sleep 2
```

Create `_probe.html` in the repo root:

```html
<!doctype html>
<meta charset="utf-8">
<div id="log" style="font:12px monospace; white-space:pre-wrap; background:#111; color:#0f0; padding:6px"></div>
<iframe id="f" style="width:1480px; height:2000px; border:0"></iframe>
<script>
  const log = (m) => { document.getElementById('log').textContent += m + '\n'; };
  localStorage.setItem('sat-optimizer:expansion:v1', JSON.stringify({
    rows: [
      { kind: 'block', recipeId: 'Recipe_IngotIron_C', machines: 4, clock: 1, built: true },
      { kind: 'block', recipeId: 'Recipe_IronPlate_C', machines: 2, clock: 1, built: false },
    ],
    goals: [], fillMinutes: 10, alts: [],
  }));
  const f = document.getElementById('f');
  f.onload = () => {
    const d = f.contentDocument;
    f.contentWindow.console.error = (...a) => log('!! CONSOLE.ERROR: ' + a.map(String).join(' ').slice(0, 200));
    f.contentWindow.addEventListener('error', (e) => log('!! WINDOW ERROR: ' + e.message));
    setTimeout(() => {
      d.getElementById('tab-expansion').click();
      setTimeout(() => {
        const v = d.getElementById('view-expansion');
        const radios = [...v.querySelectorAll('input[type=radio]')];
        log('radios: ' + radios.length + ' (expect 4)');
        log('distinct group names: ' + new Set(radios.map((r) => r.name)).size + ' (expect 2)');
        log('chips: ' + [...v.querySelectorAll('.chip')].map((c) => c.textContent).join(' | '));
        log('mentions Iron Ore: ' + v.textContent.includes('Iron Ore'));
        log('DONE');
      }, 3000);
    }, 2500);
  };
  f.src = '/';
</script>
```

```bash
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --disable-gpu \
  --virtual-time-budget=20000 --window-size=1500,2400 \
  --screenshot=/tmp/built-rows.png 'http://localhost:8791/_probe.html'
```

Read `/tmp/built-rows.png`. Expected: 4 radios across **2 distinct group names** — one name would mean picking Built in row 2 clears row 1; a `Built` chip and a `To build` chip; no console or window errors. `Iron Ore` should be present, because the To-build plate block's upstream still needs ore.

Then in a real browser, flip the ingot row to "To build" and confirm the raw footer's ore figure rises.

- [ ] **Step 6: Clean up**

```bash
rm -f _probe.html
pkill -f "http.server 8791"
git status --short      # expect no untracked files
```

- [ ] **Step 7: Run the suite and commit**

Run: `npm test` — expected **226 pass, fail 0**, unchanged from Task 4.

```bash
git add js/ui/expansion.js js/ui/expansion-render.js css/styles.css
git commit -m "feat(ui): mark each block Built or To build

Radios rather than a checkbox, because the two states are a symmetric
either/or and both labels have to be readable. Each row gets its own radio
group name — a shared name would make picking Built in one row clear it in
every other.

The Blocks hint and the module's own doc comment both said 'machines you've
decided to build', which is wrong now that Built is the default, and the
'Your blocks' panel marks which kind each row is so it doesn't read as one
undifferentiated list."
```

---

### Task 6: Mount the alternates picker in Expansion

**Files:**
- Modify: `js/ui/expansion.js` — mount the picker, build `enabledRecipeIds` from it, restore and save `alts`, delete the disclosure hint
- Test: `test/engine/expansion.test.js` (gating is an `enabledRecipeIds` question, so it tests through the engine — no DOM needed)

**Interfaces:**
- Consumes: `createAltPicker` from Task 1; `alts` and the `sanitizeState(raw, knownRecipeIds)` signature from Task 4.
- Produces: nothing. Final task.

- [ ] **Step 1: Write the failing tests**

`ironChain` has **no** alternate recipes — `R()` at `test/fixtures/iron-chain.js:4` hardcodes `alternate: false`, and the fixture must not be modified. Build a throwaway dataset in the test file, same pattern as `oreMakerDataset` at `:23-29`. Append:

```js
// --- Alternates gating -------------------------------------------------------

// 'fastrod' is an ALTERNATE that makes 'rod' more cheaply, plus 'gizmo' which
// ONLY an alternate can make. iron-chain.js has no alternates and must not be
// modified, so both live here.
const altDataset = {
  ...ironChain,
  recipes: [...ironChain.recipes,
    { id: 'fastrod', name: 'fastrod', buildingId: 'b', alternate: true, inputs: [{ itemId: 'ingot', perMin: 10 }], outputs: [{ itemId: 'rod', perMin: 20 }] },
    { id: 'gizmo', name: 'gizmo', buildingId: 'b', alternate: true, inputs: [{ itemId: 'rod', perMin: 5 }], outputs: [{ itemId: 'gizmo', perMin: 5 }] },
  ],
};
const BASE_ONLY = new Set(altDataset.recipes.filter((r) => !r.alternate).map((r) => r.id));
const WITH_ALTS = new Set(altDataset.recipes.map((r) => r.id));

test('planExpansion: a want only an alternate can make is unproducible with alternates off', () => {
  const off = planExpansion({
    dataset: altDataset,
    rows: [{ kind: 'want', itemId: 'gizmo', rate: 10 }],
    enabledRecipeIds: BASE_ONLY,
  });
  assert.equal(off.requirements.hasIssues, true, 'nothing can make it');

  const on = planExpansion({
    dataset: altDataset,
    rows: [{ kind: 'want', itemId: 'gizmo', rate: 10 }],
    enabledRecipeIds: WITH_ALTS,
  });
  assert.equal(on.requirements.hasIssues, false, 'enabling the alternate makes it producible');
  assert.ok(on.buildRows.some((r) => r.recipeId === 'gizmo'));
});

test('planExpansion: a Built block on a disabled alternate still plans normally', () => {
  // The picker gates what the LP may CHOOSE, never what the user may DECLARE.
  // Blocks are pinned, not solved, so an unchecked alternate is valid here.
  const p = planExpansion({
    dataset: altDataset,
    rows: [{ kind: 'block', recipeId: 'fastrod', machines: 2, clock: 1, built: true }],
    enabledRecipeIds: BASE_ONLY,
  });
  assert.equal(p.blockRows.length, 1, 'the block is honoured despite its recipe being disabled');
  assert.ok(p.netOutputRows.some((r) => r.itemId === 'rod'), 'and its output reaches the plan');
});
```

- [ ] **Step 2: Run to verify**

Run: `npm test`
Expected: the first test FAILS on its `hasIssues === true` assertion only if gating is broken — it should actually **pass immediately**, because `planExpansion` already honours whatever `enabledRecipeIds` it is handed. The second should also pass. That is fine and expected: these tests pin the contract the wiring in Step 3 depends on, and guard the §3.4 rule against a future "helpfully" filtering block recipes. If either fails, stop and fix the engine before wiring the UI.

- [ ] **Step 3: Mount the picker**

Add the import:

```js
import { createAltPicker } from './alt-picker.js';
```

Delete the disclosure hint — the `altHint` paragraph, its `container.appendChild(altHint)`, and the comment block above it (search for `Assumes every alternate recipe is unlocked`). The picker states the same thing structurally.

Replace:

```js
const enabledRecipeIds = new Set(dataset.recipes.map((r) => r.id));
```

with the picker plus a function, since the set now changes as boxes are ticked:

```js
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
```

Append the picker where the deleted hint was, so it sits above the row sections:

```js
  container.appendChild(altPicker.warningEl);
  container.appendChild(altPicker.el);
```

In `recompute`, use a fresh set and persist the picker:

```js
    const result = computeExpansionResult({
      dataset, rows, enabledRecipeIds: currentEnabledRecipeIds(), catalog, goals, fillMinutes,
    });
```

and

```js
    saveState({ rows, goals, fillMinutes, alts: [...altPicker.getEnabledIds()] });
```

Keep `saveState` where Task 3 of the previous round put it — **after** the `if (!result.ok) return`, so a failing compute is still not persisted.

- [ ] **Step 4: Run the suite**

Run: `npm test`
Expected: **228 pass, fail 0**.

- [ ] **Step 5: Verify in the browser**

Serve on 8791 and use the same probe pattern as Task 5 Step 5, seeding `alts: []`, then reporting:

```js
        log('picker summary: ' + (v.querySelector('details summary')?.textContent || 'MISSING'));
        log('old hint still present: ' + v.textContent.includes('Assumes every alternate'));
        log('alt checkboxes: ' + v.querySelectorAll('.alt-row input[type=checkbox]').length);
```

Expected: summary reads `Alternate recipes (0/110 enabled)`; the old hint is `false`; 110 checkboxes. Then in a real browser confirm ticking an alternate changes the plan's machine counts, a reload preserves the ticked set, and the Factory Optimizer tab still shows its own independent picker at `(0/110 enabled)`.

Delete `_probe.html` and stop the server.

- [ ] **Step 6: Commit**

```bash
git add js/ui/expansion.js test/engine/expansion.test.js
git commit -m "feat(ui): alternates picker for the Expansion view, off by default

The view solved with all 110 alternates enabled, so it could prescribe a
recipe you haven't unlocked. It gets its own picker with its own saved state,
independent of the Optimizer's — a recipe is either unlocked in your save or
not, but each view should be able to explore a different hypothesis without
rewriting the other's plan.

The picker gates what the LP may CHOOSE, not what you may DECLARE: a block
row can still name an unchecked alternate, because a block states what you
have and is pinned rather than solved. Tested both directions.

Expect plans to get more expensive — base recipes are less efficient, and
that is the correct answer when you haven't unlocked the alternative."
```

---

## Post-plan

Create `.superpowers/sdd/2026-08-04-expansion-alternates-and-built-blocks/progress.md` as the ledger and record per-task outcomes there. Then run a final whole-branch review before considering this shippable, and update `README.md` — its Expansion section currently states the two caveats this work removes ("assumes every alternate recipe is unlocked") and describes blocks as things you plan to build.

Note in the ledger that the render layer still has no direct test coverage, so Tasks 5 and 6 are browser-verified only.

Known follow-ups deliberately left out, per spec §9: alternate *suggestions* in Expansion; shard-budget / belt-tier / pipe-tier controls; To-build blocks counting toward the "Machines to build" tile.
