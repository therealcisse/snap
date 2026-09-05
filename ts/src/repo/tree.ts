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
 * The namespace conflicts of `path` in `tree` (SPEC §6.2): every present proper ancestor and
 * every present proper descendant, ascending in byte order.
 *
 * Installing a tracked path requires removing whatever currently occupies its directory side
 * (a present ancestor) or lives inside it (a present descendant) — §6.2's namespace rule.
 * Ancestors are `ancestorPaths` lookups; descendants need a walk over the tree's paths, which
 * at Snap's tree sizes costs less than maintaining a derived directory set.
 */
export function namespaceConflicts(tree: Tree, path: string): string[] {
  const conflicts: string[] = [];
  for (const ancestor of ancestorPaths(path)) {
    if (tree.has(ancestor)) {
      conflicts.push(ancestor);
    }
  }
  for (const candidate of sortedPaths(tree)) {
    if (ancestorPaths(candidate).includes(path)) {
      conflicts.push(candidate);
    }
  }
  return conflicts.sort(compareBytes);
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
