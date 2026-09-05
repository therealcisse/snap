---
title: Text core: tokens, edit scripts, canonical diff, inclusion transform
date: 2026-09-05
start-date: 2026-09-05
author: agent
id: text-core
stack: snap-1.0
closed: 2026-09-05
---

## Problem

Snap's core promise — deterministic automatic merging — rests on machinery the TypeScript implementation does not have yet: comparing two versions of a text file to produce one canonical description of the difference, and transforming concurrent edits so they combine deterministically. Today that entire layer is absent, and every command that depends on it (`commit`, `diff`, `revert`, `merge`) remains a `not implemented` stub.

Concretely, four pure modules are missing from `ts/src/`: a §4.4 tokenizer that splits text into LF-retaining tokens and interns them; a §4.4 edit-script union with well-formedness validation, `apply`, and `coalesce`; the §5 canonical diff — suffix-table dynamic programming with the forward walk and delete-on-tie rule, over interned integer tokens, with common-prefix trimming but no common-suffix trimming; and the §6.3 inclusion transform. The roadmap design fixes the module layout (`text/tokens.ts`, `text/edit.ts`, `text/diff.ts`, `text/transform.ts`) and the algorithms; none of it exists.

## Impact

- The Working tree and everyday commands section is blocked: `snap commit`'s change-vs-base comparison needs the §5 diff, and `snap diff` needs it directly. `tests/03` and `tests/19` therefore cannot go green, leaving the two deferred CLI-skeleton stack items unchecked.
- The Concurrent replay and merge section is blocked: §6.2's text-change rule is defined in terms of the §6.3 transform.
- §11 requires unit tests this layer must carry and no YAML suite can express (the `a b a -> b a a` golden, the `a\nb\n -> b\na\n` tie, the `[b] -> [a,b,b]` suffix-trim counterexample, every §6.3 table row, and a random small-input apply/transform oracle); there is currently nothing to attach them to.

## Context

- Locked decisions in design `snap-ts-architecture` bound the solution: file contents are `Uint8Array` end to end with text as a derived view (#3); the diff is the direct suffix-table DP with forward walk and delete-on-tie over interned tokens in a flat `Int32Array`, prefix trim only — Myers/Hirschberg variants only later behind an exhaustive oracle (#5); one byte-order comparator for every observable ordering (#2).
- Foundations already landed: `core/bytes.ts` (byte-order comparator, `isText`, fatal BOM-preserving UTF-8 decode, canonical base64), `core/version.ts`, `core/json.ts`, `repo/model.ts` decode, `fs/locate.ts` configuration.
- Spec anchors: §4.4 (tokens and edit scripts), §5 (canonical diff), §6.3 (inclusion transform). Research `snap-performance-and-data-structures` records the suffix-trim counterexample and the DP analysis.
- Constraints: Node built-ins only in `src/**` (`fast-check` is available as a dev dependency for the oracle test); `erasableSyntaxOnly`; unit tests colocated as `src/**/*.test.ts` with `.ts` import extensions.

## Out of Scope

- Wiring into any command body (`snap diff`, `commit`, `revert`, `merge`) — Working tree and everyday commands section.
- §7.6 unified-diff output formatting (whole-file blocks, `/dev/null`, `\ No newline at end of file`, `Binary files … differ`).
- §6.1 ready-set selection, §6.2 integration and namespace rules, §6.4 winner table and warning set — Concurrent replay and merge section.
- Typed `Patch`/`Change`/`Repository` codec with canonical encode — Repository model and validation section.
- Random causal patch-graph property tests with import-permutation invariance — Hardening and performance section (only the small-input apply/transform oracle is in scope here).

## Plan Closeout Notes

<!-- plan-close-review: text-core -->

- Scope: no drift; task-4 convergence oracle reformulated (symmetric TP1 equality is false under §6.3's directional Q-insert priority) — recorded deviation, see design `text-core`.
- Documentation impact: none; `ts/AGENTS.md` Layout already lists the four `text/` modules exactly as landed.
- Guidelines / conventions: conform to `ts/AGENTS.md`; one reusable micro-convention emerged — the `cell()` guard accessor for typed-array reads under `noUncheckedIndexedAccess` (design `text-core`, Decisions).
- Comments / docstrings: conform.
- Stack items satisfied: `snap-1.0` Text core, all four — §4.4 tokenizer; edit-script union (§4.4); §5 canonical diff; §6.3 inclusion transform.

<!-- /plan-close-review -->
