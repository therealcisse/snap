---
title: "Hardening: property tests, startup profile, scale smoke"
date: 2026-09-05
author: agent
id: hardening-property-tests
issue: hardening-property-tests
research:
  - snap-performance-and-data-structures
designs:
  - snap-ts-architecture
  - concurrent-replay-core
completed: 2026-09-05
realized_design: hardening-property-tests
closeout_notes: true
---

## Context

Issue `hardening-property-tests` (open, stack `snap-1.0`) carries the §11 hardening strand: a randomized enforcer for §6.5 convergence, a cold-startup profile, and a realistic-scale smoke. SPEC §11 says property tests "SHOULD generate valid causal patch graphs and verify that import permutations produce the same joined frontier, patch set, warnings, and tree"; today only hand-written fixtures cover any of it (issue Impact).

The design is forced to the library seam: `snap merge` (§7.8) is a sibling strand and not landed here, so "import permutations" reduce to the three order-insensitivity claims the landed core actually makes — `joinVersions` accumulated in any order yields the same joined frontier, the canonical `(author, revision)`-sorted patch set is permutation-invariant, and `replayRepository` over a permuted patch array yields identical tree bytes, warning set, and integration sequence. Startup and scale are measurement tasks recorded as research; no public behavior changes.

## Current State

- `ts/src/repo/replay.ts`: `replayRepository(repository, hooks?) → { tree, warnings, sequence }` replays every patch in §6.1 order; `materializeVersion(repository, version) → Tree` materializes a known version. `leastReady` iterates the waiting `Map` in insertion order but selects by `readyOrder` (Snap order, author bytes, revision), so input array order is unused — exactly what the property pins against regression (e.g., a future "first ready in iteration order" bug).
- `ts/src/repo/validate.ts`: `checkPatchOrder` requires the stored patch array sorted by `(author, revision)` — permuted arrays are only legal at the typed-value seam below `validateRepository`, which is where the property operates.
- `ts/src/repo/model.ts`: `Patch`/`Repository` shapes, `resultVersion`, `encodePatch` (canonical per-patch string for deep comparison). Changes: one per path, sorted by path in byte order.
- `ts/src/repo/tree.ts`: `sortedPaths`, `equalBytes`, `namespaceConflicts` — the generator uses these to keep every authored change valid against its materialized base.
- `ts/src/text/`: `tokenize`, `diffTokens` (§5), `applyEdit` — the generator authors canonical edits as `diffTokens(baseTokens, mutatedTokens)`, which consume the base exactly.
- `ts/src/core/version.ts`: `joinVersions`, `compareBytes` ordering, `versionKey`, `formatVersion`, `EMPTY_VERSION`.
- `fast-check ^4.9.0` is pinned (`ts/package.json`); precedent: `ts/src/text/transform.test.ts` property tests with small alphabets, `maxLength ≤ 8`, default `numRuns`.
- `ts/AGENTS.md`: `npm run check` is the gate; unit tests colocated `src/**/*.test.ts` under `node --test`; "keep the module graph small" is a standing convention.
- Missing: no property test over replay; no startup profile; no scale-smoke research note. `./verify --lang ts` currently 19/32 suites green; the landscape must be identical after this plan.

## Developer Feedback

Interview skipped per the skill's small-plan knob; the issue, stack, prior research, and codebase settle everything. Decisions from investigation:

1. **Property pins the library seam, not the merge command.** Chosen: assert the three order-insensitivity claims on `replayRepository` + `joinVersions` directly. Rejected: driving permutations through a merge harness — `snap merge` is unlanded (sibling strand) and merge behavior already belongs to the YAML suites.
2. **Generator builds valid graphs incrementally** (state machine over reached versions; each patch's base contains its author's previous dot, so the revision rule holds by construction; changes authored against `materializeVersion` of the base). Rejected: generate-and-filter-by-`validateRepository` — mostly-invalid samples, slow, poor concurrent-shape coverage.
3. **One new test file `ts/src/repo/replay.property.test.ts`.** Rejected: growing `replay.test.ts` — keeps deterministic fixtures and the property suite separable; rejected: any non-colocated test dir — breaks convention.
4. **One research note `dev-docs/research/snap-startup-and-scale-smoke.md`** holding the startup profile and the scale smoke, with the smoke generator embedded as a self-contained script. Rejected: committing a generator script under `ts/` — the layout has no scripts lane and scope discipline forbids new surface; rejected: two notes — one measurement session, one artifact.
5. **Property runtime kept tiny** (≤3 contributors, ≤8 patches, default `numRuns`), matching `transform.test.ts`. Rejected: large-graph runs in the unit lane — they tax every `npm run check` without adding invariance power.

## Approach

1. **Generator** (`fc` arbitrary → valid causal graph): maintain the list of reached versions, starting `()`. For each of up to 8 patches: pick an author from a ≤3-id pool and a base among reached versions whose author-component equals that author's current max (revision = component + 1); result = `resultVersion(patch)`. Materialize the base tree with `materializeVersion`; author exactly one change against it: create/put on a path from shared flat (`f0..f3.txt`) and nested (`n/a`, `n/b`, `n/c`) pools guarded by `namespaceConflicts(base, path).length === 0`, text-edit an existing text file (mutate its token list from a small alphabet, `edit = diffTokens(old, mutated)`), or delete an existing path. Shared pools make concurrent creates/edits/deletes collide — exercising §6.2 rules 1–4, the namespace rule, and §6.4 warnings. Single change per patch keeps per-patch path sorting trivial.
2. **Joined-frontier property**: folding `joinVersions` over `resultVersion`s in a random permutation equals the declared frontier (= the same fold in canonical order) — a random permutation drawn as `fc.uniqueArray(fc.nat({ max: n - 1 }), { minLength: n, maxLength: n })` or equivalent.
3. **Patch-set property**: sorting patches by `(compareBytes(author), revision)` is permutation-invariant, and `validateRepository` accepts the canonical repository — the generator's validity oracle, run every sample.
4. **Replay property**: `replayRepository({ format: 1, frontier, patches: permuted })` equals the canonical run on tree bytes (`sortedPaths` + `equalBytes` per path), `warnings` (`deepEqual`), and `sequence` (`encodePatch` strings, `deepEqual`).
5. **Startup profile**: ≥20 runs of `TMPDIR=$(mktemp -d) ./snap --version` (fresh cold cache each run) plus `./snap status` in a small repo; median/min/max wall-clock; module-graph probe (`process.moduleLoadList` length under tsx, with a static import-closure count as fallback); compared against research `snap-performance-and-data-structures` baselines; machine context recorded.
6. **Scale smoke**: embedded generator builds a 1 000-patch linear history over a 100-file tree (patch 1 creates 100 files; each later patch appends one line to file `i mod 100`) and a 2 000-line-file fixture with a scattered-edit second version; time `./snap status` (full §4.5 validation replay of 1 000 patches), `./snap log`, and `./snap diff <old> <new>` (the `O(n·m)` §5 wall).
7. **Research note**: method, embedded commands/scripts, numbers, comparison to the prior research's scale predictions, conclusions — measurements only, no implementation commitments.
8. **Gates**: `cd ts && npm run check`; `./verify --lang ts` before and after with an identical suite pass set.

## Tasks

- [ ] Add `ts/src/repo/replay.property.test.ts`: causal-graph generator (incremental state machine, ≤3 contributors, ≤8 patches, flat+nested path pools, `namespaceConflicts`-guarded creates, one change per patch authored against `materializeVersion`).
- [ ] Same file, property 1: joined frontier is invariant under permutation of `joinVersions` accumulation order and equals the declared frontier.
- [ ] Same file, property 2: canonical `(author, revision)`-sorted patch set is permutation-invariant; `validateRepository` accepts the canonical repository.
- [ ] Same file, property 3: `replayRepository` over permuted patch arrays yields identical tree bytes, warning set, and integration sequence (`encodePatch` comparison).
- [ ] `cd ts && npm run check` green, including the new file.
- [ ] Startup profile measured: ≥20 cold-`TMPDIR` `./snap --version` samples + `./snap status` in a small repo + module-graph probe; numbers captured for the note.
- [ ] Scale smoke executed: 1 000-patch/100-file repository and 2 000-line diff fixtures generated by the note's embedded script; `./snap status`, `./snap log`, `./snap diff <old> <new>` timed.
- [ ] Write `dev-docs/research/snap-startup-and-scale-smoke.md` (schema frontmatter: title/date/author/id; method, embedded scripts, numbers, machine context, comparison to research `snap-performance-and-data-structures`).
- [ ] Confirm `./verify --lang ts` pass/fail suite set identical before and after; record in the note.

## Documentation Impact

- New: `dev-docs/research/snap-startup-and-scale-smoke.md` (research artifact, `dev-docs-schema.md` frontmatter).
- No changes to `SPEC.md`, `README.md`, `TEST-HARNESS.md`, `tests/`, `test-harness/`, `ts/AGENTS.md`, root `AGENTS.md`. Language-specific unit tests are already sanctioned by root `AGENTS.md`; stack checkboxes move only via the close-issue flow.

## Acceptance Tests

- `cd ts && npm run check` passes with the new `replay.property.test.ts` (format, lint, typecheck, `node --test`).
- The three properties pass across repeated `npm test` invocations (fast-check default seed randomization).
- `./verify --lang ts`: identical suite pass set before and after (19/32 green, same suite ids).
- The research note contains measured numbers for cold `--version` startup (median of ≥20 fresh-`TMPDIR` runs), module count, 1 000-patch `status`/`log` timings, and the 2 000-line `diff` timing, with method reproducible from the note alone.
- Diff surface: exactly one new file under `ts/src/` (the property test) and one new research note; nothing else.
