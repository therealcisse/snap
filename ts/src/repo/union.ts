/**
 * The union of two repositories (SPEC §7.6): `merge`'s value level, separated from its
 * filesystem effects so the history arithmetic stays testable without a working tree.
 *
 * Both operands arrive §4.5-validated — patches already ascending by `(author, revision)` in
 * byte order — so the union is one merge-walk over two sorted arrays, like every other version
 * operation in `core/version.ts`.
 */
import { compareBytes } from '../core/bytes.ts';
import { joinVersions } from '../core/version.ts';

import { type Patch, type Repository } from './model.ts';
import { assertNoPatchCollisions } from './validate.ts';

/**
 * The repository `merge` writes: every patch of both sides, each shared dot once, under the
 * componentwise join of the two frontiers.
 *
 * Runs the §7.6 collision check first — a shared dot spelled differently on the two sides is
 * the one case where a union must not exist — and throws its `SnapError` untouched. A shared
 * dot that survives the check is structurally equal on both sides, so keeping the local object
 * is deterministic, not a choice with consequences: the encoded repository is the same either
 * way. The result is sorted by construction and meant to pass straight through
 * `validateRepository` for its joined replay.
 */
export function unionRepositories(local: Repository, remote: Repository): Repository {
  assertNoPatchCollisions(local, remote);
  return {
    format: 1,
    frontier: joinVersions(local.frontier, remote.frontier),
    patches: mergePatches(local.patches, remote.patches),
  };
}

/** Order on patches as dots: author in byte order, then revision ascending (SPEC §4.1). */
function compareDots(a: Patch, b: Patch): number {
  const order = compareBytes(a.author, b.author);
  if (order !== 0) {
    return order;
  }
  return a.revision < b.revision ? -1 : a.revision > b.revision ? 1 : 0;
}

/**
 * The sorted union of two §4.1-ordered patch arrays, shared dots collapsed to the local object.
 */
function mergePatches(local: readonly Patch[], remote: readonly Patch[]): Patch[] {
  const patches: Patch[] = [];
  let i = 0;
  let j = 0;
  while (i < local.length && j < remote.length) {
    const left = local[i];
    const right = remote[j];
    if (left === undefined || right === undefined) {
      // Unreachable at runtime — the loop condition bounds both indices — but it narrows the
      // indexed reads for the type checker, which has no `noUncheckedIndexedAccess` faith.
      break;
    }
    const order = compareDots(left, right);
    if (order < 0) {
      patches.push(left);
      i += 1;
    } else if (order > 0) {
      patches.push(right);
      j += 1;
    } else {
      patches.push(left);
      i += 1;
      j += 1;
    }
  }
  // At most one side has a remainder, and every remaining dot sorts after everything pushed.
  patches.push(...(i < local.length ? local.slice(i) : remote.slice(j)));
  return patches;
}
