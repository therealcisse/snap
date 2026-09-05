/**
 * Delta installation and metadata replacement (SPEC §6.2 closing paragraph, §7.5, §7.10).
 *
 * Replay decides what the working tree should be; this module makes the filesystem agree. Two
 * effects only: `installTree` moves the working tree from one materialized tree to another by
 * the smallest delta, and `writeRepository` replaces `repository.json` atomically — same-
 * directory temporary file plus rename — so a reader never observes a half-written repository.
 */
import { mkdirSync, renameSync, rmSync, rmdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { ancestorPaths, diffTrees, type Tree, type TreeChange } from '../repo/tree.ts';

import { SNAP_DIRECTORY } from './locate.ts';

const REPOSITORY_FILE = 'repository.json';

/**
 * Makes the working tree below `root` equal `target`, given the `current` tree it is believed
 * to hold. Only the delta is touched: files absent from `target` are removed, files new or
 * changed in `target` are written, and directories that the removals leave empty are pruned.
 *
 * The order is fixed by the two transitions a prefix-free tree pair allows. Removals run
 * first — including files that block a directory `target` needs, which are themselves absent
 * from the prefix-free `target` and therefore part of the delta — then pruning, so a
 * directory-to-file transition finds the directory gone before the file is written; then
 * directories and writes. Commands call this only after every check has passed (§10), with
 * `current` the tree the command already replayed or scanned.
 */
export function installTree(root: string, current: Tree, target: Tree): void {
  const delta = diffTrees(current, target);
  const removed = delta.filter((change) => change.new === undefined).map((change) => change.path);
  const written = delta.filter(isWritten);

  for (const path of removed) {
    rmSync(join(root, path));
  }
  for (const path of removed) {
    pruneEmptyAncestors(root, path);
  }
  for (const change of written) {
    mkdirSync(dirname(join(root, change.path)), { recursive: true });
    writeFileSync(join(root, change.path), change.new);
  }
}

/** A delta entry whose target bytes exist: the paths `installTree` writes. */
function isWritten(change: TreeChange): change is TreeChange & { readonly new: Uint8Array } {
  return change.new !== undefined;
}

/**
 * Removes directories that deleting `path` may have left empty, deepest first; a non-empty or
 * already-removed directory simply fails the `rmdir` and stops nothing — a parent higher up
 * can still be empty even when this one kept files.
 */
function pruneEmptyAncestors(root: string, path: string): void {
  for (const ancestor of ancestorPaths(path)) {
    try {
      rmdirSync(join(root, ancestor));
    } catch {
      // Not empty (or already gone): the prune is opportunistic by design.
    }
  }
}

/**
 * Replaces the repository's metadata with `text` atomically (SPEC §7.5, §10): write a
 * temporary file in the destination directory, then rename over `repository.json`. A crash
 * between the two leaves the old repository plus an unreferenced temporary inside `.snap`,
 * never a truncated repository — and `.snap` itself is outside every scan, so the temporary
 * cannot leak into a working tree either.
 */
export function writeRepository(root: string, text: string): void {
  const directory = join(root, SNAP_DIRECTORY);
  const temporary = join(directory, `${REPOSITORY_FILE}.tmp`);
  writeFileSync(temporary, text);
  renameSync(temporary, join(directory, REPOSITORY_FILE));
}
