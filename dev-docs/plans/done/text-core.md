---
title: Text core: tokens, edit scripts, canonical diff, inclusion transform
date: 2026-09-05
author: agent
id: text-core
issue: text-core
research:
- snap-performance-and-data-structures
designs:
- snap-ts-architecture
completed: 2026-09-05
closeout_notes: true
---

## Context

Issue `text-core` captures stack `snap-1.0`'s Text core section: the four pure modules under `ts/src/text/` that every later phase consumes — §4.5 step 5 validates changes by applying edit scripts to base tokens, §6.2's text rule needs the §5 diff and §6.3 transform, and the everyday commands (`diff`, `commit`, `revert`) display or author §5 scripts.

The technical design is authored here, bounded by three external authorities: SPEC §4.4/§5/§6.3 pin the semantics (the recurrence, the walk, the delete-on-tie rule, the six-row transform table with Q-insert priority), design `snap-ts-architecture` locks the module layout (`text/tokens.ts`, `text/edit.ts`, `text/diff.ts`, `text/transform.ts`) and algorithms (interned integer tokens in a flat `Int32Array`, suffix-table DP with forward walk, common-prefix trim only — no suffix trim, no Myers/Hirschberg), and research `snap-performance-and-data-structures` supplies the verified counterexamples the unit tests must pin. The layer is pure: `string[]` tokens and edit scripts in, values out; no filesystem, no CLI, no JSON parsing.

## Current State

- `ts/src/core/bytes.ts` — `compareBytes`, `isText`, BOM-preserving `decodeUtf8`/`encodeUtf8`, canonical `decodeBase64`, `isValidTrackedPath`. `ts/src/core/errors.ts` — `SnapError` (expected, exit 1) vs internal defect (exit 2).
- `ts/src/repo/model.ts` already defines `EditOp` as the one-key wire union (`{retain: n} | {delete: n} | {insert: readonly string[]}`, lines 22–26) and `decodeEditOp` (lines 189–215), which enforces the schema-level rules the validation suites pin: one operation, positive safe integer, nonempty insert tokens. `TextChange` carries `readonly EditOp[]`.
- Nothing under `ts/src/text/` exists. The §4.4 rules with no enforcer yet: adjacent same-kind operations, full consumption (under/over), canonical result shape of inserted tokens, and the empty-script-only-for-empty-file rule. No §5 or §6.3 implementation exists.
- `tests/15-repository-validation.yaml` pins `does not consume old content` (line 127); `tests/23-strict-validation-matrix.yaml` pins `consumes beyond old content` (line 271). Both surface during repository validation (next stack section), reported with a `.+` context prefix — the text layer must own these fragments with a caller-supplied prefix so the validation layer can reuse them verbatim.
- Unit suite today: 215 tests, 34 suites, green. Acceptance: 01/02/14/24 green; 03 and 19 fail first at their `commit` steps (by design, everyday-commands issue).

## Developer Feedback

The interview was skipped: every algorithmic choice is forced by spec or locked design decision, so this section records the plan-author calls and their rejected alternatives.

1. **Keep `EditOp` as the one-key wire union; move it to `text/edit.ts`.** The architecture design's layout owns the edit-script union in `text/edit.ts`, and the text layer must not import from `repo/`. `repo/model.ts` imports the type from its new home; `decodeEditOp` stays in model (JSON decoding is the repository model's job). Rejected: a `kind`-discriminated union — `decodeEditOp` already produces the one-key shape and `in`-narrowing over three variants is exhaustive. Rejected: leaving `EditOp` in `repo/model.ts` — inverts the layering and drags the JSON/model graph into the pure text core.
2. **Validation errors are `SnapError`s with a caller-supplied context prefix**, following the `parseJson` root-name precedent, and use the suite-pinned fragments `does not consume old content` / `consumes beyond old content`. New fragments (no suite pins them yet): `…are adjacent operations of the same kind` and `…must insert canonical tokens`. Rejected: returning a result union — every caller so far treats invalid scripts as expected failures.
3. **`transformEdit` documents its precondition** (both scripts consume one common base token sequence) and throws a plain `Error` if it is violated — a defect exiting 2 via `describeFailure`, not an expected failure. Rejected: taking the base tokens as a third argument to self-check — the precondition is structural (retain+delete totals) and cheaper to assert directly.
4. **Token interning is internal to `diff.ts`** (a per-call `Map<string, number>`), not an exported interning table. Research: only equality is used, interning is `O(n+m)`, and §5's output is unchanged. Rejected: an exported intern table — no second consumer exists.
5. **`fast-check` supplies two oracles** (diff apply round-trip; transform convergence), as a dev dependency only, per the architecture design's test strategy.

## Approach

Four pure modules, each landing with its colocated tests, in dependency order. Everything stays under `ts/src/text/` plus one import-line change in `ts/src/repo/model.ts`.

1. **`text/tokens.ts`** — `tokenize(text: string): string[]`, an `indexOf('\n')` loop splitting immediately after every LF, LF retained (§4.4); `isCanonicalTokenSequence(tokens)`: every token except possibly the last ends in LF and no token contains LF before its final byte. The empty string yields `[]`.
2. **`text/edit.ts`** — `EditOp` (moved from `repo/model.ts`); `coalesceEditScript(ops): EditOp[]` (merge adjacent same-kind, drop nothing else — no-op outputs are the caller's construction error); `validateEditScript(context, ops)`: adjacent same-kind forbidden, inserted tokens canonical except possibly the last token of the final operation, insert arrays nonempty; `applyEdit(context, ops, oldTokens): string[]`: validate, then one consumption walk — consumed count must equal `oldTokens.length` exactly (`does not consume old content` / `consumes beyond old content`), returning the result (canonical by construction). An empty script consumes zero tokens, so it applies only to an empty base — the empty-file creation case.
3. **`text/diff.ts`** — `diffTokens(oldTokens, newTokens): EditOp[]`: intern both sides to integer ids; fast paths for identical arrays (single retain), empty old (single insert), empty new (single delete); trim the common prefix (safe: §5 retains on equality); fill the full `Int32Array` suffix table `D(i, j)` per the §5 recurrence; walk forward from `(0,0)` — retain on equal, else delete when `D(i+1, j) <= D(i, j+1)`, else insert, tails insert/delete the remainder; coalesce. No suffix trimming ever.
4. **`text/transform.ts`** — `transformEdit(p: readonly EditOp[], q: readonly EditOp[]): EditOp[]`: left-to-right two-stream walk over the §6.3 table — Q-insert row first (priority), then P-insert, then the retain/retain, delete/retain, retain/delete, delete/delete rows with `min` splitting; process a trailing insertion with its applicable row until both streams end; coalesce the output.

## Tasks

- [ ] Create `ts/src/text/tokens.ts` (`tokenize`, `isCanonicalTokenSequence`) and `ts/src/text/tokens.test.ts`: `"a\r\nb"` → `["a\r\n", "b"]`, empty file → `[]`, `"a"` missing final LF, leading BOM stays in the first token, multi-byte and consecutive-LF inputs, round-trip `tokenize(decode(encode))`.
- [ ] Create `ts/src/text/edit.ts` (`EditOp`, `coalesceEditScript`, `validateEditScript`, `applyEdit`); move the `EditOp` definition out of `ts/src/repo/model.ts` into it and update model's import; `ts/src/text/edit.test.ts`: adjacent same-kind rejected, under-consumption (`does not consume old content`) and over-consumption (`consumes beyond old content`) with context prefixes, empty insert, empty script valid only against an empty base, inserted-token canonicality (interior LF; non-final insert without trailing LF), apply goldens, coalescing cases.
- [ ] Create `ts/src/text/diff.ts` (`diffTokens`) and `ts/src/text/diff.test.ts`: the `a b a -> b a a` golden (`delete 1, retain 2, insert ["a"]`), the true tie `["a\n","b\n"] -> ["b\n","a\n"]` (`delete 1, retain 1, insert ["a\n"]`), the suffix-trim counterexample `["b"] -> ["a","b","b"]` (`insert ["a"], retain 1, insert ["b"]`), identical/empty fast paths, prefix-trim behavior, and a fast-check property `applyEdit(diff(old, new)) === new` on small repeated-token alphabets.
- [ ] Create `ts/src/text/transform.ts` (`transformEdit`) and `ts/src/text/transform.test.ts`: one minimal case per §6.3 table row, Q-insert priority at a shared cursor, trailing inserts on one or both streams, delete-delete collapse, and a fast-check convergence oracle: with `P = diffTokens(o, a)` and `Q = diffTokens(o, b)`, `applyEdit(applyEdit(o, Q), transformEdit(P, Q))` equals `applyEdit(applyEdit(o, P), transformEdit(Q, P))`, plus P-insert survival.
- [ ] `cd ts && npm run format && npm run check` green (suites and tests grow from 215/34).
- [ ] `./verify --lang ts`: suites 01, 02, 14, 24 still green; 03 and 19 still fail exactly at their first `commit` step; `--list` shows 32.

## Documentation Impact

None. `ts/AGENTS.md` already lists `text/` with exactly these four modules in its Layout section; no CLI-visible behavior changes, so README, SPEC, and the drift check are untouched.

## Acceptance Tests

- `cd ts && npm run check` green — format, lint, typecheck, and the unit suite including the new `text/` tests with every stack-pinned case above.
- `./verify --lang ts` from the repository root: `01-init`, `02-init-paths`, `14-cli-errors`, `24-cli-grammar-matrix` pass; `03-configuration` fails first at `commit local-wins` and `19-version-boundaries` first at `commit one` (unchanged — the text core adds no CLI surface); `./verify --lang ts --list` counts 32.
- Spot checks in `edit.test.ts` assert the exact pinned fragments `does not consume old content` and `consumes beyond old content` so the repository-validation section can reuse them verbatim.
