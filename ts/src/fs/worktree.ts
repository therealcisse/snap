/**
 * The working-tree scan (SPEC §2, §10): the one place Snap looks at the working tree.
 *
 * `scanWorkingTree` walks from the repository root and turns what it finds into a `Tree`, so
 * every scanning command observes the same files with the same refusals. Anything the
 * repository model cannot represent — a symlink or special file, a regular file whose relative
 * path is not a valid tracked path — fails the whole scan rather than being followed, skipped,
 * or half-tracked, because a tree that silently omits an entry would make `status` lie and
 * `commit` author a deletion the user never made.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { compareBytes, isValidTrackedPath } from '../core/bytes.ts';
import { SnapError } from '../core/errors.ts';

import { SNAP_DIRECTORY } from './locate.ts';

import type { Tree } from '../repo/tree.ts';

/** One visited file: its repository-relative path and exact bytes. */
type VisitedFile = readonly [string, Uint8Array];

/** The two §10 scan refusals; the error line reads `snap: <kind>: <path>` for both. */
type Offense = 'unsupported working tree entry' | 'invalid working tree path';

/** One entry the repository model cannot represent, by relative path. */
interface Offender {
  readonly kind: Offense;
  readonly path: string;
}

/**
 * The complete working-tree scan below `root`, in one pass.
 *
 * The repository's own `.snap` metadata directory is excluded; directories are traversed, not
 * recorded, so an empty directory is nothing whatever its name. Returns a tree that iterates in
 * unsigned UTF-8 byte order. Throws `SnapError` naming the least offending path in byte order
 * across both offense classes — never the first offender a directory walk happens to meet —
 * because the filesystem is free to list entries in any order it likes (tests/29).
 */
export function scanWorkingTree(root: string): Tree {
  const files: VisitedFile[] = [];
  const offenders: Offender[] = [];
  visit(resolve(root), '', files, offenders, true);
  // Sorting the offenders first makes the report a function of the offending set alone. Byte
  // order is what decides: `a.txt` (0x2e) beats `a/b` (0x2f) even though a walk visits `a/b`
  // first, and the symlink `m-link` beats `z\x`.
  const least = offenders.sort((a, b) => compareBytes(a.path, b.path)).at(0);
  if (least !== undefined) {
    throw new SnapError(`${least.kind}: ${least.path}`);
  }
  const tree = new Map<string, Uint8Array>();
  for (const [path, bytes] of files.sort((a, b) => compareBytes(a[0], b[0]))) {
    tree.set(path, bytes);
  }
  return tree;
}

/**
 * Visits one directory. Classification uses the dirent itself, never a follow-up `stat`, so a
 * symlink reads as a symlink even when its target exists: §10 refuses to follow.
 */
function visit(
  directory: string,
  relative: string,
  files: VisitedFile[],
  offenders: Offender[],
  atRoot: boolean,
): void {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    // Only the root's own metadata directory is invisible (SPEC §2); a tracked `.snap` below a
    // first segment is an ordinary directory whose contents are ordinary files.
    if (atRoot && entry.name === SNAP_DIRECTORY) {
      continue;
    }
    const child = relative === '' ? entry.name : `${relative}/${entry.name}`;
    if (entry.isDirectory()) {
      visit(join(directory, entry.name), child, files, offenders, false);
      continue;
    }
    if (!entry.isFile()) {
      offenders.push({ kind: 'unsupported working tree entry', path: child });
      continue;
    }
    if (!isValidTrackedPath(child)) {
      offenders.push({ kind: 'invalid working tree path', path: child });
      continue;
    }
    files.push([child, readFileSync(join(directory, entry.name))]);
  }
}
