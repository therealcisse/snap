---
title: Repository model and validation: canonical codec, structural equality, trees, §4.5 checks, linear replay
date: 2026-09-05
author: agent
id: repo-model-and-validation
issue: repo-model-and-validation
research:
- snap-performance-and-data-structures
designs:
- snap-ts-architecture
completed: 2026-09-05
closeout_notes: true
---

## Context

Issue `repo-model-and-validation` captures stack `snap-1.0`'s Repository model and validation section: everything between decoding `repository.json` and trusting it. SPEC §4.5 demands six validation steps before any command uses a repository; today only step 1 exists (strict decode in `repo/model.ts`). This plan lands the remaining model machinery — canonical encode, dot structural equality, the tree value, §4.5 steps 2–5, and the linear-history subset of replay as step 6 — as a pure repo layer with no CLI wiring, exactly as the issue's Out of Scope draws the boundary.

## Current State

- `ts/src/repo/model.ts` — decode only: `Patch`/`Change`/`Repository` types, `decodeRepository` with exact schema (§4.5 step 1), `decodeEditOp`, private `resultVersion`, `knownVersionKeys`, and the `EMPTY_REPOSITORY_JSON` literal (line 71) whose comment says the general encoder "lands with the Repository model issue". No encode, no structural-equality serialization.
- `ts/src/core/json.ts:310` — `finishObject` already yields `repository has unknown field: unknown` from the general template; `versionFromPairs` (`core/version.ts:220`) yields `is not in canonical order`; `decodeBase64` (`core/bytes.ts:72`) enforces canonical base64 — all pinned by tests/23 and already correct.
- `ts/src/text/edit.ts` — `validateEditScript`/`applyEdit` supply `does not consume old content` / `consumes beyond old content` with a caller-supplied prefix, but the adjacency fragment reads `has adjacent operations of the same kind`, and tests/15:242 pins `adjacent insert` — a substring mismatch this plan must fix.
- Nothing exists at `ts/src/repo/tree.ts`, `validate.ts`, or `replay.ts`.
- Unit suite: 271 tests / 45 suites green. Acceptance landscape: 01/02/14/24 green; tests/15 and tests/23 fail at their first `status` step (`snap: not implemented: status`) with every pinned fragment unenforced; tests/27 passes **vacuously** — all its steps expect exit 1 plus the generic pattern `^snap: .+\n$`, which the not-implemented stub happens to satisfy.

## Developer Feedback

The interview was skipped: the issue's approved boundary plus the spec's pinned fragments force every choice. Recorded plan-author calls:

1. **Repo layer only; no `status` wiring.** Suites 15/23 drive validation through `snap status`, but a real §7.3 status needs the working-tree scan and A/M/D output — the working-tree issue's core. Rejected: landing a minimal `status` here to green 15/23 early — it violates the issue's Out of Scope and drags `fs/worktree.ts` decisions in. The roadmap's Phase-4 gate "suites 15/23/27 green" was optimistic; this plan records that deviation and pins every fragment in unit tests so the wiring step surfaces them verbatim.
2. **§4.5 step 5 lives inside replay's integration walk.** Change-vs-base checks need each patch's materialized exact base, which is replay's machinery; duplicating a materialize walk in `validate.ts` would double the cost. `validate.ts` owns steps 2–4 and orchestration; `replay.ts` performs the per-change checks while integrating. Rejected: a separate validation-only materialization.
3. **`tree.ts` lands only what §4.5 needs** — type, byte-ordered iteration, ancestor set, prefix-free assertion. The §6.2 namespace ancestor/descendant queries are deferred to the concurrent-replay issue. Rejected: landing queries with no consumer.
4. **Concurrent-ready histories are rejected for now.** Replay integrates only when `I == base` (the linear shortcut). A valid concurrent history (impossible to produce through the CLI before `merge` exists; no suite pins it) fails with a clear `snap:` error until the merge issue completes §6.1/§6.2. Rejected: implementing OT integration here — next section's scope.
5. **Fix the adjacency fragment in `text/edit.ts` to kind-specific wording** (`has adjacent insert operations`, and the retain/delete analogues); tests/15 pins `adjacent insert`, which the generic phrase cannot satisfy. Rejected: keeping the generic phrase and pattern-matching later — the substring simply never matches.
6. **`encodeBase64` goes in `core/bytes.ts`** next to its decode twin, per the architecture design's module description; `put` encoding is its only consumer.

## Approach

1. **`core/bytes.ts`** — add `encodeBase64(bytes): string` (standard padded RFC 4648 via `Buffer`, canonical by construction; round-trip test with `decodeBase64` including empty and arbitrary bytes).
2. **`repo/model.ts` encode** — `encodeRepository(repository): string`: two-space indent, trailing LF, fixed field order (`format`, `frontier`, `patches`; per patch `author`, `revision`, `base`, `message`, `changes`; per change `type`, `path`, then `edit`/`content`), versions as `[[id,rev],…]`, strings escaped with `JSON.stringify` (locked decision 4 permits it for output). `encodePatch(patch)` is exported as the canonical structural-equality form for dot comparison (§4.2): same parsed value ⇒ same bytes. `encodeRepository` on an empty repository must equal the `EMPTY_REPOSITORY_JSON` literal byte for byte.
3. **`repo/tree.ts`** — `type Tree = ReadonlyMap<string, Uint8Array>`; `sortedPaths(tree)` in byte order; `ancestorSet(path)` (all proper `/`-prefixes as segments); `assertPrefixFree(tree)` throwing `tree paths conflict: <a> and <a/b>` (contains the pinned `tree paths conflict`). Iteration and lookups only — no mutation helpers yet.
4. **`repo/validate.ts`** — `validateRepository(repository): void` owning §4.5 steps 2–4 over a decoded value:
   - Step 2: for each frontier component `(c, n)`, patches by `c` are exactly revisions `1..n` — a gap or a base naming an absent dot throws `repository is missing <c>-><k>` (contains the pinned `missing a@x`); a patch not selected by the frontier throws `unreachable patch: <c>-><r>` (full message pinned by tests/23:88); two patches at one dot throw `duplicate dot: <c>-><r>`; patches must sort by `(author bytes, revision)`.
   - Step 3: every patch's base dots all exist under the step-2 rule; `revision = base[author] + 1` or `revision does not follow base: <c>-><r>`.
   - Step 4 is subsumed: cycles surface as replay's no-ready-patch failure (step 6), per SPEC §4.5's closing sentence.
   - Then it calls `replayRepository(repository)` for steps 5–6.
5. **`repo/replay.ts`** — `replayRepository(repository): { tree: Tree; warnings: [] }`: selection loop over the ready set (base ≤ integrated vector `I`), which on valid linear histories always has exactly one member (`I == base`, so the running tree `C` is the patch's exact base `B` — no memo needed yet); integration applies each change against `C` performing §4.5 step 5:
   - `put`/text-create on a present path → `creates existing path: <path>`; `delete` of an absent path → `delete of absent path: <path>` (exact, unprefixed — tests/23:302); text change requires the base file to be text → `text change on non-text base: <path>`;
   - text edits run through `applyEdit` with context `repository.patches[i].changes[j].edit`, surfacing the pinned consumption and script fragments verbatim;
   - each change must alter presence or bytes (§4.3) → `no-op change: <path>`, except an empty text edit creating an empty file;
   - the patch's authored result must be prefix-free via `assertPrefixFree` (pinned `tree paths conflict`).
   If no patch is ready before the frontier is reached → `cyclic or incomplete patch history` (pinned, tests/15:185). If more than one patch is ready (true concurrency) → the interim `concurrent replay is not implemented yet` `SnapError` (decision 4).
6. **`text/edit.ts` fragment fix** — adjacency errors become `${context} has adjacent ${kind} operations` with `kind ∈ retain | delete | insert`; update `edit.test.ts` accordingly.

## Tasks

- [ ] `ts/src/core/bytes.ts`: add `encodeBase64`; extend `bytes.test.ts` with round-trip against `decodeBase64` (empty, `YQ==`, arbitrary bytes) and canonical-spelling equality.
- [ ] `ts/src/repo/model.ts`: add `encodeRepository` and `encodePatch` with the canonical field order; `model.test.ts`: `encodeRepository` of the empty repository equals `EMPTY_REPOSITORY_JSON` exactly; decode∘encode round-trip on a populated repository; two sources with different whitespace/key order that decode to the same value encode identically (dot structural equality).
- [ ] `ts/src/repo/tree.ts` + `tree.test.ts`: `Tree`, `sortedPaths`, `ancestorSet`, `assertPrefixFree` (golden pass case; conflict case asserting the exact `tree paths conflict: a and a/b` message; byte-order iteration golden with a multi-byte path).
- [ ] `ts/src/repo/validate.ts` + `validate.test.ts`: steps 2–3 with exact messages — `repository is missing a@x->1` (gap and base-naming-absent), `unreachable patch: a@x->2`, `duplicate dot: a@x->1`, sort-order rejection, `revision does not follow base: a@x->1`; orchestration into replay.
- [ ] `ts/src/repo/replay.ts` + `replay.test.ts`: linear golden (put, text edit, delete chains) returning the frontier tree with no warnings; step-5 messages asserted exactly — `creates existing path: f`, `delete of absent path: f`, `text change on non-text base: f`, `no-op change: f`, `does not consume old content` and `consumes beyond old content` with the `repository.patches[i].changes[j].edit` context prefix, `tree paths conflict`; no-ready case asserting `cyclic or incomplete patch history` (the tests/15 cycle fixture verbatim); empty-edit-creates-empty-file accepted.
- [ ] `ts/src/text/edit.ts`: adjacency fragment to `has adjacent insert/retain/delete operations`; update `edit.test.ts` and any `transform.test.ts` expectations that pin the old phrase.
- [ ] `cd ts && npm run format && npm run check` green (suite grows from 271 tests / 45 suites).
- [ ] `./verify --lang ts`: 01/02/14/24 still green; tests/15 and tests/23 still fail first at `snap: not implemented: status` (unchanged — no wiring); tests/27 still green; `--list` shows 32.

## Documentation Impact

None. `ts/AGENTS.md` already lists `repo/` (model, tree, validate, replay) in its Layout section; no CLI-visible behavior changes.

## Acceptance Tests

- `cd ts && npm run check` green, with unit tests pinning every fragment tests/15 and tests/23 pin — `duplicate JSON key` (existing), `repository has unknown field: unknown` (existing), `is not in canonical order` (existing), `.+positive safe integer` (existing), `.+message is empty` / `.+changes is empty` (existing), `.+must have one operation` / `.+insert is empty` (existing), `missing a@x`, `unreachable patch:`, `tree paths conflict`, `cyclic or incomplete patch history`, `no-op change`, `delete of absent path: f`, `adjacent insert`, `does not consume old content`, `.+consumes beyond old content` — so the future `status` wiring surfaces them verbatim.
- `./verify --lang ts` from the repository root: landscape unchanged (01/02/14/24 green; 15/23 fail first at `not implemented: status`; 27 green; `--list` = 32).
- `encodeRepository(decodeRepository(EMPTY_REPOSITORY_JSON)) === EMPTY_REPOSITORY_JSON`.
