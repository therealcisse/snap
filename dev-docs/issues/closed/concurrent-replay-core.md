---
title: Concurrent replay and merge: §6.1 ready set, exact-base materialization memo, §6.2 integration, §6.4 winners — library core
date: 2026-09-05
start-date: 2026-09-05
author: agent
id: concurrent-replay-core
stack: snap-1.0
closed: 2026-09-05
---

## Problem

Snap can only follow histories where every patch builds directly on the one before it. The moment two contributors work at the same time — each committing on top of a shared earlier state — Snap refuses the repository outright instead of combining their work: the deterministic rules that decide whose change survives and what the combined tree looks like do not exist yet.

`replayRepository` (`ts/src/repo/replay.ts`) already detects the two concurrent shapes — several ready patches, or a lone ready patch whose base is strictly before the integrated vector `I` — and throws the interim `concurrent replay is not implemented yet`. Four pieces are missing from `ts/src/repo/`, per stack `snap-1.0`'s Concurrent replay and merge section, as a pure `repo/`-layer change validated by unit tests: (1) §6.1 ready-set selection via the integrated vector with Snap-order then author/revision tie-break, and cycle/missing-dependency failure; (2) the exact-base materialization memo keyed by canonical version string, seeded by snapshotting replay states whose integrated vector equals a later patch's base, with the `I == base` shortcut — unit-tested by asserting materialize calls ≤ P+1 on a three-contributor concurrent history; (3) §6.2 integration rules 1–4 with the namespace rule applied for the patch as a whole before the per-path rules, including the namespace ancestor/descendant queries deferred from issue `repo-model-and-validation` into `repo/tree.ts`; (4) the §6.4 winner table and sorted unique warning set (`delete-wins`, `later-create-wins`, `later-put-wins`, `namespace-wins`, `put-wins`).

## Impact

- Concurrent repositories are unloadable: every command that loads and validates a repository fails on a concurrent history, because §4.5 step 6 requires deterministic replay of the declared frontier and the interim error stands in for it.
- `snap merge` (§7.8) is blocked: the joined replay over the dot-keyed union needs §6.1–§6.4 integration underneath, and merge's warning-difference output needs the §6.4 warning set that only concurrent integration produces.
- The §6.5 convergence guarantee has no enforcer: the same valid patch set and frontier must produce identical bytes and warning sets, which only full concurrent integration delivers.

## Context

- Already landed (issue `repo-model-and-validation`): `repo/replay.ts` carries the replay loop skeleton — integrated version `I`, pending-patch map keyed `author->revision`, ready-set filter, `cyclic or incomplete patch history` failure, linear `integratePatch` enforcing the §4.5 step-5 rules, and `ReplayResult`/`WarningReason`/`WarningPair` with the §6.4 reason names already declared but never produced (warnings are always `[]`). `repo/tree.ts` owns `Tree`, `sortedPaths`, `ancestorPaths`, `assertPrefixFree`; its namespace ancestor/descendant queries were deferred from that issue into this section. `repo/validate.ts` runs `replayRepository` as §4.5 step 6.
- Already landed (issue `text-core`): the §5 canonical diff (`ts/src/text/diff.ts`) and §6.3 inclusion transform (`ts/src/text/transform.ts`) that §6.2 rule 3 composes — aggregate context edit `Q = diff(B, C)`, incoming `P` transformed through `Q` once per integration.
- Locked by design `snap-ts-architecture`: every version-keyed `Map`/`Set` keys by the canonical version string (the memo's key); versions sort as `[id, rev][]` arrays; byte-order comparators back every observable ordering.
- Spec anchors: §6.1 (selection and least-ready ordering: Snap order, then author, then revision), §6.2 (exact-base materialization as a sub-replay whose warnings are discarded, namespace rule before per-path rules, integration rules 1–4), §6.4 (path-level winner table and unique warning pairs sorted by path then reason), §4.5 step 6 and the cycle/missing-dependency rule, §11 (unit tests for behavior the YAML harness cannot express).
- Acceptance: unit tests only (`ts/src/repo/*.test.ts`); the `./verify` landscape is unchanged — no YAML suite turns green or red in this issue.

## Out of Scope

- The `snap merge` command and its dirty-tree/install behavior (§7.8) — needs the sibling strand's `fs/` layer (working-tree scan, delta install).
- Greening the concurrent/merge YAML suites (09–11/16–21/18/21) — they keep their current state; `./verify` landscape unchanged.
- Property tests (random causal patch graphs, import-permutation invariance) — Hardening and performance section.
- HTTP (`snap merge <url>`, HTTP repository operand).

## Plan Closeout Notes

<!-- plan-close-review: concurrent-replay-core -->

- Scope: no drift — all eight tasks landed within Approach; four recorded refinements (readiness excludes concurrent bases, authored-tree prefix-free check before integration, `Slot`/`AuthoredChange` representation of §6.2's B/C/T, exact materialize-set golden beyond ≤ P+1) are documented in design `concurrent-replay-core`.
- Documentation impact: none — plan's "None" confirmed; `ts/AGENTS.md` Layout and Conventions already cover `repo/replay.ts`'s memo and module split; no CLI-visible behavior change.
- Guidelines / conventions: none recorded — no `GUIDELINES.md` in this repo; `ts/AGENTS.md` conventions held (`.ts` imports, byte-order comparators, `versionKey` keys, no non-null assertions in `src/`), enforced green by `npm run check`.
- Comments / docstrings: conform — new module and function comments cite SPEC sections and state rationale; no violations flagged.
- Stack items satisfied: fully — the §6.1 selection, exact-base memo (with the ≤ P+1 unit test), and §6.2 rules-1–4 items of the Concurrent replay and merge section, plus the Repository-model section's tree item whose deferred namespace queries land here. Partial — the §6.4 winner-table and text-OT items (library core landed and unit-pinned; suites 09–11/16–21/18/21 greenness awaits `merge`/CLI wiring) — stack `snap-1.0`.

<!-- /plan-close-review -->
