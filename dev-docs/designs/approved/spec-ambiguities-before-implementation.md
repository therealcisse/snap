---
title: "Realized: four SPEC.md clarifications with regression cases and README path fixes"
date: 2026-09-04
author: agent
id: spec-ambiguities-before-implementation
issue: spec-ambiguities-before-implementation
plan: spec-ambiguities-before-implementation
---

## Summary

`SPEC.md` now decides four behaviors that previously admitted more than one reading: integer-ness of JSON numbers is a lexeme property (§4.1); warnings raised while materializing a patch's base tree are discarded (§6.2, §6.4); a regular file with an invalid tracked-path name is an "invalid working tree path" that fails every scanning command (§2, §10); and when several entries offend, the least path in unsigned UTF-8 byte order is reported (§10). Each decision has one public YAML case (`tests/29`–`31`) whose expected bytes differ under the rejected reading. `README.md` no longer references the workshop archive's `./capstones/snap/` paths. No code under `ts/` changed.

## Plan Realized

### spec-ambiguities-before-implementation

All nine tasks executed as written. One deviation: the plan's Step 6 narrated the canonical integration order for test 31 as `a1, m1, z1, z2`; Snap order (§3.4) over the sorted id union `a@x, m@x, z@x` gives `z1 (0,0,1) < m1 (0,1,0) < a1 (1,0,0) < z2 (1,0,2)`. The expected stdout, stderr, and tree in the plan were already correct for the true order, so only the prose was wrong; the test's `description` records the correct derivation.

## Implementation

`SPEC.md` (five edits):

- §2, new bullet after the unsupported-entries bullet (lines 65–68): defines **invalid working tree path** for regular files whose relative path is not a valid tracked path; directories are only traversed, so an empty directory is ignored whatever its name.
- §4.1 (lines 192–203): "parsed typed value is authoritative" gains its single exception — a JSON number is an integer only when its lexeme matches `-?(0|[1-9][0-9]*)`; `1.0`, `1e0`, `1.5` are all non-integer. The error sentence is narrowed to "non-integer numbers where an integer is expected".
- §6.2 (lines 349–354): materializing `B` is a sub-replay of the patches selected by `B`; its warnings are discarded.
- §6.4 (lines 433–436): replay returns the warning pairs "produced by its own top-level integrations".
- §10 (lines 722–733): scanning commands fail on an unsupported entry *or* an invalid working tree path; with several offenders, the least relative path in unsigned UTF-8 byte order is reported regardless of directory structure or filesystem listing order; both plain-mode error lines are given literally, `<path>` printed verbatim.

`tests/` (three new format-1 cases, discovered as 29–31 by `./verify --list`):

- `29-working-tree-scan-failures.yaml`: backslash and `\u0001` names against `status`/`commit`/`diff`; cross-class ordering (`m-link` symlink before `z\x`); byte-order-beats-directory-order (`a.txt` FIFO before `a/b` symlink); empty `dir\empty` ignored; final `json_equals` proves no mutation.
- `30-non-integer-json-lexemes.yaml`: `"revision": 1.0` (pattern `positive safe integer`, consistent with `tests/23`), frontier `["a@x", 1e0]`, `"format": 1.0` — each rejected; then the same values spelled `1` validate with `version (a@x->1)`.
- `31-sub-replay-warnings.yaml`: three repos `a`, `z`, `m`; `z` merges `a` (`n: later-create-wins`), commits `z2` on the merged base; `m` merges `z` expecting exactly `n: namespace-wins` and `n/x: namespace-wins`, `m/n == "zz2\n"`, `m/n/x` absent, and a warning-free re-merge.

`README.md`: `./capstones/snap/run` → `./run` (lines 42, 43, 52), `/path/to/ai-workshop/capstones/snap/run` → `/path/to/snap/run` (46), `./capstones/snap/verify` → `./verify` (78, 90).

## Behavior

Normative consequences for any implementation:

- The repository reader must see number lexemes, not just parsed values; `JSON.parse` alone cannot satisfy §4.1. This confirms the strict single-pass reader locked by design `snap-ts-architecture`.
- Replay carries one warning accumulator owned by the top-level loop; base materialization runs with warnings suppressed or discarded. Merge's printed set is unchanged in shape: joined minus pre-merge, sorted by path then reason.
- Working-tree scans collect every offending entry (non-regular kind, or regular file with invalid relative path), sort by unsigned UTF-8 bytes, and report the first with the class-specific message. Directory names are never validated; symlinked directories remain unsupported entries.
- No mutation occurs on any of these failures.

## Tests

Each new case is designed so the rejected alternative produces different bytes, and each `description` states which alternative and why. Coverage gaps accepted: no case for a `.snap`-first-segment file (impossible below root, and `tests/25` already covers `.snap/untracked` at root); no case for negative or leading-zero lexemes (`-0`, `01`) since the regex makes them unambiguous and `tests/19`/`23` already reject zero and overflow. The three cases fail against the current `ts/` stub by design until implementation issues land.

## Decisions

- Verbatim path rendering in error lines rather than escaping: consistent with the existing unsupported-entry message and avoids a rendering rule used by one message. The harness compares exact UTF-8 so control characters are testable.
- Sorting across both failure classes with one comparator rather than reporting unsupported entries before invalid names: keeps the rule a pure path-order rule with no class precedence to specify.
- Test 30 uses loose `^snap: .+\n$` for the frontier and `format` positions because no existing fixture pins those message texts; only the revision position reuses the `positive safe integer` pattern already fixed by `tests/23`.
- Test 31 needed a history where a sub-replay conflict is *not* re-derived at top level; a plain concurrent-create pair would produce the same warning either way. The `n` vs `n/x` namespace conflict achieves this because `m1` removes `n` before `a1` and `z2` integrate.

## Follow-Up

- `TEST-HARNESS.md` lines 371–373, 389, 402 still reference `capstones/snap/`; excluded by the issue, candidate for a local issue.
- Design `snap-ts-architecture` §"Open Questions" is now superseded by `SPEC.md`; it is immutable and should not be edited. The next architecture-level design should drop that section.
- Stack `snap-1.0` "Spec clarifications" items become checkable at `/close-issue`.
