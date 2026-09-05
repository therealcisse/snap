/**
 * `snap log` (SPEC §7.4): one entry per patch — result version, author, escaped message — in
 * reverse canonical integration order, newest first.
 *
 * The order comes from the same replay that materialized the frontier tree, so `log` needs no
 * scan of its own and can never disagree with what replay actually integrated. Messages are
 * escaped so one entry stays one line in the plain layout: backslash first, then tab, then LF
 * — the order matters, because escaping tab before backslash would let a message's own
 * backslashes forge `\t`.
 */
import { formatVersion } from '../core/version.ts';
import { loadValidatedRepository } from '../fs/locate.ts';
import { resultVersion } from '../repo/model.ts';

import type { CommandResult, LogEntry } from './output.ts';

export function log(cwd: string): CommandResult {
  const { replay } = loadValidatedRepository(cwd);
  const entries = replay.sequence
    .slice()
    .reverse()
    .map((patch): LogEntry => ({
      version: formatVersion(resultVersion(patch)),
      author: patch.author,
      message: escapeMessage(patch.message),
    }));
  return { kind: 'log', entries };
}

/** §7.4's escape pass, in its fixed order: `\` before `\t` before `\n`. */
function escapeMessage(message: string): string {
  return message.replaceAll('\\', '\\\\').replaceAll('\t', '\\t').replaceAll('\n', '\\n');
}
