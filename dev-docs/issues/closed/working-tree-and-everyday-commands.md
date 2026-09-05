---
title: Working tree and everyday commands: scan, delta install, status, log, commit, diff, revert
date: 2026-09-05
start-date: 2026-09-05
author: agent
id: working-tree-and-everyday-commands
stack: snap-1.0
closed: 2026-09-05
---

## Problem

Snap can validate a repository's history and replay it into the file tree it represents, but a user can neither observe nor change that tree: there is no scan of the working directory and no way to install a tree onto disk, so the everyday workflow — see what changed, record it, inspect differences, undo — does not exist.

Technically, per stack `snap-1.0`'s Working tree and everyday commands section, the missing pieces are: a working-tree scan (§2, §10) — `withFileTypes` traversal that excludes the root `.snap`, fails with unsupported-entry and invalid-path errors reporting the offending relative path least in unsigned byte order, and returns a byte-order-sorted Tree (tests/08); a delta install (§6.2, §10) — deletes with empty-directory pruning, directory creation, writes, working files first, and `repository.json` replaced via same-directory temp file + rename; `snap status` (§7.3) and `snap log` (§7.4) with message escaping (tests/04); `snap commit <message>` (§7.5) — text/put/delete change selection, 4096-byte message limit, dirty-tree requirement, atomic metadata replacement; `snap diff` and the two-version local form `snap diff <old> <new>` (§7.6) — whole-file unified blocks, `/dev/null` headers, `\ No newline at end of file`, `Binary files … differ` (tests/05, tests/06); and `snap revert <version>` (§7.7) — additive patch and the `target tree is already current` error (tests/07). Every command runs exactly one replay and reuses its frontier tree and warning set.

## Impact

- `tests/04-commit-status-log.yaml`, `tests/05-diff-goldens.yaml`, `tests/06-binary-and-empty.yaml`, `tests/07-revert.yaml`, `tests/08-unsupported-entries.yaml`, and `tests/25-config-version-path-boundaries.yaml` fail at `not implemented`; `tests/15-repository-validation.yaml` and `tests/23-strict-validation-matrix.yaml` still fail at their first repository-loading step (`snap: not implemented: status`) because their validation surface has no command to carry it.
- `tests/29-working-tree-scan-failures.yaml` pins the scan's failure selection (`snap: unsupported working tree entry:` / `snap: invalid working tree path:`, least byte-order path across both failure classes) and is equally gated.
- Snap is unusable as a version control tool beyond `init`/`config`: a user can never commit, inspect, or restore work.
- Downstream strands stay blocked: §7.11 terminal presentation renders these commands' output, `snap merge`'s dirty-tree refusal (§7.8) needs status, and the `diff --repo` operand (§7.6, §9) needs diff.

## Context

- Already landed: `repo/model.ts` strict decode + canonical encode, `repo/validate.ts` (§4.5 steps 1–5), `repo/replay.ts` linear replay (§4.5 step 6), `repo/tree.ts` Tree type; `text/` tokens, edit scripts, §5 diff, §6.3 transform (issue `text-core`); `fs/locate.ts` nearest-repository walk; `cli/args.ts` positional grammar (tests/24 green); `commands/init.ts`, `commands/config.ts`, `commands/version.ts`; and the §10 error type with single `snap: <detail>` formatting.
- New code homes follow design `snap-ts-architecture`: working-tree scan and install land in `ts/src/fs/`; one file per command under `ts/src/commands/` (`status`, `log`, `commit`, `diff`, `revert`).
- Spec anchors: §2 (paths, trees, scan), §6.2 (install delta; tree integration), §7.3–§7.7 (commands), §10 (expected errors exit 1, internal failures exit 2).
- Settled constraints: scan failures report the byte-order-least offending relative path across both failure classes, printed verbatim; the root `.snap` is excluded from scans; installs write working files before `repository.json`, which lands via same-directory temp file + rename; commit requires a dirty tree and rejects messages over 4096 bytes; revert emits an additive patch and fails with `target tree is already current` when the target tree matches; the two-version diff form compares versions within one repository. Open choices (module split, output-record shapes) belong to the plan.

## Out of Scope

- `snap diff <old> <new> --repo <repository>` HTTP operand and cross-repository dot check — HTTP strand.
- `snap merge` and concurrent replay (§6.1–§6.4: ready-set selection, base-materialization memo, integration rules, winner table, warning set) — Concurrent replay and merge section.
- §7.11 terminal presentation/layout for these commands — Terminal presentation section.
- HTTP serve/client (§7.9, §9) — HTTP strand.

## Plan Closeout Notes

<!-- plan-close-review: working-tree-and-everyday-commands -->

- Scope: drift, user-approved at close — additions beyond the plan's file list were forced by its own acceptance criteria: §6.1 least-ready selection in `ts/src/repo/replay.ts` (tests/23 expects `delete of absent path: f` surfaced from the Snap-least of two `()`-based patches) and a test-harness `remove` fix (`test-harness/src/filesystem.ts` — node v24.9 on macOS leaves dangling symlinks under `rmSync`; non-directories now `unlinkSync`, with a regression test in `test-harness/test/harness.test.ts`; tests/08 and tests/29 were unpassable otherwise). Refined shapes within plan intent, all recorded in realized design `working-tree-and-everyday-commands`: loader returns `{root, repository, replay}`; `withPatch`/`resolveKnownVersion` in `repo/model.ts` (sorted insertion, not append); revert check order corrected to known-version → dirty → contributor (tests/24); zero-operand `diff` parses to a `diffWorktree` variant in `cli/args.ts`; `--repo` refusal stays at the CLI boundary; `commit.ts` additionally exports `nextRevision`/`writeRepositoryVersion`, reused by `revert.ts`.
- Documentation impact: none beyond the plan's "None" — the landed module layout matches `ts/AGENTS.md`; the macOS `rmSync`-dangling-symlink quirk is documented in `test-harness/src/filesystem.ts` and the realized design's Follow-Up.
- Guidelines / conventions: none recorded — no GUIDELINES files exist in this repo; `ts/AGENTS.md` conventions are enforced by the strict eslint lane (green).
- Comments / docstrings: conform.
- Stack items satisfied: `snap-1.0` "Working tree and everyday commands" — all eight items (§2/§10 scan + tests/08; delta install with temp+rename, working files first; status + log + tests/04; commit §7.5; diff both forms + tests/05, tests/06; revert + tests/07; one replay per command; tests/25 green). Also completes the green-suite requirements of "CLI skeleton" items `snap config` (tests/03, gated on `commit`) and "tests/14, tests/19 green" (19), and "Repository model" item "§4.5 steps 1–5 — tests/15, tests/23, tests/27" (15 and 23 now carried green by the commands' validated loads).

<!-- /plan-close-review -->
