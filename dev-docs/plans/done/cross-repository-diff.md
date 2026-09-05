---
title: "Cross-repository diff: snap diff <old> <new> --repo <repository>"
date: 2026-09-05
author: agent
id: cross-repository-diff
issue: cross-repository-diff
research: []
designs: [snap-ts-architecture]
completed: 2026-09-05
closeout_notes: true
realized_design: cross-repository-diff
---

## Context

Issue `cross-repository-diff` (stack `snap-1.0`, HTTP section) asks for the `--repo` arm of `snap diff` (SPEC §7.6, §9): compare a locally resolved `old` with a `new` resolved in another repository — a local path to a repository root or an `http://`/`https://` URL fetched by one exact validated GET — without importing anything. Both producers landed in issue `http-server-and-client` (`snap --serve`, `fetchRepository`); local two-version diff and its rendering landed in issue `working-tree-and-everyday-commands`. What remains is operand classification and loading, the cross-repository dot check, version resolution split across the two repositories, and one async seam at the CLI boundary, because `fetchRepository` is a `Promise` while `execute` is synchronous.

Per the interview: `old` resolves and materializes from the local repository and `new` from the operand repository (SPEC §7.6's sentence is authoritative; the issue's "materialize both named versions from the operand repository" is loose prose). Public behavior gets one new regression step in tests/26.

## Current State

- `ts/src/cli/args.ts` already parses `--repo` completely (`parseDiff`, lines 103–119); the usage errors are pinned green by tests/24 and tests/14.
- `ts/src/cli/main.ts` `execute` (lines 96–102) routes `command.repo !== undefined` to `notImplemented(argv)` — the only dispatch blocker.
- `ts/src/commands/diff.ts` has the full rendering pipeline (`render`, `renderChange`, `renderScript`, `side`, `NO_NEWLINE`) and `diffVersions` for the local two-version form; all reusable unchanged.
- `ts/src/http/client.ts` `fetchRepository(url)` does §9 exactly: one GET, status 200 required, no redirects, strict §4.1 parse, §4.5 validation; unit-pinned with a canned-origin server in `client.test.ts`.
- `ts/src/fs/locate.ts` `loadValidatedRepository(startDir)` only loads via the nearest-repository walk; there is no loader for an explicit repository-root path.
- `ts/src/repo/model.ts` provides `resolveKnownVersion` and `encodePatch` (the §4.2 structural-equality unit); `ts/src/repo/replay.ts` provides `materializeVersion(repository, version)` for an already-validated repository.
- No cross-repository dot-check helper exists; tests/16's diff step (lines 49–58) pins its failure as `patch collision: a@x revision 1`, and the merge strand's dot-keyed union will need the same check.
- Red suites whose diff steps this plan turns green: tests/13 (lines 39–48), tests/16 (lines 49–58), tests/26 (lines 45–52 and 101–104). Their merge steps stay red until the merge strand lands.

## Developer Feedback

- **Semantics (user, interview):** follow SPEC §7.6 — `old` resolves and materializes locally, `new` in the operand repository. Rejected: both versions from the operand repository (the issue's literal phrase) — contradicts the canonical contract; no YAML case supports it.
- **Regression case (user, interview):** add one tests/26 step pinning that an `old` locally known but absent from the operand repository succeeds. Rejected: unit-test-only and no-test options — public behavior belongs in the shared suite.
- **Async seam:** make `execute` async (`emit(await execute(...))` in `run`, already `async`); the diff command body awaits operand resolution. Purity per design `snap-ts-architecture` survives: parsed arguments in, one `CommandOutput` out, no stream writes; `serve` keeps its long-running carve-out. Rejected: pre-resolving the operand in `run` (leaks diff grammar into the boundary, duplicates the serve special case); a conditionally-async command function.
- **Dot check placement:** a pure helper in `ts/src/repo/validate.ts` throwing `patch collision: <author> revision <n>`, so merge's dot-keyed union reuses it. Rejected: inline in `commands/diff.ts` (merge would duplicate it); exporting from `replay.ts` (it is validation, not replay).
- **Operand classification:** §7's rule (`http://`/`https://` prefix → `fetchRepository`; otherwise a local path resolved against the process working directory) lives in the diff command now; the merge strand extracts a shared resolver when it gains the second consumer. Rejected: `fs/locate.ts` importing `http/client.ts` (layering cycle: `http/client.ts` imports `repo/*`); a speculative shared `commands/operand.ts` with one consumer.

## Approach

1. **Dot check** — `ts/src/repo/validate.ts`: add `assertNoPatchCollisions(local: Repository, remote: Repository): void`. Build each side's `author->revision → encodePatch(patch)` map; for every dot key present in both, require string equality; on the first difference in byte order (author, then revision) throw `SnapError('patch collision: <author> revision <n>')`.
2. **Explicit-root loader** — `ts/src/fs/locate.ts`: extract `loadRepositoryAtRoot(root: string): LoadedRepository` (reads `<root>/.snap/repository.json`, decodes, validates; unreadable file → `not a Snap repository`); `loadValidatedRepository` becomes the nearest-walk wrapper delegating to it.
3. **Cross-repository command** — `ts/src/commands/diff.ts`: add `diffCrossRepository(oldText: string, newText: string, cwd: string, operand: string): Promise<CommandOutput>`. Order: load and validate the local repository (`loadValidatedRepository(cwd)`); resolve the operand — `http://`/`https://` prefix → `await fetchRepository(operand)`, else `loadRepositoryAtRoot(resolve(cwd, operand)).repository`; `resolveKnownVersion` for `old` against the local repository and for `new` against the operand; `assertNoPatchCollisions`; `materializeVersion` old from local and new from the operand; render through the existing private pipeline. Update the module doc comment (it currently says `--repo` stays at the boundary).
4. **Dispatch** — `ts/src/cli/main.ts`: `execute` becomes `async` returning `Promise<CommandOutput>`; `run` does `emit(await execute(command, argv, ctx))`; the `diff` case routes `repo !== undefined` to `diffCrossRepository` and drops the `notImplemented` branch.
5. **Unit tests** — `ts/src/repo/validate.test.ts`: collision pairs (identical patches pass; differing message/edit/content fail with the exact message; disjoint dots pass). `ts/src/commands/diff.test.ts`: local-operand happy path; `old` locally known but operand-unknown succeeds (the chosen semantics); unknown `new` in operand fails `unknown version`; collision fails; HTTP operand against a canned-origin server mirroring `client.test.ts` (200 valid repository, plus one malformed-body rejection).
6. **YAML regression** — `tests/26-portability-and-failure-safety.yaml`: after the existing `diff "()" "(remote@x->1)" --repo ../remote` step, add a step where the local repository has committed its own version and the operand has a different author's patch; `diff "(local@x->1)" "(remote@x->1)" --repo ../remote` succeeds with the exact two-tree diff, pinning that `old` never resolves in the operand.
7. **Verify** — `cd ts && npm run check`; `./verify --lang ts --filter 13`, `--filter 16`, `--filter 26`: each suite's diff steps pass and its first failure is a merge step; full `./verify --lang ts` regresses no green suite.

## Tasks

- [ ] Add `assertNoPatchCollisions` to `ts/src/repo/validate.ts` with the `patch collision: <author> revision <n>` error, dots compared by `encodePatch` equality, first difference in byte order.
- [ ] Extract `loadRepositoryAtRoot` in `ts/src/fs/locate.ts`; keep `loadValidatedRepository` as the nearest-walk wrapper with unchanged behavior.
- [ ] Add `diffCrossRepository` to `ts/src/commands/diff.ts` (operand classification, local-old/operand-new resolution, dot check, dual materialization, existing render) and update the module comment.
- [ ] Make `execute` async in `ts/src/cli/main.ts`, await it in `run`, and route `diff` with `repo` to `diffCrossRepository`.
- [ ] Unit tests in `ts/src/repo/validate.test.ts` and `ts/src/commands/diff.test.ts` covering the collision matrix, both operand kinds, and the chosen `old`-local semantics.
- [ ] Add the locally-known-`old` regression step to `tests/26-portability-and-failure-safety.yaml`.
- [ ] Run `cd ts && npm run check` and the filtered/full `./verify --lang ts` gates; record results.

## Documentation Impact

- `SPEC.md`: no change — §7.6 and §9 already fix the behavior; the contradiction was issue prose, not spec text.
- `AGENTS.md` (root and `ts/`): no change — no new module or convention; the layout is unchanged.
- `tests/26-portability-and-failure-safety.yaml`: one additive step (format-1 neutral, no new operation kinds).
- Stack `snap-1.0.md`'s HTTP item is checked by `Update stack`/`/close-issue` later, not by this plan.

## Acceptance Tests

- `cd ts && npm run check` — format, lint, typecheck, unit tests green.
- `./verify --lang ts --filter 13` — the `diff "()" "(remote@x->1)" --repo <url>` step passes (exact stdout); suite still fails at its first merge step.
- `./verify --lang ts --filter 16` — the `diff` step fails with `patch collision: a@x revision 1` as pinned; suite still fails at its merge step.
- `./verify --lang ts --filter 26` — both `diff --repo` local-path steps (including the new regression step) and the HTTP malformed-operand step pass; suite still fails at its merge steps.
- Full `./verify --lang ts` — no suite that is green today turns red.
