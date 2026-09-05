/**
 * `snap revert <version>` (SPEC §7.7): restore an older tree by authoring a new patch, never
 * by moving history backward.
 *
 * The patch is the delta from the current tree to the materialized target tree — `commit`'s
 * own `selectChanges` decides text/put/delete — under the fixed message `revert to <version>`.
 * Checks run target-version first, then clean working tree, then contributor: that order is
 * what the suite pins (tests/14 reports an unknown operand without configuration present;
 * tests/19 reports the missing contributor on a known, clean target). Working files are
 * installed before the metadata write (§10), and an equal current and target tree is refused
 * rather than recorded as a no-op patch, which §4.3 forbids.
 */
import { SnapError } from '../core/errors.ts';
import { formatVersion } from '../core/version.ts';
import { loadValidatedRepository, resolveContributorId } from '../fs/locate.ts';
import { installTree, writeRepository } from '../fs/materialize.ts';
import { scanWorkingTree } from '../fs/worktree.ts';
import { encodeRepository, resolveKnownVersion, withPatch } from '../repo/model.ts';
import { materializeVersion } from '../repo/replay.ts';
import { diffTrees } from '../repo/tree.ts';

import { nextRevision, selectChanges } from './commit.ts';

import type { CommandOutput } from './output.ts';

export function revert(
  version: string,
  cwd: string,
  env: Readonly<Record<string, string | undefined>>,
): CommandOutput {
  const { root, repository, replay } = loadValidatedRepository(cwd);
  const target = resolveKnownVersion(repository, version);
  const working = scanWorkingTree(root);
  if (diffTrees(replay.tree, working).length > 0) {
    throw new SnapError('working tree is dirty');
  }
  const contributor = resolveContributorId(root, env);
  if (contributor === undefined) {
    throw new SnapError('contributor.id is required; configure it locally or globally');
  }
  const targetTree = materializeVersion(repository, target);
  const delta = diffTrees(replay.tree, targetTree);
  if (delta.length === 0) {
    throw new SnapError('target tree is already current');
  }
  const updated = withPatch(repository, {
    author: contributor,
    revision: nextRevision(repository, contributor),
    base: repository.frontier,
    message: `revert to ${formatVersion(target)}`,
    changes: selectChanges(delta),
  });
  // Working files first, metadata second (§10); a crash between the two leaves a tree the
  // metadata does not know, which the next command's validation will say loudly.
  installTree(root, replay.tree, targetTree);
  writeRepository(root, encodeRepository(updated));
  return { stdout: `${formatVersion(updated.frontier)}\n`, stderr: '' };
}
