---
title: "Snap TypeScript architecture"
date: 2026-09-04
author: agent
id: snap-ts-architecture
---
# Snap TypeScript architecture

## Related Work

This is an intent design for the whole `ts/` implementation. It is not tied to one plan; it is the architectural frame that every plan derived from stack `snap-1.0` implements. It draws on research `snap-performance-and-data-structures` and `snap-prior-art`. Realized designs written by `/design-implementation` should cite this document and record where they deviate.

## Overview

`SPEC.md` fixes Snap's observable behavior byte for byte and mandates three costs no implementation can avoid: a full validation replay on every command (§4.5), an `O(n·m)` canonical text diff per concurrent text change (§5, §6.2), and a whole-file `repository.json` read and rewrite per commit (§4.1, §10). Within those, the research identified one algorithmic trap (exact-base materialization in §6.2 is exponential without memoization) and a set of JavaScript defaults that silently produce wrong bytes (UTF-16 string ordering, lossy `JSON.parse`, lenient base64, BOM-stripping decoders, asynchronous piped stdout, redirect-following `fetch`).

This design makes those choices once so that no plan has to rediscover them. It also fixes the module layout required by `AGENTS.md` (versions, text/diff and OT, validation and replay, filesystem materialization, working-tree changes, HTTP, commands, CLI dispatch) and the test strategy that satisfies §11.

## Design

### Locked decisions

1. **Versions** are sorted `[id, revision][]` arrays. Every `Map` or `Set` keyed by a version uses the canonical `(a@x->1,b@x->2)` string, because JavaScript collections compare arrays by reference. Comparison (all four §3.3 outcomes), `join`, and Snap order (§3.4) are single merge-walks over two sorted arrays.
2. **One byte-order comparator** (a `codePointAt` walk, or `Buffer.compare` on UTF-8) is used for every observable ordering: paths (§2), contributor IDs (§3.2), `changes` (§4.2), warning pairs (§6.4). String `<` and default `Array.prototype.sort` are never used on user-visible strings.
3. **File contents are `Uint8Array` end to end.** Text is a derived view. A file is text iff `buffer.isUtf8` passes and no NUL byte is present (§4.4). Decoding uses `TextDecoder("utf-8", { fatal: true, ignoreBOM: true })` so a leading BOM survives round-trip.
4. **A strict JSON reader** (single-pass recursive descent) is used for repository and configuration input. It rejects duplicate keys, non-integer numbers, integers outside the safe range, and unknown fields (§4.1, §8). `JSON.parse` is never used for these inputs. `JSON.stringify` may be used for output because writers control the shape.
5. **The §5 diff is the direct suffix-table DP** with the forward walk and delete-on-tie rule, over interned integer tokens in a flat `Int32Array`. Common-prefix trimming is applied (safe: equal tokens always retain). Common-suffix trimming is not (the research shows a counterexample). Myers, Hirschberg, or banded variants may be introduced only with an exhaustive small-alphabet oracle test against the DP.
6. **Replay materializes each patch's exact base via a memo** keyed by canonical version string. The memo is seeded by snapshotting the running `(I, C)` state whenever the integrated vector `I` equals a version some later patch names as its base, and the `I == base ⇒ C is B` shortcut avoids the memo entirely on linear histories. A recursive un-memoized `materialize` is forbidden.
7. **Trees are `Map<string, Uint8Array>`**, copied per integration with byte arrays shared by reference. Prefix-freeness (§2) and the §6.2 namespace ancestor/descendant queries use an ancestor `Set` of path prefixes, never an adjacent-pair scan after sorting.
8. **Each command replays once** and reuses the frontier tree and warning set. `merge` needs exactly three replays (local, remote, joined). Installation is a delta from the clean current tree to the target tree. `repository.json` is replaced through a same-directory temporary file and `renameSync`, after working files are written (§10).
9. **All output is written through one point** in the CLI layer using `fs.writeSync` on file descriptors 1 and 2, and the process exits by setting `process.exitCode` and returning. `process.exit()` is never called after a write. The `--serve` startup URL is written the same way and is always plain (§7.9, §7.11).
10. **Synchronous `fs` everywhere** except `--serve` and the HTTP client, which use `http`/`https` directly (`http.get` never follows redirects, satisfying §9's exact-200 requirement). The module graph stays small and free of top-level work so tsx cold start under the harness's per-case `TMPDIR` stays near 0.12 s.

### Module layout (`ts/src/`)

One responsibility per file. Commands are pure: parsed arguments in, an output record out; they never write to stdout or stderr.

- `core/bytes.ts` — byte-order comparator, `isText`, strict base64 decode/encode with canonical round-trip check, UTF-8 decode helper.
- `core/errors.ts` — `SnapError` (expected, exit 1) and the internal-failure path (exit 2); the single `snap: <detail>` formatting point.
- `core/version.ts` — `Version`, parse and format for CLI and JSON forms with all §3.2 rejections, `compare`, `join`, `snapOrder`, `isKnown`.
- `core/json.ts` — strict JSON reader producing a typed value.
- `text/tokens.ts` — §4.4 tokenizer (LF-retaining `indexOf` loop) and interning table.
- `text/edit.ts` — edit-script union, §4.4 well-formedness validation, `apply`, `coalesce`.
- `text/diff.ts` — §5 canonical script.
- `text/transform.ts` — §6.3 inclusion transform.
- `repo/model.ts` — `Patch`, `Change`, `Repository`; decode from strict JSON with exact schema; canonical encode (two-space indent, trailing LF); canonical serialization for structural dot equality.
- `repo/tree.ts` — `Tree`, ancestor-set helpers, prefix-free check, namespace queries, byte-ordered iteration.
- `repo/validate.ts` — §4.5 steps 1–5.
- `repo/replay.ts` — §6.1 selection with integrated vector, §6.2 integration with base memo, namespace rule, §6.4 winner table and warning set; serves as §4.5 step 6 and cycle detection (Kahn's algorithm by construction).
- `fs/locate.ts` — nearest-repository walk, `.snap` layout, §8 configuration resolution.
- `fs/worktree.ts` — `readdirSync({ withFileTypes: true })` scan, unsupported-entry failure, root `.snap` exclusion, byte-ordered result as a `Tree`.
- `fs/materialize.ts` — delta install (deletes, prune empty directories, create directories, writes) and atomic `repository.json` replacement.
- `http/server.ts` — §7.9 server.
- `http/client.ts` — single GET, exact 200, buffered body to the strict reader.
- `commands/{init,config,status,log,commit,diff,revert,merge,serve,version}.ts` — one file per command.
- `cli/args.ts` — §7 positional grammar.
- `cli/presentation.ts` — §7.11 plain and terminal rendering, `SNAP_COLOR`/`NO_COLOR` resolution per stream, TTY detection injected for testability.
- `cli/main.ts` — environment validation, dispatch, error-to-exit-code mapping, flushed writes. `src/main.ts` only calls it.

### Test strategy

- **Acceptance** is `./verify --lang ts`, filtered per phase and run in full at every gate. The YAML suite is the acceptance criterion and cannot be replaced (`AGENTS.md`).
- **Unit tests** use Node's built-in `node --test` under `ts/test/`, run through tsx (`"test": "node --import tsx --test test/**/*.test.ts"`). No new dependency. They cover oracles the YAML format cannot express: the §5 tie case `a\nb\n → b\na\n` and the suffix-trim counterexample `[b] → [a,b,b]`; every §6.3 table row; version algebra laws; each strict-JSON rejection; the UTF-16/UTF-8 ordering divergence (U+FF01 versus U+1F600); base64 canonical rejection of `AR==`; a materialize-call count bound on a concurrent history; and `SNAP_COLOR=auto` TTY selection per stream, which §11 explicitly requires of every implementation.
- **Property tests** (final phase) generate random valid causal patch graphs and assert that every import permutation yields the same frontier, patch set, warning set, and tree bytes (§11 SHOULD; §6.5 guarantee).

### Phase ordering

Stack `snap-1.0` sequences work so that each gate is a set of green suites: spec clarifications and scaffolding; foundations; CLI skeleton and configuration; text core; repository model and validation (validation suites need no concurrency); working tree and everyday commands; concurrent replay and merge; HTTP; terminal presentation; hardening. The text core and the CLI skeleton are independent and may proceed in parallel.

## Alternatives Considered

- **`JSON.parse` with a reviver and `Number.isSafeInteger`.** Rejected: a reviver cannot see duplicate keys and `JSON.parse` has already rounded unsafe integers before the reviver runs. `tests/25-config-version-path-boundaries.yaml` requires the duplicate-key error.
- **Myers `O(ND)` diff from the start.** Rejected: §5 pins a specific script via its tie rule; Myers's furthest-reaching tie preference has not been shown equivalent, and the suite's inputs are at most five lines. Kept as an oracle-tested option for later.
- **Persistent hash-trie trees.** Rejected for now: `ts/AGENTS.md` restricts production code to Node built-ins, so this means writing one; `O(F)` map copies with shared contents are adequate until a scale smoke says otherwise.
- **Per-patch tree cache in a memo without the `I == base` shortcut.** Rejected as the sole mechanism: the shortcut makes linear histories `O(P)` with no memory cost and is one comparison.
- **Async `fs` throughout.** Rejected: the CLI is single-shot and sequential; sync calls are simpler, avoid thread-pool hops, and cannot leave unhandled rejections.
- **`fetch` for the HTTP client.** Rejected: follows redirects by default; `tests/13-http-client.yaml` requires a 302 to fail.
- **Recording the roadmap as one plan.** Rejected: `dev-docs/plans/approved/` is an active-artifact directory and would block every subsequent `/plan-issue`. The roadmap lives in stack `snap-1.0` (checklist) and this design (decisions).

## Open Questions

These are spec ambiguities, not design choices, and are the first stack item. They must be settled in `SPEC.md` with YAML regression cases before code depends on them:

- Whether warnings produced while materializing a base tree contribute to the replay warning set (§6.4). Proposed answer: no; only the top-level replay counts.
- Whether `1.0` or `1e0` in repository JSON is a non-integer error given that "the parsed typed value is authoritative" (§4.1). Proposed answer: error, checked on source text.
- How commands treat working-tree entries whose names are not valid tracked paths (§2, §10). Proposed answer: fail with a distinct `snap:` message, like unsupported entries.
- Which unsupported entry is reported when several exist (§10). Proposed answer: the first in byte order.
