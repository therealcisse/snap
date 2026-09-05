/**
 * The materialized tree (SPEC §2, §5): tracked paths to file bytes.
 *
 * Replay produces trees one patch at a time and validation checks each result, so this module
 * owns the tree's two structural facts: canonical path order is byte order, and no tracked path
 * may be a proper path ancestor of another — a path names one file, never also a directory.
 */
import { compareBytes } from '../core/bytes.ts';
import { SnapError } from '../core/errors.ts';

/**
 * A materialized tree: each tracked path to that file's exact bytes. A plain `ReadonlyMap`
 * rather than a sorted structure, because every consumer either probes one path or iterates in
 * `sortedPaths` order; canonical order is a property of the paths, not the container.
 */
export type Tree = ReadonlyMap<string, Uint8Array>;

/** Every path in `tree`, ascending in byte order (SPEC §2). */
export function sortedPaths(tree: Tree): string[] {
  return [...tree.keys()].sort(compareBytes);
}

/** Byte equality for tree contents; `Uint8Array` has no content equality of its own. */
export function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((byte, i) => byte === b[i]);
}

/**
 * One path's difference between two trees: the bytes on each side, with `undefined` marking
 * absence. `diffTrees` yields a change only where presence or bytes differ, so the pairs
 * `old` and `new` both defined and equal, and both undefined, never occur.
 */
export interface TreeChange {
  readonly path: string;
  readonly old: Uint8Array | undefined;
  readonly new: Uint8Array | undefined;
}

/**
 * The paths whose presence or bytes differ between two trees, ascending in byte order (SPEC
 * §2). This one delta feeds every tree comparison: `status` codes its rows, `commit` and
 * `revert` author their changes from it, and `diff` renders it — so all four agree on what
 * changed by construction.
 */
export function diffTrees(oldTree: Tree, newTree: Tree): TreeChange[] {
  const paths = [...new Set([...oldTree.keys(), ...newTree.keys()])].sort(compareBytes);
  const changes: TreeChange[] = [];
  for (const path of paths) {
    const before = oldTree.get(path);
    const after = newTree.get(path);
    const unchanged = before !== undefined && after !== undefined && equalBytes(before, after);
    if (!unchanged) {
      changes.push({ path, old: before, new: after });
    }
  }
  return changes;
}

/**
 * The proper path ancestors of `path`: every nonempty prefix cut at a `/` boundary, shortest
 * first. `a/b/c` yields `a` and `a/b`; the path itself is never its own ancestor.
 */
export function ancestorPaths(path: string): string[] {
  const ancestors: string[] = [];
  for (let slash = path.indexOf('/'); slash !== -1; slash = path.indexOf('/', slash + 1)) {
    ancestors.push(path.slice(0, slash));
  }
  return ancestors;
}

/**
 * Asserts the tree invariant every patch result must restore (SPEC §5 step 5): no tracked path
 * is a proper path ancestor of another.
 *
 * Throws `SnapError('tree paths conflict: <ancestor> and <path>')` — the existing ancestor
 * first, the conflicting path second. Because a proper ancestor always sorts before its
 * descendant in byte order, walking paths in canonical order makes the reported pair and its
 * order deterministic regardless of how the tree was built.
 */
export function assertPrefixFree(tree: Tree): void {
  for (const path of sortedPaths(tree)) {
    for (const ancestor of ancestorPaths(path)) {
      if (tree.has(ancestor)) {
        throw new SnapError(`tree paths conflict: ${ancestor} and ${path}`);
      }
    }
  }
}
