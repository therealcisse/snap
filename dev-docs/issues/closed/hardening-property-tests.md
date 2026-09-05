---
title: "Hardening and performance: §11 property tests, cold-startup profile, scale smoke"
date: 2026-09-05
start-date: 2026-09-05
closed: 2026-09-05
author: agent
id: hardening-property-tests
stack: snap-1.0
---

## Problem

Snap's strongest guarantee — that the same patches produce exactly the same merged result no matter the order they arrived in — is currently checked only against a small set of hand-written fixtures, and the cost of running Snap at realistic repository sizes has never been measured. Ordering bugs the fixed cases never construct, and slowdowns that only appear with hundreds of files or thousands of patches, would both go unnoticed.

The work, verbatim from the strand description:

Add the §11 hardening items from stack snap-1.0: a `fast-check` property test generating random valid causal patch graphs asserting import-permutation invariance of frontier, patch set, warning set, and tree bytes; the startup profile under the harness's cold `TMPDIR` with the module graph kept small; and the scale smoke (1 000-patch linear history, 100-file tree, 2 000-line diff) recorded as a research note under `dev-docs/`. No public behavior changes; the `./verify --lang ts` landscape is unchanged.

Concretely, three deliverables: (1) a `fast-check` generator of random valid causal patch graphs feeding `replayRepository`, asserting that permutations of patch/import order yield the identical joined frontier, integrated patch set, sorted warning set, and materialized tree bytes; (2) a startup profile measured under the harness's cold `TMPDIR` discipline, with the module graph kept small as a settled constraint, not an optimization project; (3) a scale smoke outside the suite — a 1 000-patch linear history, a 100-file tree, a 2 000-line diff — with results recorded as a research note under `dev-docs/research/`.

## Impact

- Import-permutation invariance (§6.5 convergence, §11 acceptance item 6) has no randomized enforcer. The YAML fixtures exercise a handful of fixed shapes; only generator-driven tests explore the interleavings, tie-break paths, and warning orderings the hand-written cases never construct.
- Cold-startup cost is the one performance factor that can plausibly affect the acceptance suite itself (research `snap-performance-and-data-structures`, "Scale baseline"): the harness gives each case a fresh `TMPDIR`, so the tsx transpile cache starts cold every time, and module-graph growth silently taxes every one of the suite's process spawns.
- Realistic-scale behavior (1 000 patches, 100 files, 2 000-line diff) is otherwise unmeasured; the mandated per-command replay (§4.5) and `O(n·m)` diff (§5) costs stay predictions until the smoke runs and is recorded.
- Stack `snap-1.0`'s Hardening and performance section cannot close without these three items.
- No user-visible change: this is developer-confidence and measurement work; the `./verify --lang ts` landscape is unchanged.

## Context

- Stack `snap-1.0`, "Hardening and performance" section — this issue owns the three unchecked test/measurement items. The fourth unchecked item (full `./verify` green, `npm run build` clean, `test-harness` check unchanged) tracks overall suite state owned by the concurrent-replay/merge, HTTP, and terminal-presentation strands, not this one.
- `fast-check ^4` is already a pinned dev dependency (`ts/package.json`, stack Scaffolding item), so the property test lands in the existing language-specific lane: colocated `ts/src/**/*.test.ts` run by `node --test` (`npm test` / `npm run check`). It must not leak into the YAML harness, which is implementation-language neutral and imports no implementation code.
- Replay surface to test: `ts/src/repo/replay.ts` — ready-set selection, the exact-base materialization memo, §6.2 integration, and the §6.4 warning set — landed via issue `concurrent-replay-core`; text OT via `ts/src/text/`. §6.5 convergence over the same valid patch set and frontier is exactly the property this issue pins.
- Spec anchors: §11 ("Property tests SHOULD generate valid causal patch graphs and verify that import permutations produce the same joined frontier, patch set, warnings, and tree"), §6.5, §4.5 step 6, §5.
- Startup profile method: the harness sets `TMPDIR` to a fresh per-case sandbox (`test-harness/src/process.ts` `deterministicEnvironment`), which keeps the tsx cache cold per case; research `snap-performance-and-data-structures` records the stub-baseline numbers and flags "small module graph to keep cold tsx startup low" as a cheap win. Keeping the module graph small is a settled stack constraint.
- The scale smoke runs outside the suite (not in `npm test`, not in `./verify`); its numbers land as a research note under `dev-docs/research/` — research informs plans but does not decide — and should confirm or correct the research note's scale predictions.
- Build, lint, and type-check gates: `cd ts && npm run check` (format, lint, typecheck, unit tests). The shared acceptance suite `./verify --lang ts` is not expected to change state.

## Out of Scope

- Greening the remaining YAML suites or the stack's "Full `./verify --lang ts` green" item — owned by the sibling strands.
- Any public behavior change, `SPEC.md` edit, new CLI surface, or changes to `tests/`, `TEST-HARNESS.md`, or `test-harness/`.
- Performance optimization beyond profiling and the smoke itself — if the profile or smoke exposes a real regression, the fix is a separate issue with its own lifecycle.
- Cross-language repository-exchange property testing (§11 item 11, all three reference implementations) — this issue tests the TypeScript implementation only.
- Additional property tests beyond import-permutation invariance of replay (tokenizer, diff goldens, and OT already carry unit oracles from earlier strands).

## Plan Closeout Notes

<!-- plan-close-review: hardening-property-tests -->

- Scope: no drift — all nine tasks landed within Approach; measurement-detail deviations (N = 1 000/4 000 diff fixtures beyond the planned 2 000, python timer after a perl quoting bug, static import-closure module probe using the plan's stated fallback) are recorded in the realized design `hardening-property-tests`.
- Documentation impact: as planned — one new research note (`snap-startup-and-scale-smoke`); no spec, README, harness, or AGENTS changes; nothing beyond the plan's section.
- Guidelines / conventions: the choice-tape fast-check pattern (one integer arbitrary interpreted as a deterministic choice sequence) is a second property-suite precedent after `transform.test.ts`, worth citing if further property suites are added.
- Comments / docstrings: conform — why-not-what comments throughout `replay.property.test.ts`; lint/format/typecheck green.
- Stack items satisfied: `snap-1.0` "Hardening and performance" items 1–3 — property test (import-permutation invariance), startup profile under cold `TMPDIR` with module graph confirmed small (30 + 4), scale smoke recorded as research note. Item 4 (full `./verify` green) stays with the sibling strands.

<!-- /plan-close-review -->
