/**
 * §7.11 presentation resolution: which of the two presentations each standard stream uses.
 *
 * Selection is pure environment arithmetic — `SNAP_COLOR`, `NO_COLOR`, and each stream's TTY
 * status in, two modes out — so the unit tests can drive the TTY combinations the piped YAML
 * harness cannot. Rendering is deliberately absent: until the Terminal presentation section
 * lands, every command prints plain, and resolution exists to accept or reject the invocation's
 * `SNAP_COLOR` before any command runs, exactly as §7.11 requires.
 */
import { SnapError } from '../core/errors.ts';

/** One of the two §7.11 presentations. */
export type Presentation = 'plain' | 'terminal';

/** The presentation each standard stream uses for this invocation. */
export interface StreamModes {
  readonly stdout: Presentation;
  readonly stderr: Presentation;
}

/**
 * Resolves per-stream presentation (SPEC §7.11).
 *
 * `SNAP_COLOR=always` selects terminal mode on both streams even when they are redirected and
 * overrides `NO_COLOR`; `never` selects plain on both. Unset or `auto` follows each stream's own
 * TTY status unless `NO_COLOR` is present — with any value, empty included. Any other value
 * throws `SnapError` with `SNAP_COLOR must be auto, always, or never`.
 */
export function resolveModes(
  env: Readonly<Record<string, string | undefined>>,
  isStdoutTty: boolean,
  isStderrTty: boolean,
): StreamModes {
  const snapColor = env['SNAP_COLOR'];
  if (snapColor === 'always') {
    return { stdout: 'terminal', stderr: 'terminal' };
  }
  if (snapColor === 'never') {
    return { stdout: 'plain', stderr: 'plain' };
  }
  if (snapColor !== undefined && snapColor !== 'auto') {
    throw new SnapError('SNAP_COLOR must be auto, always, or never');
  }
  if (env['NO_COLOR'] !== undefined) {
    return { stdout: 'plain', stderr: 'plain' };
  }
  return {
    stdout: isStdoutTty ? 'terminal' : 'plain',
    stderr: isStderrTty ? 'terminal' : 'plain',
  };
}
