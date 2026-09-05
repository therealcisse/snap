/**
 * `snap log` (SPEC §7.4): every patch as one tab-separated line — result version, author,
 * message — in reverse canonical integration order, newest first.
 *
 * The order comes from the same replay that materialized the frontier tree, so `log` needs no
 * scan of its own and can never disagree with what replay actually integrated. Messages are
 * escaped so one line stays one line: backslash first, then tab, then LF — the order matters,
 * because escaping tab before backslash would let a message's own backslashes forge `\t`.
 */
import { formatVersion } from '../core/version.ts';
import { loadValidatedRepository } from '../fs/locate.ts';
import { resultVersion } from '../repo/model.ts';

import type { CommandOutput } from './output.ts';

export function log(cwd: string): CommandOutput {
  const { replay } = loadValidatedRepository(cwd);
  const lines = replay.sequence
    .slice()
    .reverse()
    .map(
      (patch) =>
        `${formatVersion(resultVersion(patch))}\t${patch.author}\t${escapeMessage(patch.message)}\n`,
    );
  return { stdout: lines.join(''), stderr: '' };
}

/** §7.4's escape pass, in its fixed order: `\` before `\t` before `\n`. */
function escapeMessage(message: string): string {
  return message.replaceAll('\\', '\\\\').replaceAll('\t', '\\t').replaceAll('\n', '\\n');
}
