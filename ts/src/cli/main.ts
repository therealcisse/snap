/**
 * CLI boundary.
 *
 * This is the only module in `src/` that writes to the process's standard streams. Commands are
 * pure — parsed arguments in, an output record out — so `run` is where an invocation becomes
 * writes and an exit status; `serve` is the one exception, a long-running command that prints
 * its own startup line. The record may take a moment to arrive — a `merge` or `diff --repo`
 * operand can be a §9 URL — so `execute` returns a promise `run` awaits before emitting.
 * Writes are synchronous so the entire output is flushed before the process ends, even when
 * stdout is a pipe (SPEC §10).
 */
import { writeSync } from 'node:fs';

import { commit } from '../commands/commit.ts';
import { setContributorId } from '../commands/config.ts';
import { diffCrossRepository, diffVersions, diffWorktree } from '../commands/diff.ts';
import { init } from '../commands/init.ts';
import { log } from '../commands/log.ts';
import { merge } from '../commands/merge.ts';
import { revert } from '../commands/revert.ts';
import { serve } from '../commands/serve.ts';
import { status } from '../commands/status.ts';
import { showVersion } from '../commands/version.ts';
import { describeFailure } from '../core/errors.ts';

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
export async function run(argv: readonly string[], ctx: Context): Promise<number> {
  try {
    // §7.11: an invalid SNAP_COLOR fails before any command runs. The resolved modes take
    // effect when rendering lands; today resolution exists to validate the invocation.
    resolveModes(ctx.env, ctx.isStdoutTty, ctx.isStderrTty);
    const command = parseArgs(argv);
    // §7.9: serve runs until a signal ends it, so it cannot return an output record. It still
    // runs inside this boundary so its startup failures funnel through the one error path.
    if (command.kind === 'serve') {
      return await serve(command.port, ctx.cwd, ctx.out.stdout);
    }
    emit(await execute(command, ctx), ctx);
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

/**
 * The commands that speak in `CommandOutput`s; serve runs above. `diff --repo` and `merge` are
 * the ones that await — their operands can be HTTP URLs (§9), asynchronous command input — so
 * dispatch is async while every other command body stays a synchronous call.
 */
type ImmediateCommand = Exclude<Command, { kind: 'serve' }>;

async function execute(command: ImmediateCommand, ctx: Context): Promise<CommandOutput> {
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
      if (command.repo !== undefined) {
        return diffCrossRepository(command.oldVersion, command.newVersion, ctx.cwd, command.repo);
      }
      return diffVersions(command.oldVersion, command.newVersion, ctx.cwd);
    case 'revert':
      return revert(command.version, ctx.cwd, ctx.env);
    case 'merge':
      return merge(command.repository, ctx.cwd);
  }
}

function emit(output: CommandOutput, ctx: Context): void {
  ctx.out.stdout(output.stdout);
  ctx.out.stderr(output.stderr);
}
