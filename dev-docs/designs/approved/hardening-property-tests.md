---
title: "Hardening: property tests, startup profile, scale smoke"
date: 2026-09-05
author: agent
id: hardening-property-tests
issue: hardening-property-tests
plan: hardening-property-tests
---
# Hardening: property tests, startup profile, scale smoke

## Summary

The hardening strand's plan landed as a randomized convergence enforcer plus a measurement record. One new test file, `ts/src/repo/replay.property.test.ts`, generates valid causal patch graphs and pins four properties — generator validity (every sample passes `validateRepository`), joined-frontier permutation invariance, canonical patch-set permutation invariance, and full replay invariance (tree bytes, warnings, integration sequence) — against the `ts/src/repo` library seam that `snap merge` (sibling strand) will one day sit on. One new research note, `dev-docs/research/snap-startup-and-scale-smoke.md`, records the measured cold/warm startup profile, the module-graph size, and a scale smoke of `status`/`log`/`diff` at 1 000 patches and up to 4 000-line diffs. No product code changed; the acceptance landscape is byte-identical before and after.

## Plan Realized

### hardening-property-tests

All nine tasks of `dev-docs/plans/approved/hardening-property-tests.md` landed as written (tasks 1–5: generator + three properties + green `npm run check`; tasks 6–9: startup profile, scale smoke, research note, identical verify landscape). Deviations, all inside the measurement tasks:

- The module-graph probe used the plan's stated fallback — a static import-closure walk from `src/main.ts` (30 local modules, 4 `node:` builtins) — rather than `process.moduleLoadList`, which under tsx counts loader machinery, not the implementation graph.
- The diff-timing harness switched from a perl to a python one-liner after a shell-quoting bug (`@x` interpolation); timing method unchanged (whole-process wall clock, stdout discarded).
- Two extra diff fixtures (N = 1 000 and N = 4 000 lines) beyond the planned 2 000, to pin the growth shape of the O(n·m) §5 wall.
- The scratch scale-fixture generator's first working-tree materialization had an off-by-one on the last file (`f099.txt`); fixed before any timing, and repository bytes were valid throughout.

## Implementation

`ts/src/repo/replay.property.test.ts` (273 lines, only new code file):

- **Generator** — `buildGraph(tape)` interprets a fast-check integer tape (values 0–63, length ≤ 64) as a sequence of choices and grows a repository incrementally with the production APIs: pick author from `['a@x','b@x','c@x']`; pick a base among reached versions whose author component equals that author's max revision (the §4.2 revision rule holds by construction, and picking among non-newest eligible bases creates concurrent branches); `materializeVersion(repository, base)` for the exact base tree; author exactly one change against it via four buckets — create (text-insert or binary `put` from a shared flat+nested pool `f0..f3.txt, n/a, n/b, n/c`, guarded by `namespaceConflicts(...).length === 0`), text-edit (`mutateTokens` from a 3-token alphabet, edit authored as `diffTokens(old, mutated)`), overwrite-`put` (differing bytes only), delete — with deterministic fallthrough when a bucket has no legal target. `withPatch` keeps the array in canonical `(author, revision)` order; `MAX_PATCHES = 8`. Reading past the tape's end yields 0, so the builder is a pure function of the tape and fast-check shrinking works.
- **Properties** — (1) `validateRepository` accepts every generated graph (the generator's own oracle); (2) folding `joinVersions` over `resultVersion`s in a generated permutation equals the declared frontier (`versionKey` equality); (3) sorting patches by `(compareBytes(author), revision)` is permutation-invariant (`encodePatch` deep-equal) and the canonical repository validates; (4) `replayRepository` over the permuted patch array yields identical tree bytes (`sortedPaths` + `equalBytes`), `warnings` (deep-equal), and `sequence` (`encodePatch` deep-equal). Permutations come from `permutationOf(n, keys)`: a generated priority per position with original-index tie-break — pure in the keys, unlike `fc.uniqueArray`.
- Imports only production modules plus `fast-check ^4` and `node:test`/`node:assert` — no new runtime dependencies, no product file touched.

`dev-docs/research/snap-startup-and-scale-smoke.md` (only new doc): machine context (Node v24.9.0, macOS 26.5.1, M4 Max), cold `--version` (20 fresh-TMPDIR samples, median 167 ms; warm median 146 ms), cold `status` in a 1-patch repo (median 161 ms), module graph (30 + 4), scale smoke (1 000-patch/100-file `repository.json` 460 857 B: `status` 341 ms, `log` 333 ms, `diff` v1→v1000 752 ms; N-line diff 321/786/2 163 ms for N = 1 000/2 000/4 000), comparison against `snap-performance-and-data-structures` predictions (startup headroom holds; O(n·m) wall confirmed quantitatively), verify landscape (identical), and the embedded generator/timing scripts that reproduce every number.

## Behavior

No runtime behavior changed: the diff surface is exactly the test file and the research note. Exercised behavior is the properties themselves — every generated graph, whatever its concurrency shape (branching creates, overlapping edits, competing puts, deletes), replays to the same tree/warnings/sequence regardless of patch-array order, and its dots join to the same frontier regardless of accumulation order. The measurements show the real CLI at ~167 ms cold / ~146 ms warm with a 30-module + 4-builtin import closure, per-command validation at 1 000 patches costing ~190 ms of work beyond startup, and the §5 diff wall at ~2.2 s whole-process for a 4 000-line scattered-edit diff — all recorded as baselines, not acted on.

## Tests

`npm run check` green (format, lint, typecheck; 400 tests / 84 suites including the four new properties, which pass across repeated invocations under fast-check seed randomization). `./verify --lang ts`: 19 passed / 13 failed before and after with byte-identical suite title+status lists; the 13 failures are the sibling strands' unimplemented `merge` / `diff --repo` / terminal-presentation surfaces. Not covered by the properties: malformed-input behavior (the generator only builds valid graphs — deliberate; the YAML suites own rejection cases), and permutation invariance is pinned at the typed-value seam, not through a merge command, which does not exist yet.

## Decisions

- Permutations via priority keys, not `fc.uniqueArray` — `uniqueArray` rejection-samples (colliding priorities) and its shrink story is worse; priority+index-tiebreak is total and pure.
- Validity oracle as a separate first property — a failure there indicts the generator, not the core, which halves the debugging surface.
- Overwrite-`put` keeps §4.3's "differing bytes" rule by construction: when the pool draw equals the current bytes, the other pool entry is used.
- The module-graph count is the static import closure, not `process.moduleLoadList` — under tsx the latter measures the loader, not the implementation; the plan already allowed this as the fallback.
- Measurement artifacts (generator, timer) live in `/tmp` embedded in the note, not in the repo — the plan rejected a `ts/` scripts lane, and self-contained reproducibility from the note alone was the acceptance bar.
- One note for both measurements — one session, one artifact; the note's id (`snap-startup-and-scale-smoke`) names its whole scope.

## Follow-Up

- When the merge strand lands, the same generator can drive end-to-end import-permutation checks through the actual `merge` command; the properties here are the seam-level half of that.
- The research note's numbers are the baseline for any future performance work; the confirmed O(n·m) wall (~2.2 s at 4 000 lines) is the first candidate if real-use scale ever demands it, with the prior research's Myers/Hirschberg equivalence caveats as the entry point.
- Nothing in this plan introduced product debt; the only unlanded work remains the sibling strands visible in the verify landscape.

## References

- `dev-docs/plans/approved/hardening-property-tests.md` — the realized plan.
- `dev-docs/issues/open/hardening-property-tests.md` — the originating issue.
- `dev-docs/research/snap-startup-and-scale-smoke.md` — the measurement record.
- `ts/src/repo/replay.property.test.ts` — the implementation.
