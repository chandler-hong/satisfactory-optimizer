# Expansion alternate-recipe suggester — design

Status: approved 2026-08-07.

## 1. Problem

The Expansion view has an alternates picker that starts with all 110 alternates **off**, and
no way to find out which of them would help. The Factory Optimizer has had a suggester since
before this branch — it names disabled alternates that would improve the current build, each
with a one-click **Enable** — but it is not wired into Expansion at all.

The gap matters more in Expansion than in the Optimizer, because Expansion's picker defaults
to nothing enabled. Every new user starts in exactly the state where suggestions are most
useful.

### 1.1 Why the existing suggester cannot simply be pointed at Expansion

`solveFor` (`js/engine/suggestions.js:23`) calls `hitTargets`/`maxSets` directly with
`{ dataset, caps, mode, targets, noWaste }`. It passes **no supplies** and models **no pinned
block loads**. Aimed at an Expansion plan it would evaluate a plain node-fed factory — one the
user does not have — and rank alternates against it. The answers would be confidently wrong
rather than absent, which is worse.

## 2. Decisions

| Question | Decision |
| --- | --- |
| Which modes? | **Maximize only.** Target-rates is out of scope. |
| Targets needing 2+ alternates? | **No bundle search.** Defer to the `blockedItems` diagnostic. |
| Placement? | **Results pane**, directly under the maximize readout. |
| Engine approach? | **Inject the solver** into `suggestAlternates`. |

## 3. Verified facts this design rests on

Measured against the pinned dataset, not assumed. An implementer who finds any of these false
should stop and say so rather than working around it.

- `planExpansion` costs **~3 ms** for a representative plan (6× Motor block, max Modular
  Engine). A full candidate sweep — base + all-alternates-on + 12 candidates — is **~18 ms**,
  the same order as the Optimizer's existing suggester. **Performance is not a constraint
  here**, which is what makes the correct-by-construction approach affordable.
- `planExpansion` returns `recipeRates` as `Map<recipeId, ratePerMin>` covering **LP-solved
  recipes only, upstream of the pinned blocks** (`js/engine/expansion.js:913`). Pinned block
  recipes live in `graphRates` instead. Candidate ranking wants exactly the former.
- `benefitOf` (`js/engine/suggestions.js:40`) computes **only** the `output` kind when
  `mode !== 'targets'`, and deliberately skips the `realize()` work for machines/raw
  (`:90-92`). Expansion Maximize therefore needs **no new benefit kind**.
- `renderSuggestions` (`js/ui/render.js:189`) is **private to `render.js`**. The shared
  renderer module is `js/ui/report-panels.js`, which already exports `renderRequirements` for
  use by both views.
- The Optimizer's suggester **already works** for the reported Packaged Turbofuel case when
  raws are present: with Crude Oil, Coal, Water and Sulfur capped it returns
  `Recipe_Alternate_TurboBlendFuel_C — "builds this (0 → 290.9/min)"` in 11 ms. With **no**
  raws added it returns **zero** suggestions. See §9.
- `js/ui/view-model.js:218` is the **only** production call site, and it already wraps the call
  in a `try`/`catch` that logs and continues without suggestions (`:227`). Expansion's call
  site should be equally non-fatal: a suggester failure must never take the plan down with it.

## 4. Architecture

`suggestAlternates` keeps everything that is not mode-specific:

- enumerating disabled alternates
- the all-alternates-on probe used to find candidates
- ranking candidates by their rate in that probe, and the `maxCandidates` cap
- computing benefits, ranking by `KIND_PRIORITY` then magnitude, and the `maxSuggestions` cap
- the returned `{ suggestions, evaluatedCount, capped }` shape

It stops calling `hitTargets`/`maxSets` itself. Instead the caller supplies a solve function.

```
solve(recipeIds) -> { sets, perPart, feasible, recipeRates, shortfallTotal }
```

`shortfallTotal` is only read on the target-rates benefit path. Maximize-only callers may
return `0`; it is in the contract because the Optimizer's existing solver already produces it,
not because Expansion needs it.

- **Optimizer**: the existing `solveFor` **stays in `suggestions.js` and remains the default**
  when no `solve` is supplied. The Optimizer's call site in `js/ui/view-model.js` therefore
  does not change at all, which is what makes "this refactor altered nothing" cheap to prove
  (§8).
- **Expansion** passes `(ids) => planExpansion({ ...args, enabledRecipeIds: ids })`, adapted to
  the shape above by reading `plan.maximize` for `sets`/`perPart` and `plan.recipeRates`
  directly.

Expansion's semantics — gross-output-only blocks, `blockOutputExclusions`, every raw cap
`Infinity` — are inherited because the real planner does the solving. **Nothing about block
semantics is restated inside `suggestions.js`.** That is the whole point of this shape: those
semantics are where most of this project's escaped bugs originated.

`js/engine/**` stays pure — `suggestions.js` must not import from `js/ui/**`.

## 5. Benefit semantics

No new benefit kinds. Expansion Maximize uses the existing `output` path as-is:

- `base.sets <= EPS` → `builds this (0 → 291/min Packaged Turbofuel)`
- otherwise → `+4.2/min Modular Engine (+28%)`

Multi-target maximize already falls back to the `sets/min` phrasing, which is correct here too.

**A note for whoever reads the labels later:** because Expansion sets every raw cap to
`Infinity` by design, "more output" never means "more from your ore nodes" as it does in the
Optimizer. It always means **your declared blocks and Have rows are being used better** —
those are the only scarce things in an Expansion plan. Same code, different meaning.

## 6. UI

- Move `renderSuggestions` from `js/ui/render.js` into `js/ui/report-panels.js` and export it.
  This mirrors `renderRequirements`, which is already shared by both views through the same
  module. The Optimizer's call site changes to an import; its markup must not change.
- Expansion renders it in the **results pane**, immediately after the maximize readout, so the
  gain and the number it improves are adjacent.
- **Enable** routes to the existing `altPicker.enableOne(recipeId)`, which ticks the checkbox
  in the bottom alternates panel and triggers a re-solve. No new enable path.

## 7. Edge cases

| Case | Behaviour |
| --- | --- |
| No max target picked | No suggestions. Nothing to improve. |
| Base plan **unbounded** (`bounded: false`) | **Suppress the whole panel.** With output already unlimited, "+28% output" is meaningless and the underlying `sets` is not a trustworthy number. |
| Target needs 2+ alternates | No suggestions. The `blockedItems` diagnostic explains it. |
| A block declares a **disabled** alternate | Suggest it normally, no special case. The user is already running that recipe; enabling it lets the *planner* add more, which is a real gain. Consistent with the documented rule that the picker governs what the planner may **choose**, not what the user may **declare**. |
| Target-rates mode | Panel absent entirely. |

## 8. Testing

- **Optimizer regression.** A characterisation test proving the injection refactor changed
  nothing on the Optimizer path. This is the highest-value test in the change: the refactor
  touches shipped behaviour that this feature is not supposed to alter.
- **Expansion adapter.** Tests that a block or Have constraint actually determines which
  alternate wins — i.e. that the suggestion genuinely reflects the Expansion plan and not a
  node-fed one. A test that would still pass against the old `solveFor` proves nothing.
- **Edge cases.** At minimum the unbounded-suppression rule and the no-target case.
- **No DOM shim.** `js/ui/**` is deliberately not unit-tested in this repo (documented in the
  README); the rendering layer is verified by running the app. Follow the established pattern:
  extract any pure decision as an export and test that. Do **not** add
  `test/fixtures/dom-stub.js`. If a shim seems genuinely necessary, stop and raise it — that
  is an architectural change, not part of this feature.
- **Browser verification** of the results-pane placement in both themes, with a screenshot
  actually read rather than inferred from CSS. Note `.expansion-view` is a **sibling** of
  `.app` in `index.html`, so `.app`-scoped CSS never reaches it — this trap has bitten the
  Expansion feature five times.

## 9. Out of scope

- **Target-rates mode.** Its `machines` and `raw` benefits need re-interpretation when blocks
  are already built, and that deserves its own design pass.
- **Multi-alternate bundles.** No combinatorial search.
- **The Optimizer suggester's empty-state silence.** It returns zero suggestions when no raws
  are added, because the all-alternates-on solve also produces zero and there are therefore no
  candidates to rank — precisely the state a user is in while setting up, and precisely when
  the old misleading "no enabled recipe produces X" message was their only feedback. This is a
  real Optimizer defect and is **queued separately**; it is not this feature's job.
