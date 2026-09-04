---
title: "SPEC.md leaves four behaviors underspecified before implementation starts"
date: 2026-09-04
start-date: 2026-09-04
closed: 2026-09-04
author: agent
id: spec-ambiguities-before-implementation
stack: snap-1.0
plans:
  - spec-ambiguities-before-implementation
---
# SPEC.md leaves four behaviors underspecified before implementation starts

## Problem

Snap's specification is meant to be exact enough that any two implementations produce identical bytes. Research done before starting the TypeScript implementation found four places where the text allows more than one reasonable reading, and the public acceptance suite does not exercise any of them. If code is written before these are settled, the implementation silently becomes the authority — which `AGENTS.md` forbids. Separately, the top-level `README.md` still references paths from the original workshop archive (`./capstones/snap/…`) that do not exist in this repository.

The four underspecified behaviors:

1. **Sub-replay warnings (§6.2, §6.4).** Integrating a patch requires materializing its exact base tree `B`. When that base is not on the top-level replay path, materializing it is itself a replay that may resolve conflicts and emit `(path, reason)` warnings. §6.4 says "Replay returns the set of unique warning pairs" in the singular; it does not state whether warnings produced inside a sub-replay contribute to the outer replay's set or are discarded.
2. **Non-integer JSON numbers (§4.1).** §4.1 says "non-integer numbers … are errors" and also "the parsed typed value—not its serialized bytes—is authoritative." A revision written as `1.0` or `1e0` parses to the integer `1`; the spec does not say whether the source spelling or the parsed value decides. No fixture in `tests/` contains such a number.
3. **Working-tree entries with invalid tracked-path names (§2, §10).** §2 defines which paths are trackable (no backslash, no ASCII control characters, no `.snap` first segment, etc.). §10 specifies failure for symlinks and other non-regular entries. Neither section states what `status`, `commit`, or `diff` do when a regular file exists whose name is not a valid tracked path.
4. **Multiple unsupported entries (§10).** `tests/08-unsupported-entries.yaml` requires the error `snap: unsupported working tree entry: <path>` with one path. The spec does not say which entry is reported when several exist, so output is not deterministic across implementations that walk the filesystem in different orders.

Research `snap-performance-and-data-structures` proposes an answer for each (sub-replay warnings do not count; `1.0` is an error checked on source text; invalid-name entries fail like unsupported entries with a distinct message; the first entry in byte order is reported). These are proposals, not decisions.

## Impact

- The TypeScript implementation cannot be written to §6.2, §4.1, or §10 without picking an answer, and any answer picked in code without a spec change violates the `AGENTS.md` rule that the spec is corrected first.
- Items 1 and 4 affect byte-exact stderr output, which the acceptance suite compares literally; a future Rust or Scala edition could pass the current suite while disagreeing with the TypeScript one.
- Item 2 determines whether a strict custom JSON reader is required or `JSON.parse` plus an integer check suffices — a structural choice in the foundations layer that is expensive to reverse.
- Item 3 leaves a class of working trees with undefined behavior on every command that scans the filesystem.
- The stale README paths cause every documented command to fail for anyone following the README in this repository.

## Context

- `SPEC.md` is the canonical contract (root `AGENTS.md`); sections involved are §2, §4.1, §6.2, §6.4, §10. The spec's own §11 lists required acceptance coverage and expects regression cases for every decided behavior.
- `tests/` holds 28 language-neutral YAML suites; `TEST-HARNESS.md` defines the format (format 1). New cases must use existing typed operations; the harness must not gain shell setup steps to work around a missing operation (root `AGENTS.md`, harness neutrality).
- `tests/08-unsupported-entries.yaml` (symlink, FIFO) and `tests/25-config-version-path-boundaries.yaml` (duplicate JSON key, `.snap/untracked` at root) are the closest existing cases and show the error-message style in use.
- Research `snap-performance-and-data-structures` (§"TypeScript and Node pitfalls", §"Open questions") documents the findings and verified that `JSON.parse("1.0")` returns `1` indistinguishably from `"1"`.
- Design `snap-ts-architecture` (approved) records these four as open questions that must be settled before code depends on them, and locks the decision that repository JSON is read by a strict single-pass reader — item 2's answer determines how strict.
- `README.md` lines 42–53, 78, and 90 contain `./capstones/snap/…` paths; the equivalent in `ts/AGENTS.md` and root `AGENTS.md` has already been corrected.
- Constraint: approved and done artifacts are immutable, but `SPEC.md` and `tests/` are not lifecycle artifacts and may be edited directly.

## Out of Scope

- Any implementation code under `ts/`.
- Toolchain scaffolding (tsconfig, ESLint, Prettier, hooks) — separate stack section and issue.
- Other spec ambiguities not listed above; each becomes its own issue when found.
- Changes to `TEST-HARNESS.md` or `test-harness/` source.
- Cross-language exchange tests (§11 item 11) — no second implementation exists.

## Plan Closeout Notes

<!-- plan-close-review: spec-ambiguities-before-implementation -->

- Scope: no drift; the plan's Step 6 prose mis-stated test 31's canonical integration order (`a1, m1, z1, z2`; correct is `z1, m1, a1, z2`), expected bytes unaffected, corrected derivation recorded in the test's `description` and in design `spec-ambiguities-before-implementation`.
- Documentation impact: as planned (`SPEC.md` §2, §4.1, §6.2, §6.4, §10; `README.md` six path fixes); `TEST-HARNESS.md` lines 371–373, 389, 402 still reference `capstones/snap/` and are a candidate for a separate local issue.
- Guidelines / conventions: none recorded (no product code touched; no `GUIDELINES.md` in this repository).
- Comments / docstrings: conform (YAML `description` fields and `#` comments state intent and the rejected alternative).
- Stack items satisfied: `snap-1.0` → Spec clarifications: sub-replay warnings; non-integer JSON numbers; invalid tracked-path names; multiple unsupported entries; stale `./capstones/snap/` paths in `README.md`.

<!-- /plan-close-review -->
