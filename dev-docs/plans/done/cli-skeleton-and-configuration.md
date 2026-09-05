---
title: "Land the CLI skeleton: §7 grammar, SNAP_COLOR resolution, init, config, --version, and the nearest-repository walk"
date: 2026-09-05
author: agent
id: cli-skeleton-and-configuration
issue: cli-skeleton-and-configuration
research: []
designs:
  - snap-ts-architecture
completed: 2026-09-05
closeout_notes: true
---

## Context

Issue `cli-skeleton-and-configuration`: every invocation exits 1 with `not implemented`; the suites that pin argument grammar, init, config, and `--version` (01, 02, 14, 24) cannot run, and tests/03 and tests/19 are blocked on `commit`/`status`/`revert` bodies that belong to the later Working-tree section. This plan lands the argument grammar for **all ten** commands (so every usage error is exact from now on), the §7.11 `SNAP_COLOR`/`NO_COLOR` resolution machinery, the nearest-repository walk and §8 configuration resolution, and the three real commands `init`, `config`, `--version`. Command bodies beyond validation fail exactly as today (`not implemented`).

## Current State

- `ts/src/cli/main.ts`: `run(argv, out)` — try `dispatch` (line 47: throws `SnapError('not implemented: <args>')`), catch → `describeFailure` → `out.stderr`, exit code; `fdOutput()` binds `writeSync` to fds 1/2; `src/main.ts` sets `process.exitCode`.
- Foundations exist: `core/version.ts` `parseVersion`/`versionKey`/`isValidContributorId`, `repo/model.ts` `decodeRepository`, `fs/locate.ts` `decodeConfiguration` only.
- `ts/package.json` has no `version` field; `ts/AGENTS.md` Layout already names `cli/` (args, presentation, main) and `commands/` — no edits needed there.
- `./verify --lang ts`: all 32 cases fail on `not implemented`. Relevant expectations: tests/14 pins `snap: not a Snap repository\n`, `snap: invalid command or arguments\n`, `snap: invalid port: 65536\n`, `usage: snap diff`, `snap <semver>\n`, and a `revert (unknown@x->1)` → `unknown version` failure; tests/24 pins the grammar matrix; tests/01–02 pin `init` output `()\n`, exact empty-repository JSON, `repository already exists`, `cannot initialize inside repository`, nested path creation; tests/03's config steps pin silent success, exact config JSON, and `invalid contributor id: bad-id`.

## Developer Feedback

- **Green-suite target** (user): tests/01, 02, 14, 24 fully green in this issue; tests/03 and tests/19 finish in the everyday-commands issue — their config/grammar steps pass here, the commit-dependent steps still fail. The stack items "config … tests/03" and "tests/14, tests/19 green" stay unchecked until then. Rejected: pulling minimal `commit`/`status`/`revert` bodies forward to green them now (duplicates the Working-tree section and drags in the tree scan).
- **One plan** (uncontested), like the three previous issues.
- **`--version` prints `snap 1.0.0`** (user): SPEC §12 is "Snap v1". Rejected: `0.1.0` until the suite is fully green.
- **Terminal-mode ANSI rendering deferred** (user): this issue lands resolution + validation only; all rendering (including the two layouts that already exist) lands with the Terminal presentation section (tests/28). Until then `SNAP_COLOR=always` prints plain — spec-divergent but untested.
- **Grammar error wording** (agent): one message `invalid command or arguments` for every command except the diff family, which uses `usage: snap diff <old> <new> [--repo <repository>]` (matches the `^snap: usage: snap diff .+\n$` and `usage: snap diff` anchors in tests/14/24).
- **Port validation in the grammar layer** (agent): `--serve [port]` validates digits and range 0–65535 at parse time (`invalid port: <input>`), so tests/14 passes while the server body waits.
- **Operand validation for diff/revert in the dispatch layer** (agent): `parseVersion` + a known-version check run in `cli/main.ts` dispatch arms via `repo/model.ts` helpers; command files appear only when their bodies land. Rejected: stub `commands/{diff,revert}.ts` files that validate then throw.
- **Walk semantics** (agent): the nearest repository is the nearest ancestor of the cwd containing a `.snap` directory; a found root whose `repository.json` is missing is `not a Snap repository` (untested corner).
- **`init` check order** (agent, from tests/02): `.snap` already at the target → `repository already exists`; otherwise a walk hit from the target → `cannot initialize inside repository`; both before any mutation.
- **`config --global` with `$HOME` absent** (agent): `snap: HOME is not set` (untested corner).

## Approach

### Step 1 — `ts/src/cli/args.ts` (§7 grammar)

```ts
export type Command =
  | { kind: 'init'; path: string }                                    // path default '.'
  | { kind: 'config'; global: boolean; id: string }
  | { kind: 'status' } | { kind: 'log' }
  | { kind: 'commit'; message: string }
  | { kind: 'diff'; oldVersion: string; newVersion: string; repo?: string }
  | { kind: 'revert'; version: string }
  | { kind: 'merge'; repository: string }
  | { kind: 'serve'; port: number }                                   // default 8765
  | { kind: 'showVersion' };
export function parseArgs(argv: readonly string[]): Command
```

Rules: `--version` takes nothing else; the command word comes first; options (`--global`, `--repo`) occur exactly in the positions §7 shows and at most once; unknown options, extra operands, and missing option values throw `SnapError('invalid command or arguments')`, except the diff family which throws `SnapError('usage: snap diff <old> <new> [--repo <repository>]')`. `init` rejects leading-`-` paths (tests/24 `init --unknown`); `commit`/`revert`/`merge` take their single operand verbatim. `--serve` port: all digits, value ≤ 65535, else `SnapError(\`invalid port: ${text}\`)`. Empty argv → `invalid command or arguments`.

### Step 2 — `ts/src/cli/presentation.ts` (§7.11 resolution)

```ts
export type Presentation = 'plain' | 'terminal';
export interface StreamModes { stdout: Presentation; stderr: Presentation }
export function resolveModes(
  env: Readonly<Record<string, string | undefined>>,
  isStdoutTty: boolean,
  isStderrTty: boolean,
): StreamModes
```

`always` → terminal on both (overrides `NO_COLOR`); `never` → plain both; unset or `auto` → per-stream TTY, unless `NO_COLOR` is present (any value, including empty) → plain both; any other value → `SnapError('SNAP_COLOR must be auto, always, or never')`. Rendering itself is deferred; only the resolution and its error land now.

### Step 3 — `ts/src/cli/main.ts` (context + dispatch)

```ts
export interface Context {
  readonly out: Output;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly cwd: string;
  readonly isStdoutTty: boolean;
  readonly isStderrTty: boolean;
}
export function run(argv: readonly string[], ctx: Context): number
```

`run` resolves modes first (invalid `SNAP_COLOR` fails plain before command execution), then `parseArgs`, then dispatch. `init`/`config`/`--version` call `commands/{init,config,version}.ts` and write their output records; `status`/`log`/`commit`/`merge` walk first (so outside a repository the error is `not a Snap repository`) then throw `not implemented`; `diff`/`revert` walk, `loadRepository`, `parseVersion` each operand, and check known versions (`SnapError(\`unknown version: ${text}\`)`) before `not implemented`; `serve` throws `not implemented`. `src/main.ts` builds the context from `process`.

### Step 4 — `ts/src/fs/locate.ts` (walk + §8 resolution + encode)

```ts
export function findRepositoryRoot(startDir: string): string            // throws 'not a Snap repository'
export function loadRepository(startDir: string): Repository
export function resolveContributorId(startDir: string, env): ContributorId | undefined
export function encodeConfiguration(id: ContributorId): string
```

`resolveContributorId` reads local `.snap/config.json` first (missing file or no ID → fall through; malformed → throw), then `$HOME/.snapconfig.json` (missing → undefined; malformed → throw; `$HOME` absent → unavailable). `encodeConfiguration` emits the canonical two-space form + trailing LF.

### Step 5 — `ts/src/repo/model.ts` (empty-repository bytes + known versions)

```ts
export const EMPTY_REPOSITORY_JSON: string   // '{\n  "format": 1,\n  "frontier": [],\n  "patches": []\n}\n'
export function knownVersionKeys(repository: Repository): ReadonlySet<string>
```

`knownVersionKeys` = `versionKey(EMPTY_VERSION)` plus each patch's result version (`base` with the author's component set to `revision`; private helper).

### Step 6 — `ts/src/commands/` (three commands, pure)

```ts
export interface CommandOutput { readonly stdout: string; readonly stderr: string }
// version.ts: export const SEMVER = '1.0.0';  returns { stdout: `snap ${SEMVER}\n`, stderr: '' }
// init.ts:   export function init(path: string, cwd: string): CommandOutput
// config.ts: export function config(id: string, opts: { global: boolean; cwd: string; home: string | undefined }): CommandOutput
```

`init`: resolve target against cwd, create it recursively; `.snap` at target → `repository already exists`; ancestor walk hit → `cannot initialize inside repository`; then `mkdir .snap`, write `EMPTY_REPOSITORY_JSON`, print `()\n`. `config`: validate the ID (`invalid contributor id: <id>`) before anything; `--global` writes `encodeConfiguration` to `$HOME/.snapconfig.json` (`HOME is not set` when absent), otherwise to the nearest repository's `.snap/config.json`; silent on success ("preserves no unknown fields" = always write the full canonical shape).

### Step 7 — Unit tests (colocated, `node:test`)

- `cli/args.test.ts`: the full tests/24 matrix plus tests/14 grammar cases; ports 0/8765/65535 accepted, 65536/`-1`/`abc` rejected with exact messages; `commit` operand verbatim; empty argv.
- `cli/presentation.test.ts`: §7.11 truth table; `auto` with TTY stdout + non-TTY stderr → mixed modes (the §11-required per-stream unit test); `NO_COLOR=""`; `always` overriding `NO_COLOR`; invalid value message.
- `commands/init.test.ts` (tmpdir fixtures): exact `repository.json` bytes, `()\n`, nested creation, existing file preserved, both error messages, no `.snap` left behind on the nested error.
- `commands/config.test.ts`: exact config bytes local and global (injected `home`), invalid id before write, local outside a repository → `not a Snap repository`, `HOME is not set`.
- `fs/locate.test.ts` (extend): walk nearest/root-stop/miss; `loadRepository`; `resolveContributorId` precedence table (local wins, local-without-id → global, malformed local/global → error only when read, both missing → undefined, `HOME` absent).
- `repo/model.test.ts` (extend): `EMPTY_REPOSITORY_JSON` exact string and round-trips through `decodeRepository`; `knownVersionKeys` on a two-patch fixture.
- `cli/main.test.ts` (update): context-based `run`; `--version` green; unknown command; `SNAP_COLOR=bogus`; status outside a repository; `revert` unknown-version inside one.

### Step 8 — Verify

`npm run format`, `npm run check` green; `./verify --lang ts --filter 01-init`, `02-init-paths`, `14-cli-errors`, `24-cli-grammar-matrix` all green; `--filter 03-configuration` fails first at `commit local-wins` and `--filter 19-version-boundaries` first at `commit one` (all earlier steps passing); `./verify --list` still 32.

## Tasks

- [ ] Create `ts/src/cli/args.ts` (`Command`, `parseArgs`) per Step 1.
- [ ] Create `ts/src/cli/presentation.ts` (`resolveModes`) per Step 2.
- [ ] Rewrite `ts/src/cli/main.ts` (`Context`, `run`, dispatch) and `src/main.ts` per Step 3.
- [ ] Extend `ts/src/fs/locate.ts` (`findRepositoryRoot`, `loadRepository`, `resolveContributorId`, `encodeConfiguration`) per Step 4.
- [ ] Extend `ts/src/repo/model.ts` (`EMPTY_REPOSITORY_JSON`, `knownVersionKeys`) per Step 5.
- [ ] Create `ts/src/commands/version.ts`, `commands/init.ts`, `commands/config.ts` per Step 6.
- [ ] Create/extend the seven test files of Step 7.
- [ ] Run `npm run format`, then `npm run check`; fix until green.
- [ ] Run the four green-suite filters and the two expected-partial filters; confirm `--list` = 32.

## Documentation Impact

- `SPEC.md`, `tests/`: none — no new ambiguity discovered so far; if implementation reveals one, correct the spec in the same commit with a regression case (root `AGENTS.md`).
- `ts/AGENTS.md`, root `AGENTS.md`, `README.md`: none; the Layout and Conventions sections already describe these modules.
- Stack `snap-1.0` "CLI skeleton and configuration": six of eight items become checkable at `/close-issue` (grammar, `SNAP_COLOR` resolution, flushed writes, `init`, `--version`, walk); the `config … tests/03` and `tests/14, tests/19` bundle items stay unchecked until the everyday-commands issue (Developer Feedback, green-suite target).

## Acceptance Tests

- `cd ts && npm run check` exits 0.
- `./verify --lang ts --filter 01-init`, `02-init-paths`, `14-cli-errors`, and `24-cli-grammar-matrix` all report green.
- `./verify --lang ts --filter 03-configuration` fails at `commit local-wins` with every earlier step passing; `--filter 19-version-boundaries` fails at `commit one` with every earlier step passing.
- `node ts/src/main.ts --version` outside any repository prints `snap 1.0.0\n`, exit 0.
- `SNAP_COLOR=bogus ts/snap --version` prints `snap: SNAP_COLOR must be auto, always, or never\n`, exit 1.
- Unit tests demonstrate per-stream `auto` selection (TTY stdout + non-TTY stderr → mixed), the exact empty-repository and config-file bytes, and every grammar error string.
- `git diff --quiet ts/AGENTS.md AGENTS.md README.md ts/eslint.config.js ts/package.json` exits 0.
