---
title: Cross-repository diff: snap diff <old> <new> --repo <repository> — realized
date: 2026-09-05
author: agent
id: cross-repository-diff
issue: cross-repository-diff
plan: cross-repository-diff
---

## Summary

Snap's third diff form now exists: `snap diff <old> <new> --repo <repository>` (SPEC §7.6, §9) compares a locally resolved `old` against a `new` resolved in another repository — a local path to a repository root or an `http://`/`https://` URL fetched by one exact validated GET — without importing anything. The dot check that guards shared history across two repositories landed as a reusable validation helper, the loader gained an explicit-root arm, the CLI boundary went async at one seam, and the diff halves of tests/13, tests/16, and tests/26 are green. The `merge` strand remains the suites' only red steps.

## Plan Realized

### cross-repository-diff

All seven tasks of `dev-docs/plans/approved/cross-repository-diff.md` landed. Deviations from the plan's approach:

- The tests/26 regression step uses a fresh `local2` repository rather than having `local` commit its own version: the suite's closing asserts pin `local/.snap/repository.json` as empty and the `local` tree as containing only `.snap/repository.json`, so mutating `local` would break them. A YAML comment documents the §7.6 intent (an `old` the operand has never seen still diffs).
- Beyond the plan's task list, `main.test.ts` needed updating: its pin `not implemented: diff () () --repo other` described behavior this plan removed. It now asserts the operand resolution failure (`snap: not a Snap repository`) plus the still-accurate `not implemented: merge other`.
- Unit tests added two cases the plan's matrix did not name: a reordered-JSON-keys shared dot passes (structural equality, mirroring tests/26's duplicate fixtures), and the HTTP malformed-body rejection is matched by name and `/invalid JSON/` pattern rather than exact message — `client.test.ts` owns the exact client vocabulary.

## Implementation

- `ts/src/repo/validate.ts` — `assertNoPatchCollisions(local, remote): void`. Builds `remote`'s `author->revision → encodePatch` map, then walks `local.patches`, which §4.5 step 2 keeps ascending by author byte order then revision; the first shared dot whose `encodePatch` strings differ throws `SnapError('patch collision: <author> revision <n>')`, so multiple collisions report the least dot in byte order — the same determinism as every other multi-failure check in the module.
- `ts/src/fs/locate.ts` — `loadRepositoryAtRoot(root): LoadedRepository` reads `<root>/.snap/repository.json`, decodes strictly, validates (§4.5), and returns `{root, repository, replay}`; an unreadable file is the location failure `not a Snap repository`. `loadValidatedRepository(startDir)` is unchanged in behavior: the nearest-root walk (`findRepositoryRoot`) delegating to the new loader.
- `ts/src/commands/diff.ts` — `diffCrossRepository(oldVersion, newVersion, cwd, operand): Promise<CommandOutput>`. Order: load and validate the nearest local repository; resolve the operand through the private `loadRepositoryOperand` — an `http://`/`https://` prefix goes to `fetchRepository` (§9's single GET, already validated), anything else is a repository-root path resolved with `resolve(cwd, operand)` into `loadRepositoryAtRoot`; resolve `old` against local and `new` against the operand (§7.6); run `assertNoPatchCollisions`; materialize each tree from its own repository; render through the pre-existing private §5 pipeline unchanged.
- `ts/src/cli/main.ts` — `execute` is now `async` returning `Promise<CommandOutput>`; `run` does `emit(await execute(command, argv, ctx))` inside the existing try/catch; the `diff` case routes `repo !== undefined` to `diffCrossRepository` and the `notImplemented` branch for it is gone (`merge` keeps its own).
- Tests — `ts/src/repo/validate.test.ts` (5 new cases: equal shared dots, reordered keys, disjoint dots, differing message/edit/content, least-dot ordering), `ts/src/commands/diff.test.ts` (6 new: local happy path that doubles as the old-local pin, unknown old, unknown new, collision, HTTP happy path against a canned-origin server, HTTP malformed body), `ts/src/cli/main.test.ts` (updated routing pin), `tests/26-portability-and-failure-safety.yaml` (the `local2` regression step with exact two-tree stdout).

## Behavior

- From inside a repository, `snap diff "<old>" "<new>" --repo <operand>` with a path operand reads that repository root's `repository.json`; with a URL operand it issues exactly one GET of the exact URL, requires 200, follows no redirects, and strict-parses and §4.5-validates the body. Both repositories are fully trusted values before any version resolves.
- Resolution is split: `old` must be known to the local repository, `new` to the operand repository. An `old` the operand has never seen succeeds — it never resolves there. Unknown versions fail `unknown version: <operand text>`; `old` fails first, mirroring `diffVersions`.
- The dot check runs before either tree materializes, so a corrupt pairing fails whole with `snap: patch collision: <author> revision <n>`, exit 1, empty stdout — no half-printed diff. All failures (outside a repository, unreadable operand, malformed body, invalid history, unknown version, collision) funnel through `run`'s single catch as `snap: <detail>` with exit 1.
- Output is the canonical §5/§7.6 rendering already pinned by tests/05–06: whole-file blocks in path byte order, `/dev/null` sides, `\ No newline at end of file`, `Binary files … differ`. Neither repository is written; HTTP is read-only.

## Tests

`cd ts && npm run check`: 407 tests / 86 suites green. New coverage as listed under Implementation. Acceptance: `--filter 13` — the `diff "()" "(remote@x->1)" --repo <served URL>` step passes with exact stdout, first failure is the following `merge` step; `--filter 16` — the diff collision step passes with the pinned stderr, first failure is the merge step; `--filter 26` — both local-path diff steps (including the new `local2` step) and the malformed-HTTP-operand step pass, first failure is the closing `http_requests_equal` that expects merge's GET too. Full `./verify --lang ts`: 19 green / 13 red — the identical green set as the main baseline; every red suite fails only in the merge strand (plus the pre-existing tests/28 presentation strand).

## Decisions

- `old` resolves locally, `new` in the operand (plan interview; SPEC §7.6 is authoritative over the issue's looser prose). Pinned publicly by tests/26's new step and in unit tests.
- Dot identity is `encodePatch` string equality — §4.2's canonical serialization is the structural-equality unit the spec names, and string comparison avoids a second structural-equality implementation.
- The check walks `local.patches` and maps `remote`: §4.5 step 2 already sorts patches, so iteration order yields byte-order-first failure reporting for free; only one side needs the Map.
- The tests/26 regression step carries its own fresh repository (`local2`) — documented above; the suite's no-mutation asserts on `local` are load-bearing.
- Operand classification stays a private helper in `commands/diff.ts` until `merge` becomes the second consumer, per the plan's feedback: extracting now would be speculative, and putting it in `fs/locate.ts` would create the `locate → http/client` layering cycle.
- One async seam: `execute` returns a promise and `run` awaits it; the command stays pure (arguments in, `CommandOutput` out, no stream writes), and `serve` keeps its existing carve-out.

## Follow-Up

- The merge strand (§7.8) should reuse `assertNoPatchCollisions` for its dot-keyed union and extract the operand resolver from `loadRepositoryOperand` at that point.
- tests/13, tests/16, and tests/26 go fully green when `snap merge <url>` lands — including tests/26's closing `http_requests_equal`, which expects one GET from each of merge and diff.
- Terminal presentation for diff output (§7.11, tests/28) remains its own stack item.
