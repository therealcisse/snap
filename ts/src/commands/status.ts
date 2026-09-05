/**
 * `snap status` (SPEC §7.3): the current version, then the working tree's changes against it.
 *
 * One row per differing path — `A` absent-to-present, `M` changed bytes, `D` present-to-absent
 * — in byte order, because both the row set and its order are `diffTrees`' delta of the
 * replayed frontier tree against one fresh scan. A clean tree prints only the version line,
 * and a scan failure is the command's failure before any byte of output (tests/29).
 */
import { formatVersion } from '../core/version.ts';
import { loadValidatedRepository } from '../fs/locate.ts';
import { scanWorkingTree } from '../fs/worktree.ts';
import { diffTrees } from '../repo/tree.ts';

import type { CommandOutput } from './output.ts';

export function status(cwd: string): CommandOutput {
  const { root, repository, replay } = loadValidatedRepository(cwd);
  const working = scanWorkingTree(root);
  const rows = diffTrees(replay.tree, working).map((change) => {
    const code = change.old === undefined ? 'A' : change.new === undefined ? 'D' : 'M';
    return `${code} ${change.path}\n`;
  });
  return { stdout: `version ${formatVersion(repository.frontier)}\n${rows.join('')}`, stderr: '' };
}
