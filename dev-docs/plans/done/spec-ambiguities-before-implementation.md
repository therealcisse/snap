---
title: "Settle four SPEC.md ambiguities with regression cases and fix README paths"
date: 2026-09-04
author: agent
id: spec-ambiguities-before-implementation
issue: spec-ambiguities-before-implementation
research:
  - snap-performance-and-data-structures
designs:
  - snap-ts-architecture
completed: 2026-09-04
closeout_notes: true
---

## Context

Issue `spec-ambiguities-before-implementation` lists four behaviors that `SPEC.md` leaves open and that no fixture in `tests/` exercises. Root `AGENTS.md` requires the spec to be corrected before code picks an answer, and requires a public YAML regression case for each decided behavior. This plan makes the four decisions, writes them into `SPEC.md`, adds three YAML cases that discriminate the chosen answer from the rejected one, and fixes the stale `./capstones/snap/` paths in `README.md`. No implementation code is touched.

## Current State

- `SPEC.md` §4.1 (lines 188–194): "the parsed typed value—not its serialized bytes—is authoritative" and "non-integer numbers … are errors" coexist without saying which decides `1.0` / `1e0`.
- `SPEC.md` §6.2 (line 342) says "materialize its exact base tree `B`" without saying whether that sub-replay's warnings count; §6.4 (line 423) says "Replay returns the set of unique warning pairs".
- `SPEC.md` §2 (lines 63–71) defines unsupported entries and valid tracked paths separately; §10 (lines 712–713) specifies failure only for unsupported entries. Nothing covers a regular file whose relative path is not a valid tracked path, and nothing says which entry is reported when several offend.
- `tests/08-unsupported-entries.yaml` fixes the message `snap: unsupported working tree entry: <path>` with a single offending entry per run.
- `tests/23-strict-validation-matrix.yaml` (lines 42–64) rejects `"revision": 1.5` with pattern `^snap: .+positive safe integer\n$`; no fixture has an integer-valued non-integer lexeme.
- `tests/10-merge-conflicts.yaml` and `tests/11-namespace-conflicts.yaml` show the exact `warning: auto-resolved <path>: <reason>` stderr format and sort order.
- Harness capabilities relevant here (`TEST-HARNESS.md`): `write_file`, `symlink`, `fifo`, `copy_tree`, `remove`, `mkdir`, `run` with exact stderr, `assert` with `json_equals`/`file_text_equals`/`path_not_exists`. `test-harness/src/filesystem.ts` (31–50) only rejects NUL, absolute, non-normalized, and escaping paths, so a fixture path containing a backslash or `\u0001` is writable. Files are 28, numbered `01`–`28`.
- `README.md` lines 42, 43, 46, 52, 78, 90 contain `./capstones/snap/…` or `/path/to/ai-workshop/capstones/snap/…`; the real entry points are `./run` and `./verify` at the repository root.
- Design `snap-ts-architecture` (approved, immutable) lists the four as open questions with proposed answers; research `snap-performance-and-data-structures` §"Open questions" documents the findings.

## Developer Feedback

Decisions from the interview (user confirmed each):

1. **Sub-replay warnings do not count.** Only integrations performed by the top-level replay contribute to its warning set; materializing a base tree is an internal intermediate. Rejected: counting every conflict resolved anywhere — it reports resolutions of trees no user observed and complicates the pre-merge/joined set difference.
2. **Integer-ness is decided on the JSON lexeme.** A number is an integer only when its source text matches `-?(0|[1-9][0-9]*)`; `1.0` and `1e0` are errors wherever an integer is expected. This is the one deliberate exception to "parsed value is authoritative" and requires the strict single-pass reader the design already locks. Rejected: accepting `1.0 == 1` — contradicts "non-integer numbers are errors", lets `1e0` silently pass, and would make cross-implementation acceptance depend on each language's JSON library.
3. **Invalid-name regular files fail with a distinct message** `snap: invalid working tree path: <path>`, printed verbatim (no escaping), parallel to the unsupported-entry error. Rejected: reusing `unsupported working tree entry` (loses the kind-vs-name distinction); silently skipping (violates §10's "never silently ignoring" and makes `commit` lossy). Rejected renderings: §7.4-style or `\xHH` escaping and JSON quoting — both introduce a rendering rule used by a single message; the existing unsupported-entry message already prints raw bytes and the harness compares exact UTF-8.
4. **The least offending path in unsigned UTF-8 byte order is reported**, across both failure classes (unsupported kind, invalid name), each with its own message. Rejected: first hit of a per-directory-sorted DFS — differs from §2 path order (`a.txt` vs `a/b`) and needs its own definition; reporting all offenders — changes the one-line error shape and the exact stderr of `tests/08`.

Agent-proposed detail, not separately interviewed: the scan validates the relative path of every non-directory entry; directories are only traversed, so an empty directory with an invalid name is ignored exactly as any empty directory is. Symlinks to directories are unsupported entries and are not followed (already §2).

Scope: single plan. `TEST-HARNESS.md` also contains `capstones/snap/` paths (lines 371–373, 389, 402) but the issue excludes it — record as a follow-up issue candidate, do not edit.

## Approach

### Step 1 — SPEC.md §4.1: integer lexemes

Rewrite the two paragraphs at lines 188–194 so they read:

> The example is pretty-printed for readability. Readers accept ordinary JSON whitespace and object-key order. Valid input has unique object keys. The parsed typed value—not its serialized bytes—is authoritative, with one exception: a JSON number is an **integer** only when its source lexeme has no fraction and no exponent, that is, matches `-?(0|[1-9][0-9]*)`. `1.0`, `1e0`, and `1.5` are all non-integer numbers. Writers SHOULD use two-space indentation and a trailing LF so repositories remain pleasant to inspect.
>
> Unknown fields, non-integer numbers where an integer is expected, and invalid typed values are errors. …

The same rule applies to `.snap/config.json` (§8) by construction since it has no numeric fields; no §8 change.

### Step 2 — SPEC.md §6.2/§6.4: sub-replay warnings

In §6.2, after "For incoming patch `P`, materialize its exact base tree `B`." (line 342) add:

> Materializing `B` is itself a replay of the patches selected by `B` (§6.1) and may resolve conflicts of its own. Its warnings are discarded; only the integrations performed by the top-level replay contribute to that replay's warning set.

In §6.4, change line 423 to: "Replay returns the set of unique warning pairs produced by its own top-level integrations, sorted by path, then reason."

### Step 3 — SPEC.md §2/§10: invalid working-tree paths and reporting order

In §2, after the unsupported-entries bullet (lines 63–64), add a bullet:

> - A regular file whose relative path is not a valid tracked path (below) is an **invalid working tree path**. Snap MUST report it and MUST NOT track it. Directories are only traversed; an empty directory is ignored whatever its name.

In §10, replace lines 712–713 with:

> Any command that scans the working tree fails on an unsupported entry or an invalid working tree path rather than following or silently ignoring it. When several entries offend, Snap reports the one whose relative path is least in unsigned UTF-8 byte order, regardless of directory structure or the order in which the filesystem lists entries. The plain-mode errors are:
>
> ```text
> snap: unsupported working tree entry: <path>
> snap: invalid working tree path: <path>
> ```
>
> `<path>` is the entry's relative path with `/` separators, printed verbatim.

### Step 4 — `tests/29-working-tree-scan-failures.yaml`

Covers decisions 3 and 4 against `status`, `commit`, `diff`, and asserts no mutation.

```yaml
format: 1
name: working tree scans report invalid paths and choose the least offending entry
steps:
  - run: {args: [init, repo], expect: [{type: exit_code, value: 0}]}
  - run: {cwd: repo, args: [config, contributor.id, a@x], expect: [{type: exit_code, value: 0}]}
  # invalid name: backslash
  - write_file: {path: "repo/z\\x", text: "backslash\n"}
  - run:
      cwd: repo
      args: [status]
      expect:
        - {type: exit_code, value: 1}
        - {type: stdout_equals, value: ""}
        - {type: stderr_equals, value: "snap: invalid working tree path: z\\x\n"}
  - run: {cwd: repo, args: [commit, bad], expect: [{type: exit_code, value: 1}, {type: stderr_equals, value: "snap: invalid working tree path: z\\x\n"}]}
  - run: {cwd: repo, args: [diff], expect: [{type: exit_code, value: 1}, {type: stdout_equals, value: ""}, {type: stderr_equals, value: "snap: invalid working tree path: z\\x\n"}]}
  # least path across classes: symlink "m-link" (0x6d) < invalid "z\x" (0x7a)
  - symlink: {path: repo/m-link, target: missing}
  - run: {cwd: repo, args: [status], expect: [{type: exit_code, value: 1}, {type: stderr_equals, value: "snap: unsupported working tree entry: m-link\n"}]}
  - remove: {path: repo/m-link}
  - remove: {path: "repo/z\\x"}
  # control character
  - write_file: {path: "repo/bad\u0001name", text: "control\n"}
  - run: {cwd: repo, args: [status], expect: [{type: exit_code, value: 1}, {type: stderr_equals, value: "snap: invalid working tree path: bad\u0001name\n"}]}
  - remove: {path: "repo/bad\u0001name"}
  # byte order beats directory order: "a.txt" (61 2e) < "a/b" (61 2f)
  - symlink: {path: repo/a/b, target: missing}
  - fifo: {path: repo/a.txt}
  - run: {cwd: repo, args: [status], expect: [{type: exit_code, value: 1}, {type: stderr_equals, value: "snap: unsupported working tree entry: a.txt\n"}]}
  - remove: {path: repo/a.txt}
  - run: {cwd: repo, args: [status], expect: [{type: exit_code, value: 1}, {type: stderr_equals, value: "snap: unsupported working tree entry: a/b\n"}]}
  - remove: {path: repo/a}
  # empty directory with invalid name is ignored
  - mkdir: {path: "repo/dir\\empty"}
  - run: {cwd: repo, args: [status], expect: [{type: exit_code, value: 0}, {type: stdout_equals, value: "version ()\n"}, {type: stderr_equals, value: ""}]}
  - assert:
      - {type: json_equals, path: repo/.snap/repository.json, value: {format: 1, frontier: [], patches: []}}
```

### Step 5 — `tests/30-non-integer-json-lexemes.yaml`

Covers decision 2. Three repositories, each valid except for one integer-valued non-integer lexeme: `"revision": 1.0`, a `frontier` pair `["a@x", 1e0]`, and `"format": 1.0`. Each `status` run expects exit 1, empty stdout, and `stderr_matches`: `^snap: .+positive safe integer\n$` for revision (consistent with `tests/23`), `^snap: .+\n$` for the frontier pair and format (message text for those positions is not otherwise pinned by the suite). Then a fourth write with plain `1` and `status` succeeding with `version (a@x->1)\n` proves the rejection is about the lexeme, not the value. The `description` field states the discriminating alternative (a `JSON.parse`-based reader accepts all three).

### Step 6 — `tests/31-sub-replay-warnings.yaml`

Covers decision 1 with a history where the base-tree sub-replay resolves a conflict the top-level replay does not:

- `a` (a@x) creates `n` = `"n\n"`, commits → `(a@x->1)`.
- `z` (z@x) creates `n` = `"zz\n"`, commits → `(z@x->1)`; merges `../a` → stderr `warning: auto-resolved n: later-create-wins\n`, stdout `(a@x->1,z@x->1)\n`; writes `n` = `"zz2\n"`, commits → `(a@x->1,z@x->2)` with base `(a@x->1,z@x->1)`.
- `m` (m@x) creates `n/x` = `"x\n"`, commits → `(m@x->1)`.
- `m` merges `../z`. Canonical order over ids `a@x < m@x < z@x`: `a1 [1,0,0]`, `m1 [0,1,0]`, `z1 [1,0,1]`, `z2 [1,0,2]`. `m1` removes `n` (`namespace-wins` on `n`), `z1` removes `n/x` (`namespace-wins` on `n/x`) and installs `n="zz\n"`, `z2`'s base sub-replay resolves `(n, later-create-wins)` but at top level `n` is identical in `B` and `C` so the edit applies directly.
- Expected stderr exactly: `warning: auto-resolved n: namespace-wins\nwarning: auto-resolved n/x: namespace-wins\n`; stdout `(a@x->1,m@x->1,z@x->2)\n`. Under the rejected reading, `warning: auto-resolved n: later-create-wins` would precede these. Assert `m/n` = `"zz2\n"` and `m/n/x` absent; re-merge prints no warnings.
- The `description` field records the hand-derived canonical order and why the rejected reading produces different bytes.

### Step 7 — README.md paths

Replace `./capstones/snap/run` → `./run` (lines 42, 43, 52), `/path/to/ai-workshop/capstones/snap/run` → `/path/to/snap/run` (line 46), `./capstones/snap/verify` → `./verify` (lines 78, 90).

## Tasks

- [ ] Edit `SPEC.md` §4.1 (lines 188–194): define integer lexeme `-?(0|[1-9][0-9]*)` as the one exception to parsed-value authority; list `1.0`, `1e0`, `1.5` as non-integer.
- [ ] Edit `SPEC.md` §6.2 (after line 342) and §6.4 (line 423): base materialization is a sub-replay whose warnings are discarded; replay returns only top-level warning pairs.
- [ ] Edit `SPEC.md` §2 (after line 64): add the invalid-working-tree-path bullet; directories only traversed.
- [ ] Edit `SPEC.md` §10 (lines 712–713): failure on unsupported entry or invalid path; least path in unsigned UTF-8 byte order is reported; both exact error lines; path printed verbatim.
- [ ] Create `tests/29-working-tree-scan-failures.yaml` per Step 4.
- [ ] Create `tests/30-non-integer-json-lexemes.yaml` per Step 5.
- [ ] Create `tests/31-sub-replay-warnings.yaml` per Step 6, hand-checking the canonical order and expected warnings in the file's `description`.
- [ ] Edit `README.md` lines 42, 43, 46, 52, 78, 90 to the root `./run` / `./verify` entry points.
- [ ] Run `./verify --list` to confirm the three new files load and are discovered as 29–31.

## Documentation Impact

- `SPEC.md`: §2, §4.1, §6.2, §6.4, §10 as above. §11 needs no change (item 2 already requires "path" validation coverage; item 5 covers warning order).
- `README.md`: six path fixes; no other content changes.
- `dev-docs/stacks/snap-1.0.md`: the five unchecked "Spec clarifications" items become checkable at `/close-issue`; not edited by this plan.
- Not edited: `TEST-HARNESS.md` (stale `capstones/snap/` at lines 371–373, 389, 402 — candidate for a separate local issue), `dev-docs/designs/approved/snap-ts-architecture.md` (immutable; its open-questions section is superseded by `SPEC.md`), research docs, `ts/`.

## Acceptance Tests

- `./verify --list` exits 0 and lists 31 cases including `29-working-tree-scan-failures`, `30-non-integer-json-lexemes`, `31-sub-replay-warnings` (loader validation proves the YAML is well-formed format 1 with no unknown fields).
- `grep -n "capstones" README.md` returns nothing.
- Review reads: each of the four decisions is stated normatively (MUST / is an error) in `SPEC.md` and each has exactly one YAML case whose expected bytes differ under the rejected alternative (documented in each case's `description`).
- Manual walk-through of `tests/31-sub-replay-warnings.yaml` against §6.1–§6.4 confirms the order `a1, m1, z1, z2` and the two `namespace-wins` warnings; recorded in the file's `description`.
- No files under `ts/`, `test-harness/`, or `TEST-HARNESS.md` change (`git status` after implementation).
- The new cases are expected to fail against the current `ts/` stub; that is the intended state until the implementation issues land.
