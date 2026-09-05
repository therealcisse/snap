---
title: Repository model and validation: canonical codec, structural equality, trees, §4.5 checks, linear replay — realized
date: 2026-09-05
author: agent
id: repo-model-and-validation
issue: repo-model-and-validation
plan: repo-model-and-validation
---

## Summary

Snap can now vouch for and reproduce a repository: `repo/model.ts` gained the canonical encoder that is the byte-exact inverse of its strict decoder plus a compact per-patch form for dot structural equality; `repo/tree.ts` defines the materialized tree value and its prefix-free invariant; `repo/validate.ts` runs §4.5's cross-patch checks (patch order, dot uniqueness, revision rule, base closure, frontier match); and `repo/replay.ts` materializes the frontier tree of any valid linear history, performing §4.5 step-5 change-vs-base checks during integration. This is the pure repo layer every later command stands on — no CLI wiring yet, by the issue's boundary.

## Plan Realized

### repo-model-and-validation

All eight tasks of `dev-docs/plans/approved/repo-model-and-validation.md` landed. Deviations from the plan's approach:

- `creates existing path: <path>` was dropped: under §4.3 a change's presence context is self-selected by its type, so a create-shaped change against a present path is always caught earlier by `applyEdit`'s consumption rules or the no-op check — the message is unreachable.
- `validateRepository` returns the `ReplayResult` instead of `void`, so command wiring validates and materializes the tree in one pass.
- `ancestorSet` is named `ancestorPaths` (it returns a list, not a `Set`).
- The interim concurrency guard also rejects a lone ready patch whose base is strictly before `I` — defensively, since the >1-ready check makes that state unreachable in practice.

## Implementation

- `ts/src/core/bytes.ts` — `encodeBase64(bytes)` beside `decodeBase64`: `Buffer.from(view).toString('base64')`, canonical padded standard alphabet by construction; the round-trip property now runs through both functions.
- `ts/src/repo/model.ts` — encode layer walking the typed value into a plain JSON value tree with the spec's field order fixed by insertion order (`format`/`frontier`/`patches`; per patch `author`/`revision`/`base`/`message`/`changes`; per change `type`/`path` then `edit` or `content`): `encodeRepository` is `JSON.stringify(value, null, 2) + '\n'` and byte-equals `EMPTY_REPOSITORY_JSON` for the empty repository; `encodePatch` is the compact form used for §4.2/§3.5 dot structural equality; `resultVersion` is exported (replay advances `I` with it).
- `ts/src/repo/tree.ts` — `type Tree = ReadonlyMap<string, Uint8Array>`; `sortedPaths` (byte order); `ancestorPaths` (proper `/`-segment prefixes, shortest first); `assertPrefixFree` walking paths in canonical order so the reported pair and its order are deterministic: `tree paths conflict: <ancestor> and <path>`. Namespace ancestor/descendant queries deferred to the concurrent-replay issue.
- `ts/src/repo/validate.ts` — `validateRepository(repository): ReplayResult` running, in order: patch sort + duplicate dot (one pass over `(author bytes, revision)`), the revision rule (`revision = componentOf(base, author) + 1`), base closure (every base-named dot exists), then replay, then the frontier match (a frontier beyond the patches names the first missing revision; a patch beyond the frontier is unreachable). Steps 5–6 are delegated to replay, per the plan's no-double-materialization decision.
- `ts/src/repo/replay.ts` — `replayRepository(repository): ReplayResult` with a ready-set loop (`base ≤ I` via `compareVersions`), pending patches keyed `author->revision` (unambiguous: §3.1 forbids `->` in IDs) with decode-time indices for error context. On the linear subset exactly one patch is ever ready with `I == base`, so the running tree is the patch's exact base and integration is plain application. Per change: `delete of absent path`, `text change on non-text base`, `applyEdit` with context `repository.patches[i].changes[j].edit` (surfacing the pinned consumption and script fragments), byte-equality no-op check (with the absent-to-present empty-file exception), then `assertPrefixFree` on each patch result. No ready patch → `cyclic or incomplete patch history`; concurrency → interim `concurrent replay is not implemented yet`. `WarningReason`/`WarningPair` (§6.4 vocabulary) are defined; warnings are always `[]` until §6.2 exists.
- `ts/src/text/edit.ts` — adjacency errors name the kind: `<context> has adjacent insert|retain|delete operations`, making the tests/15:242 `adjacent insert` fragment reachable.

## Behavior

- Validation error ordering is a contract, fixed by the acceptance fixtures: decode (step 1) → patch order/duplicate dot → revision rule → base closure → replay (steps 5–6) → frontier match. The tests/15 missing fixture (frontier `a@x->2`, only patch `a@x->2` based on `a@x->1`) therefore fails closure with `repository is missing a@x->1`, never a frontier-gap message; the cycle fixture fails replay with `cyclic or incomplete patch history`, never the frontier gap it also contains; tests/23's unreachable fixture (frontier `[]`, patch `a@x->1`) integrates cleanly and fails only the frontier match with `unreachable patch: a@x->1`.
- Replay processes the whole patch set rather than a frontier-selected subset — a selection would silently drop exactly the unreachable patches validation must report.
- All failures are `SnapError` with the spec's exact detail text; the CLI boundary later renders them as `snap: <detail>` with exit 1. Nothing here does I/O, mutation, or CLI output.
- `encodeRepository(decodeRepository(x))` is byte-identical for canonical input, and `decodeRepository(encodeRepository(...))` round-trips structurally: one byte sequence, one spelling, everywhere.

## Tests

`cd ts && npm run check`: 322 tests / 58 suites green (from 271/45). New coverage: `encodeBase64` (fixed spellings, subarray views, round-trip property); `encodeRepository` (empty-repo byte equality with `EMPTY_REPOSITORY_JSON`, structural round-trip, fixpoint, pinned field order), `encodePatch` (compact form, canonical base64 re-encode, provenance-independent equality), `resultVersion` (replace-in-place, insert-in-order); `tree` (byte-order iteration, ancestor cases, prefix-free accept/reject with the exact pinned message and insertion-order independence); `replay` (linear goldens across authors, empty-file creation, every step-5 message verbatim including both consumption fragments and adjacent-insert with full context, cycle/incomplete/interim-concurrency); `validate` (acceptance returning the tree, every step 2–4 message, and the three ordering-attribution fixtures above). Acceptance landscape unchanged: 01/02/14/24 green, 27 green (vacuously), 15/23 fail first at `snap: not implemented: status`, `--list` = 32 — the fragments surface verbatim the moment `status` wires decode→validate→replay.

## Decisions

- `creates existing path` not implemented — provably unreachable under §4.3 (see Plan Realized). Keeping dead wording in the plan's message list would have invited a dead check.
- `validateRepository` returns the replay result — every command needs the validated frontier tree; returning it removes the double replay a `void` signature would force.
- Error-attribution ordering is fixture-forced, not stylistic — the same broken repository can often be described by two checks; the spec's suite pins which one speaks. The ordering comments in `validate.ts` record why each precedence exists.
- Whole-set replay instead of frontier selection — §6.1 selection is trivial for materializing the frontier itself, and selection would hide unreachability.
- `equalBytes` stays private to `replay.ts` — one consumer today; promotion to `core/bytes.ts` waits for the worktree/diff work that needs it.
- Byte equality (not token equality) drives the no-op check — a text change that rewrites the same bytes through different tokens is still a no-op under §4.3.

## Follow-Up

- Working tree and everyday commands (stack section 5): wire `status`/`log`/`diff`/`commit` through decode → `validateRepository` → replay result; suites 15/23/27 then enforce the pinned fragments verbatim.
- Concurrent replay and merge (stack section 6): replace the interim error and `warnings: []` with §6.1 ready-set ordering, §6.2 integration (including the tree.ts namespace queries deferred here), §6.3 transform reuse, and the §6.4 warning set; the `WarningPair` vocabulary and the `I == base` shortcut's seam are already in place.
- Promote `equalBytes` to `core/bytes.ts` when a second consumer arrives.
