/**
 * CLI boundary.
 *
 * This is the only module in `src/` that writes to the process's standard streams. Commands are
 * pure — parsed arguments in, an output record out — so `run` is where an invocation becomes
 * writes and an exit status. Writes are synchronous so the entire output is flushed before the
 * process ends, even when stdout is a pipe (SPEC §10).
 */
import { writeSync } from 'node:fs';

import { setContributorId } from '../commands/config.ts';
import { init } from '../commands/init.ts';
import { showVersion } from '../commands/version.ts';
import { SnapError, describeFailure } from '../core/errors.ts';
import { parseVersion, versionKey } from '../core/version.ts';
import { findRepositoryRoot, loadRepository } from '../fs/locate.ts';
import { type Repository, knownVersionKeys } from '../repo/model.ts';

import { type Command, parseArgs } from './args.ts';
import { resolveModes } from './presentation.ts';

import type { CommandOutput } from '../commands/output.ts';

/** Sinks for the two standard streams. Tests substitute buffers; production binds descriptors. */
export interface Output {
  readonly stdout: (text: string) => void;
  readonly stderr: (text: string) => void;
}

/** Everything one invocation needs from its process, injected so tests need no real one. */
export interface Context {
  readonly out: Output;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly cwd: string;
  readonly isStdoutTty: boolean;
  readonly isStderrTty: boolean;
}

/** Runs one CLI invocation and returns the process exit status. Never throws. */
export function run(argv: readonly string[], ctx: Context): number {
  try {
    // §7.11: an invalid SNAP_COLOR fails before any command runs. The resolved modes take
    // effect when rendering lands; today resolution exists to validate the invocation.
    resolveModes(ctx.env, ctx.isStdoutTty, ctx.isStderrTty);
    emit(execute(parseArgs(argv), argv, ctx), ctx);
    return 0;
  } catch (failure: unknown) {
    const { exitCode, line } = describeFailure(failure);
    ctx.out.stderr(line);
    return exitCode;
  }
}

/** Output bound to file descriptors 1 and 2 with synchronous, flush-on-write calls. */
export function fdOutput(): Output {
  return {
    stdout: (text) => writeSync(1, text),
    stderr: (text) => writeSync(2, text),
  };
}

function execute(command: Command, argv: readonly string[], ctx: Context): CommandOutput {
  switch (command.kind) {
    case 'showVersion':
      return showVersion();
    case 'init':
      return init(command.path, ctx.cwd);
    case 'config':
      return setContributorId(command.id, {
        global: command.global,
        cwd: ctx.cwd,
        home: ctx.env['HOME'],
      });
    case 'status':
    case 'log':
    case 'commit':
    case 'merge':
      // Repository commands that still lack bodies locate the repository first, so running
      // outside one reports the location failure the suites pin (tests/14), not `not implemented`.
      findRepositoryRoot(ctx.cwd);
      return notImplemented(argv);
    case 'diff': {
      const repository = loadRepository(ctx.cwd);
      requireKnownVersion(repository, command.oldVersion);
      requireKnownVersion(repository, command.newVersion);
      return notImplemented(argv);
    }
    case 'revert': {
      const repository = loadRepository(ctx.cwd);
      requireKnownVersion(repository, command.version);
      return notImplemented(argv);
    }
    case 'serve':
      return notImplemented(argv);
  }
}

/**
 * Validates one `<version>` operand against `repository`: canonical syntax (SPEC §3.2) and
 * locally known (SPEC §7.6). Throws `invalid version: <text>` or `unknown version: <text>`.
 */
function requireKnownVersion(repository: Repository, text: string): void {
  const version = parseVersion(text);
  if (!knownVersionKeys(repository).has(versionKey(version))) {
    throw new SnapError(`unknown version: ${text}`);
  }
}

/** The standing failure for command bodies that have not landed yet. */
function notImplemented(argv: readonly string[]): never {
  throw new SnapError(`not implemented: ${argv.join(' ')}`);
}

function emit(output: CommandOutput, ctx: Context): void {
  ctx.out.stdout(output.stdout);
  ctx.out.stderr(output.stderr);
}
