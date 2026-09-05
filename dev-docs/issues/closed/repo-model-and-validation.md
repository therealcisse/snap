---
title: Repository model and validation: canonical codec, structural equality, trees, §4.5 checks, linear replay
date: 2026-09-05
start-date: 2026-09-05
author: agent
id: repo-model-and-validation
stack: snap-1.0
closed: 2026-09-05
---

## Problem

Snap can read the shape of a repository file but cannot vouch for it or reproduce it: there is no check that a repository's history is well-formed, no canonical way to write one back out, no content-based way to compare two repositories (the dot), and no replay to turn a history into the file tree it represents.

Five pieces are missing from `ts/src/repo/`, per stack `snap-1.0`'s Repository model and validation section: a canonical encoder for `Patch`/`Change`/`Repository` (two-space indent, trailing LF, §4.1–§4.3) to pair with the existing strict decode in `repo/model.ts`; a canonical structural-equality serialization for dot comparison (§3.5, §4.2); a `repo/tree.ts` Tree type with ancestor-set prefix-free checks and namespace ancestor/descendant queries (§2, §6.2); a `repo/validate.ts` implementing §4.5 steps 1–5 (schema, sort order, dot uniqueness, contiguity, closure, `revision = base[author]+1`, change-vs-base); and the linear-history subset of `repo/replay.ts` — single ready patch, `I == base` always — as §4.5 step 6.

## Impact

- `tests/15-repository-validation.yaml` and `tests/23-strict-validation-matrix.yaml` fail at their first repository-loading step (`snap: not implemented: status`): the validation surface they pin (`unknown field`, `duplicate JSON key`, canonical sort order, contiguity, revision rule, change-vs-base) has no enforcer. (`tests/27-history-canonicality.yaml` already passes on the commands that exist.)
- Working tree and everyday commands are blocked: every command loads and validates the repository and runs one replay whose frontier tree and warning set it reuses.
- Concurrent replay and merge are blocked: §6.2 integration builds on validation and replay, and merge's dot-keyed union needs structural equality.

## Context

- Already landed: `repo/model.ts` strict decode (`Patch`, `Change`, `Repository`, `decodeEditOp` with the schema-level `EditOp` rules), `core/json.ts` strict reader (never `JSON.parse`), `core/bytes.ts` byte-order comparator and canonical base64, and — from issue `text-core` — `applyEdit`/`validateEditScript`, which §4.5 step 5 calls per changed path against base tokens, surfacing the suite-pinned fragments `does not consume old content` (tests/15) and `consumes beyond old content` (tests/23) with a caller-supplied context prefix.
- Locked by design `snap-ts-architecture`: canonical encode is two-space indent with trailing LF; dot equality compares canonical structural serializations; trees are `Map<string, Uint8Array>` with ancestor-set queries for prefix-free and namespace checks (never adjacent-pair scans); every version-keyed `Map`/`Set` uses the canonical version string; versions are sorted `[id, rev][]` arrays.
- Spec anchors: §4.1–§4.3 (schema and encoding), §3.5 (dot equality), §4.5 (six validation steps), §2 (paths and trees).

## Out of Scope

- §6.1 ready-set selection beyond single-ready, §6.2 full integration rules and the base-materialization memo, §6.4 winner table and warning set — Concurrent replay and merge section.
- Command bodies (`status`, `log`, `diff`, `commit`, `revert`) and working-tree scan/install — Working tree and everyday commands section.
- §7.6 unified-diff rendering.
- HTTP client and server.
- Random causal patch-graph property tests — Hardening and performance section.

## Plan Closeout Notes

<!-- plan-close-review: repo-model-and-validation -->

- Scope: no drift — all eight tasks landed within Approach; four recorded refinements (unreachable `creates existing path` dropped, `validateRepository` returns the replay result, `ancestorPaths` naming, defensive single-ready concurrency branch) are documented in design `repo-model-and-validation`.
- Documentation impact: none — plan's "None" confirmed; `ts/AGENTS.md` Layout already lists `repo/` (model, tree, validate, replay); no CLI-visible behavior change.
- Guidelines / conventions: none recorded — byte-order comparators, canonical string keys, and exhaustive switches per `ts/AGENTS.md`; no `GUIDELINES.md` exists in this repo.
- Comments / docstrings: conform — new module and function comments cite SPEC sections and state rationale; no violations flagged.
- Stack items satisfied: fully — decode + canonical-encode item, dot structural-equality item, linear-replay item (stack `snap-1.0`, Repository model and validation section). Partial — tree item (namespace ancestor/descendant queries deferred to Concurrent replay and merge) and §4.5 steps item (validation code complete and unit-pinned; suites 15/23 greenness awaits `status` wiring in Working tree and everyday commands).

<!-- /plan-close-review -->
