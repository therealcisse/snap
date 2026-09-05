---
name: snap-1.0
description: TypeScript implementation of SPEC.md under ts/ passing all 32 acceptance suites via ./verify --lang ts, plus the §11 unit and property tests the YAML harness cannot express
created: 2026-09-04
---

# Snap 1.0

Sections follow the roadmap phases in design `snap-ts-architecture`. Items are implementation state derived from `SPEC.md` and `tests/`; each names the spec section or suite it satisfies. Order within a section is priority.

## Spec clarifications

- [x] Sub-replay warnings: state whether warnings from materializing a base tree contribute to the replay warning set (§6.4); add a YAML regression case.
- [x] Non-integer JSON numbers: state whether `1.0` / `1e0` in repository JSON is an error (§4.1); add a YAML regression case.
- [x] Working-tree entries with invalid tracked-path names (backslash, control characters): state the failure behavior (§2, §10); add a YAML regression case.
- [x] Multiple unsupported entries: state which one is reported (§10); add a YAML regression case.
- [x] Stale `./capstones/snap/` paths corrected in `ts/AGENTS.md`.
- [x] Stale `./capstones/snap/` paths corrected in `README.md`.

## Scaffolding

Toolchain per research `ts-toolchain-conventions` §7 (ESLint lane, TypeScript 6.0.x).

- [x] `tsconfig.json` delta: `module: nodenext`, `target: es2024`, `types: ["node"]`, `verbatimModuleSyntax` (replacing `isolatedModules`), `erasableSyntaxOnly`, `allowImportingTsExtensions`, `rewriteRelativeImportExtensions`, `noUncheckedSideEffectImports`, `exactOptionalPropertyTypes`, `noPropertyAccessFromIndexSignature`, `noImplicitReturns`, `noUnusedLocals`, `noUnusedParameters`.
- [x] Dev dependencies pinned: `typescript ~6.0.3`, `@types/node ^24`, `eslint ^10`, `@eslint/js`, `typescript-eslint ^8`, `eslint-plugin-import-x ^4`, `prettier ^3.9`, `fast-check ^4`, `simple-git-hooks ^2`; `tsx` retained.
- [x] `eslint.config.js` with `strictTypeChecked` + `stylisticTypeChecked`, `projectService`, `switch-exhaustiveness-check`, `require-array-sort-compare { ignoreStringArrays: false }`, `explicit-module-boundary-types`, `consistent-type-imports`; import-x `extensions: always`, `enforce-node-protocol-usage`, `no-duplicates`, `order`.
- [x] `eslint.config.js` API bans on `src/**` with messages: `JSON.parse` (override off for `src/core/json.ts`), `process.exit`, global and `globalThis.fetch`, `localeCompare`, `console.log`/`console.error`, `toString('utf8')` probe, `TextDecoder` without `fatal`, `TSEnumDeclaration`; `no-non-null-assertion` and `no-unsafe-assignment` off for `*.test.ts`.
- [x] `.prettierrc.json` (printWidth 100, singleQuote, trailingComma all, arrowParens always, endOfLine lf) and `.prettierignore`.
- [x] `package.json` scripts: `typecheck`, `lint`, `lint:fix`, `format`, `format:check`, `test` (`node --test`), `test:watch`, `check` (format:check && lint && typecheck && test), `prepare` (`simple-git-hooks`); `simple-git-hooks.pre-commit` runs `cd ts && npm run check`.
- [x] Unit tests colocated as `src/**/*.test.ts`; relative imports carry `.ts` extensions so `node --test` and `./snap` run without `tsx`.
- [x] `src/main.ts` delegates to `src/cli/main.ts`; `npm run check` passes on the empty skeleton.
- [x] Expected-error (exit 1) vs internal-failure (exit 2) error type with single `snap: <detail>` formatting point (§10).

## Foundations

- [x] Byte-order comparator used for every observable ordering (§2, §3.2); unit test on the UTF-16/UTF-8 divergence (U+FF01 vs U+1F600).
- [x] Version parse and format for CLI and JSON forms with every §3.2 rejection; unit tests for duplicate ID, zero, leading zero, overflow at `9007199254740992`, whitespace, non-canonical order, invalid ID shapes (§3.1).
- [x] Four-outcome comparison, `join`, Snap order (§3.3, §3.4); unit tests for join laws and Snap order extending causal order.
- [x] Strict JSON reader rejecting duplicate keys, non-integer and unsafe numbers, unknown fields (§4.1, §8); unit tests for each rejection.
- [x] Text detection (valid UTF-8, no NUL) and BOM-preserving decode (§4.4).
- [x] Canonical padded base64 decode with round-trip check (§4.3); unit test rejects `AR==`.

## CLI skeleton and configuration

- [x] Positional grammar with at-most-once options and unknown/extra/missing errors (§7) — `tests/24-cli-grammar-matrix.yaml`.
- [x] `SNAP_COLOR` / `NO_COLOR` resolution per stream with invalid-value error before execution (§7.11); unit test for `auto` TTY selection on stdout and stderr independently (§11).
- [x] Flushed stdout/stderr writes; `process.exitCode`, never `process.exit()` after writes (§10).
- [x] `snap init [path]` (§7.1) — `tests/01-init.yaml`, `tests/02-init-paths.yaml`.
- [x] `snap config [--global] contributor.id <id>` and local-over-global resolution (§7.2, §8) — `tests/03-configuration.yaml`.
- [x] `snap --version` (§7.10).
- [x] Nearest-repository walk (§7).
- [x] `tests/14-cli-errors.yaml`, `tests/19-version-boundaries.yaml` green.

## Text core

- [x] §4.4 tokenizer (LF-retaining); unit tests for `"a\r\nb"`, empty file, missing final LF.
- [x] Edit-script union with well-formedness validation, apply, coalesce (§4.4); unit tests for adjacent same-kind, under/over-consumption, empty insert.
- [x] §5 canonical diff: suffix-table DP, forward walk, delete-on-tie, prefix trim only; unit tests for the `a b a -> b a a` golden, the true tie case `a\nb\n -> b\na\n`, and the suffix-trim counterexample `[b] -> [a,b,b]`.
- [x] §6.3 inclusion transform; unit tests for every table row, the trailing-insert case, and an apply/transform oracle on random small inputs.

## Repository model and validation

- [x] Typed `Patch`, `Change`, `Repository` decode with exact schema and canonical two-space encode with trailing LF (§4.1–§4.3).
- [x] Canonical structural-equality serialization for dot comparison (§3.5, §4.2, §7.6).
- [x] Tree type with ancestor-set prefix-free check and namespace ancestor/descendant queries (§2, §6.2).
- [x] §4.5 steps 1–5: schema, sort order, dot uniqueness, contiguity, closure, `revision = base[author] + 1`, change-vs-base — `tests/15-repository-validation.yaml`, `tests/23-strict-validation-matrix.yaml`, `tests/27-history-canonicality.yaml`.
- [x] Linear-history replay (single ready patch, `I == base`) as §4.5 step 6.

## Working tree and everyday commands

- [x] Working-tree scan: `withFileTypes`, unsupported-entry failure, root `.snap` exclusion, byte-order sorted (§2, §10) — `tests/08-unsupported-entries.yaml`.
- [x] Delta install (deletes, prune empty dirs, mkdir, writes) and same-directory temp-file + rename for `repository.json`, working files first (§6.2, §10).
- [x] `snap status` (§7.3) and `snap log` with message escaping (§7.4) — `tests/04-commit-status-log.yaml`.
- [x] `snap commit <message>`: text/put/delete selection, 4096-byte limit, dirty-tree requirement (§7.5).
- [x] `snap diff` and `snap diff <old> <new>` with whole-file unified blocks, `/dev/null`, `\ No newline at end of file`, `Binary files … differ` (§7.6) — `tests/05-diff-goldens.yaml`, `tests/06-binary-and-empty.yaml`.
- [x] `snap revert <version>` with additive patch and `target tree is already current` error (§7.7) — `tests/07-revert.yaml`.
- [x] One replay per command with frontier tree and warning set reused.
- [x] `tests/25-config-version-path-boundaries.yaml` green.

## Concurrent replay and merge

- [x] §6.1 ready-set selection via integrated vector with Snap-order and author/revision tie-break; cycle and missing-dependency failure.
- [x] Exact-base materialization memo keyed by canonical version string, seeded by snapshotting known-base states, with `I == base` shortcut; unit test asserting materialize calls ≤ P+1 on a three-contributor concurrent history.
- [x] §6.2 rules 1–4 with namespace rule applied before per-path rules.
- [ ] §6.4 winner table and sorted unique warning set — `tests/10-merge-conflicts.yaml`, `tests/11-namespace-conflicts.yaml`, `tests/17-concurrent-creates.yaml`.
- [ ] Text OT integration path — `tests/09-merge-text.yaml`, `tests/22-ot-matrix.yaml`.
- [ ] `snap merge <path>`: two validations, dot-keyed union with corruption detection, frontier join, joined replay, warning difference, dirty-tree refusal, validation before mutation (§7.8, §10) — `tests/16-dot-collision.yaml`, `tests/20-dirty-merge.yaml`, `tests/26-portability-and-failure-safety.yaml`.
- [ ] Convergence — `tests/18-three-way-convergence.yaml`, `tests/21-version-algebra.yaml`.

## HTTP

- [ ] `snap --serve [port]` on 127.0.0.1 with GET/HEAD `/repository.json`, 404, 405 with `Allow`, plain flushed startup URL, SIGINT/SIGTERM exit 0 (§7.9, §9) — `tests/12-http-server.yaml`.
- [ ] HTTP repository operand: single GET, status 200 required, no redirects, strict parse (§9) — `tests/13-http-client.yaml`.
- [ ] `snap diff <old> <new> --repo <repository>` local and HTTP with cross-repository dot check (§7.6).
- [ ] `snap merge <url>` (§7.8).

## Terminal presentation

- [ ] §7.11 terminal rendering for init/commit/revert/merge, status, log, diff, `--version`, warnings, errors; `SNAP_COLOR=always` overrides `NO_COLOR`; config silent and serve URL plain — `tests/28-terminal-presentation.yaml`.

## Hardening and performance

- [ ] Property test: random valid causal patch graphs; import-permutation invariance of frontier, patch set, warnings, and tree bytes (§11).
- [ ] Startup profile under the harness's cold `TMPDIR`; module graph kept small.
- [ ] Scale smoke outside the suite (1 000-patch linear history, 100-file tree, 2 000-line diff) recorded as a research note.
- [ ] Full `./verify --lang ts` green; `npm run build` clean; `cd test-harness && npm run check && npm test` unchanged.
