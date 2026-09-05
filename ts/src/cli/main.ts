/**
 * CLI boundary.
 *
 * This is the only module in `src/` that writes to the process's standard streams. Commands are
 * pure — parsed arguments in, a result record out — so `run` is where an invocation becomes
 * writes and an exit status: it resolves each stream's §7.11 presentation, renders the result
 * accordingly, and owns the one error path. `serve` is the one exception, a long-running
 * command that prints its own startup line straight to the raw sink, which is what keeps the
 * URL plain under `SNAP_COLOR=always`. Writes are synchronous so the entire output is flushed
 * before the process ends, even when stdout is a pipe (SPEC §10).
 */
import { writeSync } from 'node:fs';

import { commit } from '../commands/commit.ts';
import { setContributorId } from '../commands/config.ts';
import { diffVersions, diffWorktree } from '../commands/diff.ts';
import { init } from '../commands/init.ts';
import { log } from '../commands/log.ts';
import { revert } from '../commands/revert.ts';
import { serve } from '../commands/serve.ts';
import { status } from '../commands/status.ts';
import { showVersion } from '../commands/version.ts';
import { SnapError, describeFailure } from '../core/errors.ts';
import { findRepositoryRoot } from '../fs/locate.ts';

import { type Command, parseArgs } from './args.ts';
import { type StreamModes, render, renderErrorLine, resolveModes } from './presentation.ts';

import type { CommandResult } from '../commands/output.ts';

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
export async function run(argv: readonly string[], ctx: Context): Promise<number> {
  // `undefined` means no valid presentation was selected, so the catch path renders plain —
  // §7.11: the invalid-`SNAP_COLOR` error itself never carries escapes.
  let modes: StreamModes | undefined;
  try {
    modes = resolveModes(ctx.env, ctx.isStdoutTty, ctx.isStderrTty);
    const command = parseArgs(argv);
    // §7.9/§7.11: serve runs until a signal ends it, so it cannot return a result record; it
    // still runs inside this boundary so its startup failures funnel through the one error path.
    if (command.kind === 'serve') {
      return await serve(command.port, ctx.cwd, ctx.out.stdout);
    }
    emit(execute(command, argv, ctx), ctx, modes);
    return 0;
  } catch (failure: unknown) {
    const { exitCode, line } = describeFailure(failure);
    ctx.out.stderr(renderErrorLine(line, modes?.stderr ?? 'plain'));
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

/** The commands that complete synchronously and speak in `CommandResult`s; serve runs above. */
type ImmediateCommand = Exclude<Command, { kind: 'serve' }>;

function execute(command: ImmediateCommand, argv: readonly string[], ctx: Context): CommandResult {
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
      return status(ctx.cwd);
    case 'log':
      return log(ctx.cwd);
    case 'commit':
      return commit(command.message, ctx.cwd, ctx.env);
    case 'diffWorktree':
      return diffWorktree(ctx.cwd);
    case 'diff':
      // The cross-repository form stays unimplemented; the boundary reports it with the
      // invocation's own words, as the not-implemented lines have always read (tests/24).
      if (command.repo !== undefined) {
        return notImplemented(argv);
      }
      return diffVersions(command.oldVersion, command.newVersion, ctx.cwd);
    case 'revert':
      return revert(command.version, ctx.cwd, ctx.env);
    case 'merge':
      // Still without a body, the repository is located first so running outside one reports
      // the location failure the suites pin (tests/14), not `not implemented`.
      findRepositoryRoot(ctx.cwd);
      return notImplemented(argv);
  }
}

/** The standing failure for command bodies that have not landed yet. */
function notImplemented(argv: readonly string[]): never {
  throw new SnapError(`not implemented: ${argv.join(' ')}`);
}

function emit(result: CommandResult, ctx: Context, modes: StreamModes): void {
  const output = render(result, modes);
  ctx.out.stdout(output.stdout);
  ctx.out.stderr(output.stderr);
}
