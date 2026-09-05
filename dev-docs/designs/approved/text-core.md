---
title: Text core realized: tokens, edit scripts, canonical diff, inclusion transform
date: 2026-09-05
author: agent
id: text-core
issue: text-core
plan: text-core
---

## Summary

The four pure modules of Snap's text layer now exist under `ts/src/text/`: the §4.4 tokenizer, the §4.4 edit-script value space (validate/apply/coalesce), the §5 canonical diff, and the §6.3 inclusion transform. They form the shared vocabulary every later consumer needs — `commit` change authoring, `diff` display, §4.5 validation, and §6.2 replay integration — while adding no CLI surface: the acceptance landscape is unchanged (01/02/14/24 green; 03/19 still fail first at their `commit` steps), and the unit suite grew from 215 tests / 34 suites to 271 / 45, all green.

## Plan Realized

### text-core

Plan `dev-docs/plans/approved/text-core.md` was realized as written: all six tasks completed, module layout, algorithms, error fragments, and test pins per the plan. One deviation in task 4: the plan's fast-check convergence oracle asserted symmetric TP1 equality (`apply(apply(o,Q),T(P,Q)) === apply(apply(o,P),T(Q,P))`), which is false under §6.3's directional Q-insert priority — with base `[]`, P inserting `a\n`, Q inserting `b\n` yields `["b\n","a\n"]` vs `["a\n","b\n"]`. §6.5's convergence guarantee comes from replaying patches in canonical order (§6.1), not from transform symmetry. The oracle was replaced with a spec-true one-directional reference merge (see Tests).

## Implementation

- `ts/src/text/tokens.ts` — `tokenize(text): string[]` splits immediately after every LF via an `indexOf('\n')` loop (LF retained in the token; empty text → `[]`; final LF-less segment is its own token; `join('')` round-trips). `isCanonicalTokenSequence(tokens)`: tokens nonempty, LF only as a token's final byte, every token except possibly the last ends in LF.
- `ts/src/text/edit.ts` — owns the edit-script value space. `EditOp` is the one-key wire union (`{retain: n} | {delete: n} | {insert: readonly string[]}`), moved here from `repo/model.ts`, which now imports the type and keeps `decodeEditOp` (JSON decoding stays in the repository model). `coalesceEditScript` merges adjacent same-kind operations. `validateEditScript(context, ops)` throws `SnapError` with the caller-supplied prefix: positive safe integers, nonempty canonical insert lists (a non-final insert's last token must end in LF), no adjacent same-kind. `applyEdit(context, ops, oldTokens)` validates, then requires the retain+delete total to equal `oldTokens.length` exactly (`does not consume old content` / `consumes beyond old content`, suite-pinned fragments), then walks once to build the result.
- `ts/src/text/diff.ts` — `diffTokens(old, new): EditOp[]`: identical fast path (`[]` or one retain), common-prefix trim only (never suffix — the `[b] -> [a,b,b]` counterexample is pinned), then `walk()`: intern both sides to integer ids via a per-call `Map<string, number>` into `Int32Array`s, fill the full suffix DP `D(i,j)` per the §5 recurrence, walk forward from (0,0) — retain on equal, delete on tie (`D(i+1,j) <= D(i,j+1)`), insert otherwise, tails delete/insert the remainder — and coalesce.
- `ts/src/text/transform.ts` — `transformEdit(p, q): EditOp[]`: asserts both scripts' retain+delete totals match (plain `Error` — a caller defect, exit-2 channel, not an expected failure), then a two-stream cursor loop with per-op offsets: Q-insert first (`{retain: q.insert.length}` — the priority rule), P-insert passthrough, retain/retain → retain(min), delete/retain → delete(min), retain/delete and delete/delete → nothing; desync is unreachable under the precondition and guarded. Output coalesced.
- `ts/src/repo/model.ts` — the `EditOp` definition replaced by a type-only import from `text/edit.ts`; no other file changed outside `ts/src/text/`.

## Behavior

Pure functions only: `string[]`/`EditOp[]` in, values out — no filesystem, CLI, or JSON involvement, and nothing under `text/` is reachable from `main.ts`, so CLI runtime behavior is unchanged from the CLI-skeleton issue. Downstream channels are set by error type: script well-formedness and consumption failures are `SnapError`s (expected, exit 1, `snap: <context> <fragment>`), surfaced later by repository validation with a path context prefix; a `transformEdit` precondition violation is a plain `Error` (internal defect, exit 2). Determinism is total: same inputs, same script bytes — the delete-on-tie walk and coalescing fix the output among equally minimal diffs.

## Tests

Colocated `src/text/*.test.ts`, node built-in runner with `fast-check` oracles; suite totals 271 tests / 45 suites green (`npm run check`).

- `tokens.test.ts` — `"a\r\nb"` split after the CRLF's LF, empty file, missing final LF, BOM preserved in the first token, multi-byte and consecutive-LF inputs, join round-trip.
- `edit.test.ts` — adjacent same-kind, empty insert, non-canonical inserted tokens (interior LF; non-final insert without trailing LF), under/over-consumption with exact pinned fragments and context prefixes, empty script only against an empty base, apply goldens, coalescing cases.
- `diff.test.ts` — the three stack-pinned goldens (`a b a -> b a a`, the tie `["a\n","b\n"] -> ["b\n","a\n"]`, the suffix-trim counterexample `["b\n"] -> ["a\n","b\n","b\n"]`), identical/empty fast paths, prefix-trim behavior, fast-check `applyEdit(diff(old,new), old) === new`, and a no-adjacent-same-kind property.
- `transform.test.ts` — one case per §6.3 table row (Q-insert row expects the coalesced `{retain: 2}`), Q-insert priority at a shared cursor, trailing inserts, insert survival across deletion, empty/empty, precondition throw; properties: P-insert survival and full consumption of the post-Q sequence (both from the plan verbatim), plus the reformulated oracle: `applyEdit(transformEdit(p, q), applyEdit(q, base))` must equal a positional `referenceMerge(base, p, q)` that emits per cursor Q's inserts before P's and keeps a base token only when both scripts retain it. The symmetric TP1 equality is deliberately absent — it is false under §6.3 (pinned by the counterexample above).

## Decisions

- **The convergence oracle reformulation (recorded deviation).** The plan asserted symmetric TP1 convergence; under a directional insert priority that identity is mathematically false, and the counterexample (empty base, one insert per side) falls out of the spec's own tie rule. The replacement oracle checks the property §6.3 actually grants: the transform reproduces the canonical context-first merge. Lesson for plan authoring: claimed algebraic identities should be checked against the spec's tie-breaking rules before being written into oracles.
- **`cell()` typed-array accessor.** `noUncheckedIndexedAccess` types `Int32Array` reads as possibly `undefined`, and non-null assertions are banned in `src/`. Every DP/walk read goes through `cell(values, index)` (`.at()` plus an out-of-range guard throwing a plain `Error`). Indices are in range by construction, so the guard is a defect tripwire, not a validation rule.
- **Prefix trim is equivalence-preserving by the walk rule itself.** The walk retains on token equality regardless of D, so trimming the common prefix and prepending `{retain: prefix}` provably equals walking it; only the divergent suffix reaches the `O(n·m)` table.
- **Interning stays a private per-call detail of `diffTokens`.** Only equality is needed in the table; ids never leak into the output, so no shared intern table exists (plan feedback #4, held as decided).

## Follow-Up

- Consumers in dependency order: repository validation (§4.5 step 5 calls `applyEdit` with a path context, reusing the pinned fragments verbatim), §6.2 replay (`transformEdit` once per patch/path against the aggregate context edit), everyday commands (`diff` display, `commit` change authoring, `revert`), §7.6 unified-diff formatting.
- When replay lands, the §6.5 convergence property gets its real exercise at the integration level (tests/18 merge-direction invariance); the unit-level reference-merge oracle covers the transform in isolation until then.
- Phase 8's random causal patch-graph property tests (import-permutation invariance) build directly on these modules; none of that machinery landed here, per the issue's scope.
