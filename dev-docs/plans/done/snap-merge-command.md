---
title: Merge command — dot-keyed import, joined replay, and the warning difference
date: 2026-09-05
author: agent
id: snap-merge-command
issue: snap-merge-command
research: []
designs:
- snap-ts-architecture
completed: 2026-09-05
closeout_notes: true
---

## Context

Issue `snap-merge-command` (stack `snap-1.0`, Concurrent replay and merge + HTTP items) captures the missing `snap merge <repository>` (SPEC §7.8, §10): importing another repository's history — a local path or an `http://`/`https://` URL fetched by the strict §9 client — by dot-keyed union with collision detection, frontier join, canonical replay of the joined history, delta install, and the §6.4 new-warnings difference on stderr with the joined version on stdout. The replay core it sits on is complete: §6.1 ordering, §6.2 integration with namespace rules, §6.3 OT, and the §6.4 winner table and warning set all live in `repo/replay.ts` today. What is missing is the command and the cross-repository seams around it.

Scope ruling (user, at the draft gate): the `diff --repo` arm is owned by sibling approved plan `cross-repository-diff` (strand snap/diff-repo, merging immediately after this one), so this plan implements only the three seams that plan consumes — with exactly its names, signatures, placements, and error messages — plus the merge command itself. Suites 16 and 26 (and 13) go green when that strand lands; this plan records them as post-merge verification, following the `http-server-and-client` precedent.

## Current State

- `ts/src/cli/args.ts:74` parses `merge <repository>`; `ts/src/cli/main.ts:105` routes it to `findRepositoryRoot` + `notImplemented` — every targeted suite fails exactly there (`./verify --lang ts`: 19/32 green; unit baseline 396 tests / 83 suites green via `cd ts && npm run check`).
- Replay core complete: `repo/replay.ts` (`replayRepository`, `materializeVersion`, §6.4 warnings sorted by path then reason), returning `ReplayResult {tree, warnings, sequence}`; `repo/validate.ts` `validateRepository` also returns the frontier `ReplayResult`.
- Loading: `fs/locate.ts:80` `loadValidatedRepository(startDir)` — nearest-walk, decode, validate, one replay. No root-addressed loader, no operand classification.
- HTTP: `http/client.ts:27` `fetchRepository(url): Promise<Repository>` — single GET, 200-only, no redirects, full §4.5 validation; documented as the trust boundary for `diff --repo` and `merge`.
- Model/version: `repo/model.ts` (`encodePatch` structural equality — the §4.2 dot-identity unit; `encodeRepository`, `withPatch`), `core/version.ts` (`joinVersions`, `formatVersion`, `versionKey`).
- Mutation: `fs/materialize.ts` (`installTree` delta + `writeRepository` atomic replace), `fs/worktree.ts` (`scanWorkingTree`, least-offender errors). `commands/revert.ts` is the ordering precedent: checks, install working files, then metadata.
- Missing: operand resolver (path vs URL), root-addressed loader, cross-repository dot-collision check (`patch collision: <author> revision <n>`, pinned by tests/16), patch-set union + frontier join, the merge command body, and the async `execute` seam the URL operand needs.

## Developer Feedback

1. **Single plan** (user): pieces share one seam set and one acceptance gate; scale matches `http-server-and-client`.
2. **`diff --repo` scoped out** (user ruling at the draft gate): sibling approved plan `cross-repository-diff` owns that arm; this plan lands the shared seams exactly as that plan consumes them (`assertNoPatchCollisions` in `repo/validate.ts`; `loadRepositoryAtRoot` in `fs/locate.ts`; async `execute`). Rejected: keeping it in — duplicates and supersedes a user-approved plan for a one-strand head start on suites 13/16/26.
3. **Check order follows §10's sentence**: local validation → operand resolution/validation → collision check → joined replay → working-tree scan (unsupported-entry, then dirty) → install → metadata write. Rejected: scanning the working tree first (cheapest-first) — contradicts §10's listed order and the `revert.ts` precedent; no suite pins the reverse.
4. **Shared operand resolver extracted now** (`commands/operand.ts`): merge is the second consumer of URL-or-path classification, and the sibling plan explicitly sanctions the merge strand extracting it. Rejected: inline classification inside `merge` — the sibling would become a third copy.
5. **Async `execute` seam exactly as the sibling plans it**: `execute` returns `Promise<CommandOutput>`, `run` does `emit(await execute(...))`. Rejected: a serve-style special arm for merge — duplicated error plumbing and a divergent edit that would conflict on merge.
6. **Warning difference is a set difference** over `(path, reason)` pairs — joined replay's warnings minus the local replay's — rendered from the already-sorted joined list. Rejected: teaching replay to tag "new" warnings — §6.4 defines the difference semantically; replay stays consumer-agnostic.
7. **No-op merges still write**: equal or contained history produces an identical `repository.json`; the atomic rewrite is unobservable. Rejected: a skip-write branch — unobservable optimization.
8. **A local operand must itself be a repository root** (§7: "a local path to a repository root"): `loadRepositoryAtRoot(resolve(cwd, operand))`, no nearest-walk. Rejected: walking up from the operand — could silently locate an ancestor repository (or the local one itself) and merge the wrong history; the walk stays for the implicit local repository only.

## Approach

1. **`ts/src/repo/validate.ts`** — `assertNoPatchCollisions(local: Repository, remote: Repository): void`. Per side build `author->revision → encodePatch(patch)` maps; every dot present in both must be structurally equal; on the first difference in byte order (author, then revision) throw `SnapError('patch collision: <author> revision <n>')`. (Exact sibling seam; reserved for this union.)
2. **`ts/src/fs/locate.ts`** — `loadRepositoryAtRoot(root: string): LoadedRepository` (reads `<root>/.snap/repository.json`, decodes, validates; unreadable → `not a Snap repository`); `loadValidatedRepository` becomes the nearest-walk wrapper delegating to it. (Exact sibling seam.)
3. **`ts/src/commands/operand.ts`** — `loadRepositoryOperand(operand: string, cwd: string): Promise<Repository>`: `http://`/`https://` prefix → `fetchRepository(operand)`; otherwise `loadRepositoryAtRoot(resolve(cwd, operand)).repository`. The URL form has no root, so the return is the validated `Repository` alone.
4. **`ts/src/repo/union.ts`** — `unionRepositories(local: Repository, remote: Repository): Repository`: `assertNoPatchCollisions`, then a merge-walk of both patch arrays (each already `(author bytes, revision)`-sorted) into one sorted array with duplicates collapsed, and `frontier: joinVersions(local.frontier, remote.frontier)`.
5. **`ts/src/commands/merge.ts`** — `merge(operand: string, cwd: string): Promise<CommandOutput>`:
   1. `const local = loadValidatedRepository(cwd)`
   2. `const remote = await loadRepositoryOperand(operand, cwd)`
   3. `const joined = unionRepositories(local.repository, remote)`
   4. `const joinedReplay = validateRepository(joined)` (§4.5 on the joined value = the canonical replay: tree + warnings)
   5. `const working = scanWorkingTree(local.root)`; `diffTrees(local.replay.tree, working).length > 0` → `working tree is dirty`
   6. `installTree(local.root, local.replay.tree, joinedReplay.tree)`; `writeRepository(local.root, encodeRepository(joined))`
   7. stdout `formatVersion(joined.frontier) + '\n'`; stderr the §6.4 difference — joined warnings whose `(path, reason)` key is absent from `local.replay.warnings`, each `warning: auto-resolved <path>: <reason>\n`.
6. **`ts/src/cli/main.ts`** — `execute` becomes `async` (`Promise<CommandOutput>`), `run` awaits it; the `merge` arm becomes `return merge(command.repository, ctx.cwd)`; the `findRepositoryRoot`/`notImplemented` placeholder goes. Local-operand failures still surface `not a Snap repository` through the operand loader.

## Tasks

- [ ] `ts/src/repo/validate.ts` + `validate.test.ts`: `assertNoPatchCollisions` — equal shared dots pass; first differing dot in (author, revision) byte order throws `patch collision: <author> revision <n>`; structurally equal patches under different JSON key order pass (uses `encodePatch`).
- [ ] `ts/src/fs/locate.ts` + `locate.test.ts`: `loadRepositoryAtRoot` (valid repository loads and replays; missing `.snap/repository.json` → `not a Snap repository`; malformed JSON → decoder's error); `loadValidatedRepository` delegation keeps current behavior.
- [ ] `ts/src/commands/operand.ts` + `operand.test.ts`: path form resolves against `cwd` and requires a repository root; `http://`/`https://` forms hit `fetchRepository` (test against a local `node:http` server: 200 valid repository resolves, non-200/invalid body propagates its `SnapError`).
- [ ] `ts/src/repo/union.ts` + `union.test.ts`: merge-walk keeps `(author, revision)` order, collapses structurally equal duplicates, joins frontiers componentwise; calls the collision check first.
- [ ] `ts/src/commands/merge.ts` + `merge.test.ts`: fresh import installs the joined tree and rewrites `repository.json` with joined frontier and sorted patches; warnings difference only (pairs already in the local replay stay silent); equal-history merge is a byte-identical no-op printing the unchanged version; collision → exit 1, `patch collision: …`, local tree and `repository.json` untouched; dirty tree → `working tree is dirty` before any write; symlink in the working tree → `unsupported working tree entry: link`; malformed remote (path and URL) → validation error, no mutation.
- [ ] `ts/src/cli/main.ts` (+ `main.test.ts`): async `execute`/`await` in `run`; merge dispatch; existing suites unchanged.
- [ ] `cd ts && npm run check` green (grows from 396 tests / 83 suites).
- [ ] `./verify --lang ts`: 09, 10, 11, 17, 18, 20, 21, 22, 31 green; 13, 16, 26 red only at their `diff … --repo` steps; 28 red (presentation strand); no other movement; record the post-merge verification note for `cross-repository-diff`.

## Documentation Impact

- `ts/AGENTS.md` Layout clause: extend the `serve.ts` purity parenthetical — command bodies may return a `Promise<CommandOutput>` when the operand needs the async §9 client (`merge`); purity (arguments in, output record out) is otherwise unchanged.
- No `SPEC.md` or `tests/` changes: no ambiguity surfaced; §7.8/§10/§6.4 already pin the behaviors, and tests/16 pins the collision message the sibling seam carries.
- Stack `snap-1.0` is not updated by this plan (lifecycle does that via `Update stack` / close-out).

## Acceptance Tests

- `cd ts && npm run check` green with the new unit files above (collision byte-order pin, root loader, operand classification, union laws, merge behavior matrix).
- `./verify --lang ts` on this branch: 09, 10, 11, 17, 18, 20, 21, 22, 31 green (28/32 total); 13, 16, 26 fail only at their `diff --repo` steps; 28 fails at step 1 (presentation strand, out of scope).
- Post-merge verification (documented, run when `cross-repository-diff` lands right after this strand): `./verify --lang ts --filter 13-http-client`, `--filter 16-dot-collision`, `--filter 26-portability-and-failure-safety` green with zero changes to this plan's code.
