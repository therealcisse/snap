---
title: Concurrent replay: §6.1 selection, exact-base memo, §6.2 integration, §6.4 winners — realized
date: 2026-09-05
author: agent
id: concurrent-replay-core
issue: concurrent-replay-core
plan: concurrent-replay-core
---

## Summary

Snap now integrates concurrent histories deterministically: `repo/replay.ts` selects the least ready patch by §6.1's order (Snap order of result version, then author, then revision), carries the integrated vector as the causal join of integrated results, materializes a patch's exact base tree through a version-keyed memo (`I == base` shortcut → snapshot hit → sub-replay with warnings discarded), and integrates each patch against that base and the running canonical tree using §6.2's namespace rule and rules 1–4 — with the §6.3 aggregate-context transform composing the text path and §6.4's winner table deciding whole-file conflicts, emitting the unique sorted warning set. `repo/tree.ts` gained the namespace conflict query. The interim `concurrent replay is not implemented yet` is gone; linear behavior is byte-identical; this is still the pure `repo/` layer with no CLI wiring, so the acceptance landscape is unchanged.

## Plan Realized

### concurrent-replay-core

All eight tasks of `dev-docs/plans/approved/concurrent-replay-core.md` landed; both gates green (`npm run check` 338/338; `./verify --lang ts` same 5 passes / 27 failures as baseline). Deviations from the plan's approach:

- Readiness is defined as *causally before or equal to `I`*, explicitly excluding `compareVersions(...) === 'concurrent'`. The plan inherited the old filter `!== 'after'`, which treated a concurrent base as ready — a latent bug the rewrite corrects to §6.1's definition.
- `assertPrefixFree` runs on the authored tree (`B` + changes) before integration, in addition to the final result — the plan only stated the final check; the authored check preserves the linear `tree paths conflict` error position and keeps namespace settlement from building on an invalid tree.
- The authored results are carried as a `Slot` presence type (`bytes | absence`) plus an `AuthoredChange` record (change, index, slot) rather than the plan's looser "compute each change's authored result `T`" — §6.2/§6.4 reason about presence and bytes, and the per-path rules need the change kind and error context.
- The ≤ P+1 materialize golden also pins the exact materialized set (`['(a@x->1,b@x->1)']`), stronger than the plan's bound-only assertion.

## Implementation

- `ts/src/repo/tree.ts` — `namespaceConflicts(tree, path): string[]`: present proper ancestors via `ancestorPaths` + `tree.has`; present proper descendants via one byte-ordered walk of `sortedPaths` whose `ancestorPaths` contain `path`; combined and sorted with `compareBytes`.
- `ts/src/repo/replay.ts` — restructured around a shared core:
  - `ReplayCore {repository, memo: Map<versionKey, Tree>, baseKeys, hooks}` — one memo shared by the top-level walk and every sub-replay.
  - `replayRepository(repository, hooks?): ReplayResult` — whole-set replay; `ReplayHooks.onMaterialize` fires only on actual sub-replays.
  - `replaySelection(core, pending, warnings)` — the §6.1–§6.2 walk both levels use: `leastReady` (ready ⇔ base causally ≤ I; least by `readyOrder` = `snapOrder(resultVersion)`, then author bytes, then revision), `materializeBase` for the winner's `B`, `integratePatch`, then `I = joinVersions(I, result)` and `snapshotBaseState` seeding the memo whenever `I` is a named base.
  - `materializeBase(core, base, I, C)` — `I == base` returns `C` (the linear shortcut, no memo traffic); memo hit; otherwise fire `onMaterialize`, sub-replay the patches `base` selects (`componentOf(base, author) ≥ revision`) with a discarded warnings map, memoize, return. A sub-replay can never re-enter for the same base (the revision rule keeps a patch's own dot out of its base), so each distinct version materializes at most once.
  - `integratePatch(patch, index, base, current, warnings)` — computes every change's authored result via `authoredResult` (§4.5 step 5 against `B`, same messages as linear, `repository.patches[i].changes[j].edit` context), asserts the authored tree prefix-free, runs the namespace pass (`C'` = `C` minus the patch's own deletions; each made-present path with conflicts installs `T`, removes the conflicts, emits `namespace-wins` per removed path), resolves unsettled paths through `resolvePath`, installs settled paths last (overriding), asserts the result prefix-free.
  - `resolvePath` — rule 1 (`sameSlot(B, C)` → apply authored), rule 2 (`sameSlot(C, T)` → keep, no warning), rule 3 (text change, `B`/`C` text: `Q = diffTokens(tokenize(B), tokenize(C))`, `applyEdit(transformEdit(P.edit, Q), tokenize(C))`), rule 4 (§6.4 table: `delete-wins` for T absent and for B-present/C-absent, `later-create-wins`, `later-put-wins`, `put-wins`).
  - Warning set: `recordWarning` keyed `path + '\0' + reason` (NUL impossible in tracked paths), `sortWarnings` by path then reason in byte order.
- `ts/src/repo/validate.ts` unchanged; `validate.test.ts`'s concurrent-ready fixture flipped from interim reject to a validate-succeeds golden.

## Behavior

- One deterministic pass from the empty tree over the whole patch set: same repository in, same tree and warning pairs out (§6.5's convergence, by construction — no clocks, randomness, or input-order dependence beyond canonical order).
- Linear histories replay exactly as before: every winner's base equals `I`, so the shortcut serves each patch and `onMaterialize` never fires.
- Concurrent histories sequence by §6.1's order; `I` grows as the join of results; a patch whose base the walk passed through reads the seeded snapshot; only bases never visited cost a sub-replay, whose own warnings are discarded — the returned set describes the top-level integrations alone.
- Failure vocabulary is unchanged and position-preserving: `delete of absent path`, `text change on non-text base`, `no-op change`, the `applyEdit` consumption/adjacency fragments with full context, `tree paths conflict`, and `cyclic or incomplete patch history` — now also the answer for schema-valid repositories whose base versions no selected patch could produce (unreachable from any fixture that builds repositories through `init`/`commit`).
- Still no I/O, mutation, or CLI output; the CLI boundary keeps failing on the not-implemented commands exactly as before.

## Tests

`cd ts && npm run check`: 338 tests / 65 suites green (from 322/58). New coverage: `namespaceConflicts` goldens (ancestor, descendant, both, none, byte order); §6.1 ordering (concurrent roots → later create wins); rule-2 identical collapse with no warning; the OT golden (both inserts at the shared starting cursor → `C\nB\none\ntwo\n`, pinning §6.3's Q-insert priority); the §6.4 table's four whole-file cases with exact pairs; namespace wins in both directions plus the own-deletion exclusion; sub-replay warnings discarded (unit mirror of tests/31's shape); ≤ P+1 materializations with the exact materialized set on a three-contributor history; linear zero-materialize. All prior linear goldens, step-5 messages, and cycle/incomplete fixtures pass unchanged. Acceptance landscape identical: 01/02/14/24/27 green; 27 failures remain the not-implemented `status`/`commit`/`merge`/`serve`/`diff` CLI gaps — tests/31 still fails first at its `commit` step.

## Decisions

- Readiness excludes concurrent bases — the old `!== 'after'` filter was wrong in §6.1's terms even though unreachable on the linear subset; the rewrite states the spec's definition instead of inheriting the bug.
- `I` accumulates by `joinVersions` — the old replacement (`I = result`) is sound only for linear histories; the join reduces to replacement there, so linear behavior is preserved exactly while concurrent readiness can progress.
- §6.4's rule 1 (C and T identical → keep C) is the `sameSlot(C, T)` check before the OT path — one equality serves both §6.2's rule 2 and the table's rule 1, and the table's remaining rows start at rule 2.
- At rule 3 only `C`'s content can disqualify the OT path — `authoredResult` already rejects a text change on a non-text base and text changes always produce text, so `B` and `T` are text by construction; the code checks what can actually vary.
- Namespace settlements install after and override the per-path rules, and the conflict scan runs over `C` minus the patch's own deletions — a delete-and-recreate (rename-shaped) patch never conflicts with its own deletion.
- The authored tree is checked prefix-free before integration — same message and position as the linear path had, and namespace settlement never builds on an invalid intermediate.
- Both walk levels share one memo and both seed it — a base materialized by a sub-replay is the same tree the top level would read, and sub-walks passing through named bases seed them for free.
- Schema-valid-but-unproducible base versions surface `cyclic or incomplete patch history` from the sub-replay — "incomplete" is the spec's word for a history whose bases cannot be produced; hand-crafted repositories only.
- `equalBytes` stays private to `replay.ts` — still one consumer; promotion waits for the worktree/diff work.

## Follow-Up

- Everyday commands and `snap merge` (§7.8): wire the replay result's tree and warning set through the `fs/` strand's install path; suites 09–11/16–21 and 31 turn green then, with tests/18 exercising the same §6.3 priority the OT golden pins.
- Property tests — random causal patch graphs and import-permutation convergence (§6.5) — deferred to the Hardening section per the issue's Out of Scope.
- Promote `equalBytes` to `core/bytes.ts` when a second consumer arrives.
