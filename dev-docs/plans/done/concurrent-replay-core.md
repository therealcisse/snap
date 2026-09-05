---
title: Concurrent replay and merge: §6.1 ready set, exact-base materialization memo, §6.2 integration, §6.4 winners — library core
date: 2026-09-05
author: agent
id: concurrent-replay-core
issue: concurrent-replay-core
research:
- snap-performance-and-data-structures
designs:
- snap-ts-architecture
completed: 2026-09-05
closeout_notes: true
---

## Context

Issue `concurrent-replay-core` captures the library core of stack `snap-1.0`'s Concurrent replay and merge section: `replayRepository` today detects concurrent histories only to reject them with the interim `concurrent replay is not implemented yet`, and the deterministic integration semantics of SPEC §6.1–§6.4 do not exist. This plan lands them as a pure `repo/`-layer change — §6.1 least-ready selection, the exact-base materialization memo, §6.2 integration with the namespace rule before per-path rules, and the §6.4 winner table and warning set — validated by unit tests only. No CLI wiring, no `fs/` installation, `./verify` landscape unchanged, exactly as the issue's Out of Scope draws the boundary.

## Current State

- `ts/src/repo/replay.ts` — the ready-set loop (lines 72–93) filters pending patches with `compareVersions(base, I) !== 'after'` and takes `ready.at(0)` (array order, not §6.1's Snap order); the `concurrent` guard (lines 82–86) throws the interim error; `integratePatch` (lines 101–141) applies changes against a single `base` tree with the §4.5 step-5 checks; `ReplayResult`/`WarningReason`/`WarningPair` are declared but warnings are always `[]`; private `equalBytes`.
- `ts/src/repo/tree.ts` — `Tree`, `sortedPaths`, `ancestorPaths`, `assertPrefixFree`; the namespace ancestor/descendant queries deferred from issue `repo-model-and-validation` are absent.
- Primitives ready for composition: `core/version.ts` (`snapOrder`, `compareVersions`, `versionKey`, `componentOf`), `text/diff.ts` `diffTokens`, `text/transform.ts` `transformEdit` (precondition: both scripts consume one common base), `text/edit.ts` `applyEdit`/`coalesceEditScript`, `core/bytes.ts` `isText`/`compareBytes`.
- Two tests pin the interim error and must flip to goldens: `replay.test.ts` line 279 ("rejects two simultaneously ready patches pending §6.2") and `validate.test.ts` line 149 ("rejects concurrent-ready histories through replay").
- Research `snap-performance-and-data-structures` (§ "§6.2 integration and the exact base tree"): un-memoized exact-base materialization is exponential; a memo keyed by canonical version string bounds it at `P + 1` distinct versions; `I == base ⇒ C is B`; snapshotting top-level `(I, C)` states seeds the memo for free. Design `snap-ts-architecture` decisions 6–7 lock the memo, shortcut, and ancestor-set namespace queries; `ts/AGENTS.md` forbids a recursive un-memoized `materialize`.
- `tests/31-sub-replay-warnings.yaml` pins sub-replay warnings being discarded at the `merge` level; it stays red until `snap merge` exists (landscape unchanged).

## Developer Feedback

The interview was skipped: SPEC §6.1–§6.4 and design `snap-ts-architecture` force every structural choice. Recorded plan-author calls:

1. **One plan, not staged multiples.** The four work items interlock — §6.2 integration needs the memo, the memo needs §6.1 ordering to be observable — and no intermediate state is green. Rejected: a selection-only first plan — its behavior is untestable until integration exists.
2. **All code lands in `repo/replay.ts` and `repo/tree.ts`**, per the architecture design's module layout (`replay.ts` owns §6.1 selection, memo, integration, warnings; `tree.ts` owns namespace queries). Rejected: a new `repo/materialize.ts` — the layout is fixed by the approved design.
3. **§6.1 selection:** least ready by `snapOrder(resultVersion)`, then `compareBytes(author)`, then revision. The top-level replay keeps whole-set replay (recorded deviation from issue `repo-model-and-validation` — selection would hide unreachable patches); version-based §6.1 selection is used only inside sub-replays.
4. **Memo:** `Map<string, Tree>` keyed by `versionKey`; precompute the set of `versionKey(p.base)`; seed after the initial state and each top-level integration when `versionKey(I)` is a known base; the `I == base` shortcut bypasses the memo entirely (linear histories stay `O(P)` and memory-free).
5. **Materialize-count instrumentation:** `replayRepository(repository, hooks?)` with an optional `onMaterialize?: (base: Version) => void` fired once per actual sub-replay materialization (not memo hits, snapshots, or the shortcut). Rejected: a module-level counter (global mutable state in `src/`) and exporting the memo for a counting wrapper (leaks internal shape; the hook states the ≤ P+1 invariant directly).
6. **Namespace query shape:** one function `namespaceConflicts(tree, path): string[]` returning the present proper ancestors and proper descendants of `path`, byte-ordered — §6.2 treats both directions identically (install authored result, remove conflicting current paths) and warnings are sorted at the end regardless. Rejected: separate ancestor/descendant functions (two calls merged at every use site, no second consumer).
7. **Sub-replays reuse the integration core with warnings discarded** (§6.2 "Its warnings are discarded"); their §4.5 step-5 failures are the same deterministic errors the top-level replay would throw.

## Approach

1. **`repo/tree.ts` — namespace queries.** `namespaceConflicts(tree, path)`: ancestors via `ancestorPaths(path)` + `tree.has`; descendants via one byte-ordered walk of `sortedPaths(tree)` whose `ancestorPaths` contain `path`; combined result sorted with `compareBytes`.
2. **`repo/replay.ts` — §6.1 ordering.** Replace `ready.at(0)` with a least-by comparator over `snapOrder(resultVersion(...))`, then author bytes, then revision. Drop the interim throw; the `cyclic or incomplete patch history` failure stays verbatim.
3. **`repo/replay.ts` — memo and materialization.** Restructure around an internal replay core shared by the top-level walk and sub-replays: a `memo: Map<string, Tree>`, the base-key set, seeding of `(I, C)` snapshots, and `materializeBase(base, I, C)` implementing shortcut → memo hit → sub-replay (patches selected by `componentOf(base, author) >= revision`), firing `onMaterialize` only on the sub-replay path and storing the result in the memo before returning.
4. **`repo/replay.ts` — §6.2 integration.** `integratePatch` gains `B` and `C`: first compute each change's authored result `T` against a copy of `B` (reusing the existing step-5 checks — `delete of absent path`, `text change on non-text base`, no-op vs `B`, `applyEdit` consumption with the `repository.patches[i].changes[j].edit` context); then the namespace pass (`S` = present authored paths, `C'` = `C` minus `P`'s deleted paths, `namespaceConflicts` on each `p ∈ S`, install `T`, remove conflicts, emit `namespace-wins` per removal, collapse duplicates); then per-path rules for unsettled paths against the same `B` and `C`: identical `B`/`C` → apply authored; identical `C`/`T` → keep; all-text with a text change → `Q = diffTokens(tokenize(B), tokenize(C))`, `applyEdit(transformEdit(P.edit, Q), C)`; otherwise the §6.4 winner table (`delete-wins`, `delete-wins`, `later-create-wins`, `later-put-wins`, `put-wins`). Apply all path changes together; `assertPrefixFree` on the result.
5. **`repo/replay.ts` — warning set.** Top-level integrations accumulate pairs keyed `path + '\0' + reason` (NUL cannot appear in a path); return unique pairs sorted by `compareBytes` on path, then reason. Sub-replay warnings are dropped.
6. **Tests.** `tree.test.ts`: `namespaceConflicts` goldens (ancestor, descendant, both, none, byte order). `replay.test.ts`: replace the interim-error test with concurrent goldens — three-contributor history (tree + warnings), namespace `a` vs `a/b` (`namespace-wins`, mirroring tests/11 semantics), `delete-wins` both directions, `later-create-wins`, `later-put-wins`, `put-wins`, rule-2 identical collapse with no warning, concurrent text edits through `diff`+`transform`, sub-replay warnings discarded (unit mirror of tests/31), §6.1 tie-break order, ≤ P+1 `onMaterialize` count on a three-contributor concurrent history, cycle/missing fixtures unchanged. `validate.test.ts`: flip the interim fixture to a validate-succeeds golden returning tree and warnings.
7. **Gates.** `cd ts && npm run check` green; `./verify --lang ts` landscape unchanged.

## Tasks

- [ ] `ts/src/repo/tree.ts` + `tree.test.ts`: add `namespaceConflicts(tree, path): string[]` with goldens for ancestor, descendant, both, none, and byte-ordered output.
- [ ] `ts/src/replay.ts`: least-ready selection by (Snap order of result, author bytes, revision); remove the interim `concurrent replay is not implemented yet` throw; keep `cyclic or incomplete patch history`.
- [ ] `ts/src/repo/replay.ts`: memo infrastructure — base-key set, `(I, C)` snapshot seeding, `materializeBase` with shortcut/memo/sub-replay, shared top-level/sub-replay core, optional `onMaterialize` hook.
- [ ] `ts/src/repo/replay.ts`: §6.2 integration — authored results against `B`, namespace rule before per-path rules, rules 1–4 with the OT composition, §6.4 winner table, unique warnings sorted by path then reason.
- [ ] `ts/src/repo/replay.test.ts`: concurrent goldens listed in Approach step 6, including the ≤ P+1 materialize-count assertion.
- [ ] `ts/src/repo/validate.test.ts`: flip the concurrent-ready fixture to a success golden.
- [ ] `cd ts && npm run format && npm run check` green.
- [ ] `./verify --lang ts`: landscape unchanged (same suites pass and fail as before this plan).

## Documentation Impact

None. `ts/AGENTS.md` Layout already names `repo/` (model, tree, validate, replay) and its Conventions already require the memo; no CLI-visible behavior changes.

## Acceptance Tests

- `cd ts && npm run check` green, with unit coverage for: §6.1 ordering and tie-breaks; memo behavior via the `onMaterialize` hook firing ≤ P+1 times on a three-contributor concurrent history; the §6.4 winner table's five reasons with exact pairs; namespace wins on concurrent `a` vs `a/b`; rule-2 identical collapse with no warning; concurrent text integration through `diff` + `transformEdit` + `applyEdit`; sub-replay warnings discarded; existing linear goldens and step-5 messages unchanged.
- `./verify --lang ts` from the repository root: landscape unchanged — no suite turns green or red.
