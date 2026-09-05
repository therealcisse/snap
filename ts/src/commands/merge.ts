/**
 * `snap merge <operand>` (SPEC §7.8): integrate another repository's history — a local path or
 * an exact §9 URL — into the current one, deterministically.
 *
 * Checks run in §10's order: local validation, operand resolution, the §7.6 collision check
 * and the joined replay, then the working-tree scan — unsupported entries first, dirtiness
 * against the local replay tree second — before anything is written. The write is `revert`'s
 * two steps: working files first, metadata second. A merge whose operand adds nothing still
 * writes both, because §7.8 makes the joined repository the outcome, not the delta.
 *
 * Stdout carries the joined frontier; stderr carries exactly the §6.4 warnings this merge
 * added — the joined replay's pairs minus the local replay's — so re-merging a repository the
 * local side already contains prints nothing on stderr.
 */
import { SnapError } from '../core/errors.ts';
import { formatVersion } from '../core/version.ts';
import { loadValidatedRepository } from '../fs/locate.ts';
import { installTree, writeRepository } from '../fs/materialize.ts';
import { scanWorkingTree } from '../fs/worktree.ts';
import { encodeRepository } from '../repo/model.ts';
import { type WarningPair } from '../repo/replay.ts';
import { diffTrees } from '../repo/tree.ts';
import { unionRepositories } from '../repo/union.ts';
import { validateRepository } from '../repo/validate.ts';

import { loadRepositoryOperand } from './operand.ts';

import type { CommandOutput } from './output.ts';

/**
 * Merges the repository at `operand` — a path relative to `cwd`, or an exact URL — into the
 * nearest repository around `cwd`, returning the joined frontier on stdout and the merge's
 * added auto-resolution warnings on stderr.
 *
 * Async because the operand may be a URL, and the §9 client is async; a local operand takes
 * the same path so callers see one contract. Throws `SnapError` for every refused merge, in
 * §10's check order.
 */
export async function merge(operand: string, cwd: string): Promise<CommandOutput> {
  const local = loadValidatedRepository(cwd);
  const remote = await loadRepositoryOperand(operand, cwd);
  const joined = unionRepositories(local.repository, remote);
  const joinedReplay = validateRepository(joined);
  const working = scanWorkingTree(local.root);
  if (diffTrees(local.replay.tree, working).length > 0) {
    throw new SnapError('working tree is dirty');
  }
  // Working files first, metadata second (§10) — a crash between the two leaves a tree the
  // metadata does not know, which the next command's validation will say loudly.
  installTree(local.root, local.replay.tree, joinedReplay.tree);
  writeRepository(local.root, encodeRepository(joined));
  return {
    stdout: `${formatVersion(joined.frontier)}\n`,
    stderr: addedWarnings(joinedReplay.warnings, local.replay.warnings),
  };
}

/**
 * The §6.4 warnings this merge added: pairs of the joined replay the local replay never had,
 * one `warning: auto-resolved <path>: <reason>` line each. Both inputs arrive unique and
 * sorted by path then reason in byte order, so the filtered difference keeps that order.
 */
function addedWarnings(joined: readonly WarningPair[], local: readonly WarningPair[]): string {
  const before = new Set(local.map(warningKey));
  return joined
    .filter((pair) => !before.has(warningKey(pair)))
    .map((pair) => `warning: auto-resolved ${pair[0]}: ${pair[1]}\n`)
    .join('');
}

/** The pair's identity: NUL cannot appear in a tracked path and reasons are fixed literals. */
function warningKey(pair: WarningPair): string {
  return `${pair[0]}\0${pair[1]}`;
}
