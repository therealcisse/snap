---
title: "ts/ has no command line: argument grammar, color resolution, init, config, --version, and the repository walk do not exist, so no suite from tests/01 onward has anything to run against"
date: 2026-09-05
start-date: 2026-09-05
author: agent
id: cli-skeleton-and-configuration
stack: snap-1.0
closed: 2026-09-05
---
# ts/ has no command line: argument grammar, color resolution, init, config, --version, and the repository walk do not exist, so no suite from tests/01 onward has anything to run against

## Problem

Running any Snap command today just prints `snap: not implemented: <arguments>` and exits 1. Nothing interprets a command line: there is no argument grammar, no option/error handling, no decision about where output goes or whether it is colored, no way to create a repository, no way to set a contributor, and no walk that finds the repository a command runs inside. Snap cannot be used or tested as a program at all.

Technically, `ts/src/cli/main.ts` contains only the `run`/`fdOutput` skeleton from `toolchain-scaffolding`; `dispatch` throws `SnapError('not implemented: <args>')` for everything. Missing are: the §7 positional grammar (at-most-once options, unknown/extra/missing-argument errors — `tests/24-cli-grammar-matrix.yaml`, `tests/14-cli-errors.yaml`), `SNAP_COLOR`/`NO_COLOR` resolution per stream with the invalid-value error raised before execution (§7.11, including the §11 unit test for `auto` TTY selection on stdout and stderr independently), `snap init [path]` (§7.1 — `tests/01-init.yaml`, `tests/02-init-paths.yaml`), `snap config [--global] contributor.id <id>` with local-over-global resolution (§7.2, §8 — `tests/03-configuration.yaml`), `snap --version` (§7.10), and the nearest-repository walk (§7). `ts/src/fs/locate.ts` holds only `decodeConfiguration` from `core-foundations`; the walk and the resolution order are unimplemented.

## Impact

- Six acceptance suites are unreachable: `tests/01`, `tests/02`, `tests/03`, `tests/14`, `tests/19`, and `tests/24` — the largest single block of pinned behavior outside the foundations, covering usage errors, version-boundary CLI errors, and configuration precedence.
- Every later section (status, log, commit, diff, revert, merge, serve) routes through this grammar, the repository walk, and configuration resolution; none can be built or accepted until the skeleton exists.
- `init` is the only producer of a `repository.json`; until it exists, no fixture for any later suite can be created by the tool itself.
- The `contributor.id is required` error (§8) has no home yet; commands that need a contributor — starting with `commit` in a later section — depend on the resolution landed here.

## Context

- Spec sections: §7 preamble (grammar rules, repository discovery), §7.1 `init`, §7.2 `config`, §7.10 `--version`, §7.11 (color resolution only; rendering is the later Terminal presentation section), §8 (config file shape, local-over-global precedence, `$HOME` absent, `contributor.id is required`), §10 (exit codes, single `snap: <detail>` line, UTF-8/LF output).
- `tests/03` line 70's `{"contributor":{"id":"global@example.com"}}}}` is the harness `}}}}` → `}}` escape; configuration reading is strict per the §4.1/§8 trailing rule settled in `core-foundations` (`tests/32`).
- Existing: `cli/main.ts` (`run`, `fdOutput` with `writeSync`, `process.exitCode` — the flushed-writes stack item is largely satisfied and needs verification, not rebuilding), `core/errors.ts`, `fs/locate.ts` `decodeConfiguration`, `core/version.ts` `parseVersion` for `<version>`-shaped arguments (`tests/19`).
- Settled by design `snap-ts-architecture` and `ts/AGENTS.md`: `commands/` holds one file per command, pure (arguments in, output record out); `cli/` holds args parsing, presentation, and `main`; all stream writes go through `cli/main.ts`; synchronous `fs`; `process.exitCode`, never `process.exit()`; module graph small (the harness starts ~300 processes with a cold tsx cache).
- `init` must write a spec-conforming empty `repository.json` (§4.1 canonical form: two-space indent, trailing LF) and create the `.snap` directory; the full canonical encoder for non-empty repositories belongs to the later Repository model section, so this issue needs at least the empty-repository encoding — where it lives is a plan decision. `snap config` similarly writes the §8 file shape.
- Stack: `snap-1.0` → "CLI skeleton and configuration" (eight items).

## Out of Scope

- Any command beyond `init`, `config`, and `--version`: `status`, `log`, `commit`, `diff`, `revert`, `merge`, and `--serve` (later sections; they remain `not implemented`).
- Terminal presentation rendering for §7.11 beyond the output these three commands produce (`tests/28-terminal-presentation.yaml` is its own section); this issue lands the resolution machinery and the plain-mode output the suites pin.
- The canonical repository encoder for non-empty repositories and structural-equality serialization (Repository model section); only the empty-repository encoding `init` requires.
- Working-tree scan, materialization, replay, HTTP client/server behavior.
- Making any suite other than `tests/01`, `02`, `03`, `14`, `19`, `24` pass.

## Plan Closeout Notes

<!-- plan-close-review: cli-skeleton-and-configuration -->

- Scope: no drift; seven refinable deviations recorded in design `cli-skeleton-and-configuration` (Plan Realized section).
- Documentation impact: none recorded; the plan's none-impact on `AGENTS.md`/`README.md` was verified (`git diff --quiet` clean on the drift set).
- Guidelines / conventions: none recorded.
- Comments / docstrings: conform.
- Stack items satisfied (`snap-1.0`, "CLI skeleton and configuration"): §7 grammar (tests/24); `SNAP_COLOR`/`NO_COLOR` per-stream resolution with the §11 unit test; flushed writes via `process.exitCode`; `init` (tests/01, tests/02); `--version`; nearest-repository walk. Deferred to the everyday-commands issue: `config … tests/03` and `tests/14, tests/19 green`.

<!-- /plan-close-review -->
