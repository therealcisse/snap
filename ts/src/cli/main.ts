/**
 * CLI boundary.
 *
 * This is the only module in `src/` that writes to the process's standard streams. Commands are
 * pure (arguments in, output record out); `run` turns one invocation into writes and an exit
 * status. Writes are synchronous so that the entire output is flushed before the process ends,
 * even when stdout is a pipe (SPEC §10).
 */
import { writeSync } from 'node:fs';

import { SnapError, describeFailure } from '../core/errors.ts';

/** Sinks for the two standard streams. Tests substitute buffers; production binds descriptors. */
export interface Output {
  readonly stdout: (text: string) => void;
  readonly stderr: (text: string) => void;
}

/** Runs one CLI invocation and returns the process exit status; never throws. */
export function run(argv: readonly string[], out: Output): number {
  try {
    dispatch(argv);
    return 0;
  } catch (failure: unknown) {
    const { exitCode, line } = describeFailure(failure);
    out.stderr(line);
    return exitCode;
  }
}

/** Output bound to file descriptors 1 and 2 with synchronous, flushed writes. */
export function fdOutput(): Output {
  return {
    stdout: (text) => {
      writeSync(1, text);
    },
    stderr: (text) => {
      writeSync(2, text);
    },
  };
}

/**
 * Argument dispatch seam. The CLI-skeleton issue replaces this body with argument parsing and
 * command routing; until then every invocation is an expected failure naming the arguments.
 */
function dispatch(argv: readonly string[]): void {
  throw new SnapError(`not implemented: ${argv.join(' ')}`.trimEnd());
}
