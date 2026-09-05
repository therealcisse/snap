---
title: Implement `snap merge <repository>` for local paths and HTTP URLs
date: 2026-09-05
start-date: 2026-09-05
author: agent
id: snap-merge-command
stack: snap-1.0
closed: 2026-09-05
---

## Problem

Snap cannot yet take in history from another repository. Two independently advanced repositories have no way to become one, so work done in a second copy (or published by one over HTTP) cannot be brought into the first; the merge command promised by the product contract does not exist yet.

Implement `snap merge <repository>` (SPEC §7.8, §10): resolve the operand — a local path or an `http://`/`https://` URL fetched by the strict §9 client (one GET, status 200, no redirects); validate both repositories (§4.5) before any mutation; require a clean working tree but no contributor configuration; union the patch sets dot-keyed with collision/corruption detection; join the frontiers; canonically replay the joined history; install the tree and update `repository.json`; print new §6.4 warnings (the difference vs the local replay's warnings before merge) to stderr and the joined version to stdout; author no patch and increment no revision; equal or already-contained history succeeds, changes nothing, emits no warnings, and prints the unchanged version. Target: tests/09, 10, 11, 16, 17, 18, 20, 21, 22, 26 and the sub-replay-warnings regression case green.

## Impact

- One of the eight everyday commands is missing, so a core user flow of the product (converging diverged repositories) is impossible.
- The merge strand of stack snap-1.0 stays red: acceptance suites 09, 10, 11, 16, 17, 18, 20, 21, 22, 26 and the sub-replay-warnings regression case cannot pass, keeping `./verify --lang ts` below 32/32.
- The §11 import-permutation invariance property (frontier, patch set, warnings, tree bytes) has no exercising command without merge.

## Context

- SPEC sections bounding this work: §7.8 (command contract), §10 (operand, error, exit-code, and output rules), §9 (strict HTTP client), §4.5 (repository validation), §6.4 (replay warnings), §3.3/§3.4 (frontier join).
- Existing implementation under `ts/src` that this builds on: `cli/` (dispatch and argument grammar), `commands/` (per-command modules), `repo/validate.ts` (§4.5 validation), `repo/replay.ts` (canonical replay incl. the concurrent core), `http/client.ts` (strict §9 client), `fs/materialize.ts` (tree install), `fs/worktree.ts` (working-tree scan), `text/` (edit scripts and transform for the OT path).
- Stack `snap-1.0`, "Concurrent replay and merge" section: `snap merge <path>` item (two validations, dot-keyed union with corruption detection, frontier join, joined replay, warning difference, dirty-tree refusal, validation before mutation) and the "HTTP" section's `snap merge <url>` item; its target suites also exercise the unchecked §6.4 winner-table, text-OT, and convergence items listed there.
- Settled spec constraints recorded for the plan author: both repositories validated before any mutation; clean working tree required but contributor configuration not required (merge authors no patch and increments no revision); patch-set union is dot-keyed with collision/corruption detection; warnings printed are the new §6.4 warnings (the difference vs the local replay's pre-merge warnings) on stderr, joined version on stdout; equal or already-contained history is a silent no-op success printing the unchanged version.

## Out of Scope

- `snap --serve` server behavior and `tests/12-http-server.yaml` (separate HTTP strand item).
- `snap diff <old> <new> --repo <repository>` cross-repository operand (separate strand item).
- `tests/28-terminal-presentation.yaml` rendering work beyond what merge's own §10 output rules require.
- §11 property tests and performance hardening (stack "Hardening and performance" section).
- Implementation approach, module seams, and task breakdown — decided by the plan, not this issue.

## Plan Closeout Notes

<!-- plan-close-review: snap-merge-command -->

- Scope: user-confirmed drift — version-knownness rewrite beyond plan Approach/Tasks (`repo/model.ts` `knownVersionKeys` → semantic `isKnownVersion`, `repo/replay.ts` doc reference, 4 `model.test.ts` tests replaced 1:1), required for tests/21 step 19 (merged-frontier `diff`); recorded in realized design `dev-docs/designs/approved/snap-merge-command.md`. In-scope shape deviations: `async` operand loader, lint-forced cast-free merge-walk.
- Documentation impact: plan's `ts/AGENTS.md` Layout clause (async command bodies) landed as written; no SPEC or `tests/` changes, as the plan records; realized design approved and filed.
- Guidelines / conventions: none recorded (no GUIDELINES files in repo; the async-command-body convention extension is already documented in `ts/AGENTS.md`).
- Comments / docstrings: conform.
- Stack items satisfied: `snap merge <path>` (Concurrent replay and merge; tests/20 green, tests/16 and 26 red only at their `diff --repo` steps pending `cross-repository-diff`); `snap merge <url>` (HTTP; implemented, observable in tests/13/16/26 after `cross-repository-diff` merges); Convergence (tests/18 green; tests/21 green via this plan's `isKnownVersion` fix); §6.4 winner-table item suites (tests/10, 11, 17) and text-OT item suites (tests/09, 22) green — implementation from prior strands, merge completes their observability.

<!-- /plan-close-review -->
