---
title: "Cross-repository diff: snap diff <old> <new> --repo <repository> (local path or HTTP operand)"
date: 2026-09-05
start-date: 2026-09-05
closed: 2026-09-05
author: agent
id: cross-repository-diff
stack: snap-1.0
---

## Problem

Snap can compare versions only inside one repository: the working tree against the current tree, or two versions of the nearest repository. The product contract also promises a cross-repository comparison — showing what changed between a locally held version and a version in another repository, whether a second checkout on disk or one published over HTTP — but that form of `snap diff` does not exist, so comparing histories across working copies or machines requires copying files.

Implement `snap diff <old> <new> --repo <repository>` (SPEC §7.6, §9): the repository operand is a local path or an `http://`/`https://` URL fetched with one exact validated GET (status 200 required, no redirects, strict §4.1 parse, §4.5 validation); apply the cross-repository dot check; materialize both named versions from the operand repository and render the canonical §5/§7.6 unified diff between them. Target: the diff half of tests/13 green (the suite goes fully green once `snap merge <url>` lands on main).

## Impact

- `tests/13-http-client.yaml` fails at its diff step: from a fresh local repository it runs `diff "()" "(remote@x->1)" --repo <served URL>` and pins exact plain stdout, so the cross-repository form has no enforcer until this lands.
- Stack `snap-1.0`'s HTTP section item "snap diff <old> <new> --repo <repository> local and HTTP with cross-repository dot check (§7.6)" stays unchecked, and the stack's full `./verify --lang ts` green item stays blocked behind it.
- Repository exchange is one-sided: `snap --serve` and the single-GET client core landed (issue `http-server-and-client`), but without `diff --repo` there is no read-only way to inspect another repository's history — the only remaining consumer, `merge <url>`, mutates the local repository.

## Context

- Already landed (stack `snap-1.0`): local `snap diff` and `snap diff <old> <new>` with whole-file unified blocks, `/dev/null` headers, `\ No newline at end of file`, and `Binary files … differ` (§7.6) — tests/05, tests/06; the HTTP client core `fetchRepository` (one exact GET, status 200 required, no redirects, strict parse per §9) from issue `http-server-and-client`; `snap --serve` (§7.9, tests/12); strict JSON reader (§4.1), §4.5 repository validation, replay materialization, and canonical structural-equality serialization for dot comparison (§3.5, §4.2).
- Spec anchors: §7.6 fixes the grammar `snap diff <old> <new> [--repo <repository>]`, resolves `old` locally and `new` in the operand repository without importing it, requires validating every repository and version before producing output, and defines the cross-repository dot check — compare every dot present in both repositories and fail as corrupt if its parsed patch values differ. The §7 lead-in fixes operand classification (explicit `http://`/`https://` URL, otherwise a local path to a repository root resolved against the process working directory) and option position/at-most-once rules. §9 fixes URL fetch discipline (one GET of the exact URL, status 200, strict parse, normal validation; HTTP is read-only).
- tests/13's diff step pins the plain output for the empty-to-remote case:

  ```text
  --- /dev/null
  +++ b/file.txt
  @@ -1,0 +1,1 @@
  +remote
  ```

## Out of Scope

- `snap merge <url>` (§7.8) — owned by the concurrent-replay-and-merge strand, including the merge half of tests/13 (merge steps, redirect and invalid-body refusal via `merge`, the single-GET `http_requests_equal` pin).
- Full tests/13 green — it rides on `snap merge <url>` landing, per the target note in the problem statement.
- Terminal presentation (§7.11) for diff output — separate stack item (tests/28); tests/13 pins plain-mode bytes.
- Server-side work (`snap --serve`, tests/12) — implemented in issue `http-server-and-client`.
- HTTP caching, authentication, redirect following, and concurrent server updates — excluded by §9.

## Plan Closeout Notes

<!-- plan-close-review: cross-repository-diff -->

- Scope: no drift; three documented deviations (the tests/26 regression step uses a fresh `local2` repository, `main.test.ts`'s stale not-implemented pin was updated, two extra unit-test cases) — recorded in design `cross-repository-diff` Plan Realized.
- Documentation impact: none beyond the plan's own list — SPEC.md and AGENTS.md unchanged, tests/26 one additive format-1 step; matches the plan's `## Documentation Impact`.
- Guidelines / conventions: none recorded; the async `execute` seam follows the serve precedent and is recorded in design `cross-repository-diff` Decisions.
- Comments / docstrings: conform.
- Stack items satisfied: `snap-1.0` HTTP section — "snap diff <old> <new> --repo <repository> local and HTTP with cross-repository dot check (§7.6)". (tests/13, tests/16, tests/26 remain red only in their merge halves, which do not gate this item.)

<!-- /plan-close-review -->
