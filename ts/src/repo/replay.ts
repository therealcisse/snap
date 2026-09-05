/**
 * Deterministic replay (SPEC §6) — the linear-history subset this issue owes.
 *
 * Replay carries an integrated version `I` (the causal join of everything applied so far) and the
 * canonical tree `C` built from it. A patch is *ready* when its base is causally `I` or before
 * it, and each round integrates the least ready patch by §6.1's ordering. When that winner's
 * base is exactly `I`, `C` is the patch's exact base tree `B` and integration is plain
 * application — no OT, no memoized base materialization. A winner whose base is strictly before
 * `I` would need its base materialized apart from `C` (§6.2–§6.4); that is the merge issue's
 * territory and fails with an explicit interim error until it lands.
 *
 * `replayRepository` replays the whole patch set, not a frontier-selected subset: §6.1's
 * selection is trivial for the frontier itself, and validation (§4.5) must still surface
 * unreachable patches, which a selection would silently drop.
 */
import { compareBytes, decodeUtf8, encodeUtf8, isText } from '../core/bytes.ts';
import { SnapError } from '../core/errors.ts';
import {
  EMPTY_VERSION,
  type Version,
  compareVersions,
  componentOf,
  snapOrder,
} from '../core/version.ts';
import { applyEdit } from '../text/edit.ts';
import { tokenize } from '../text/tokens.ts';

import { type Patch, type Repository, resultVersion } from './model.ts';
import { type Tree, assertPrefixFree, equalBytes } from './tree.ts';

/** The §6.4 auto-resolution reasons; a rule that discards an effect emits one warning pair. */
export type WarningReason =
  'delete-wins' | 'later-create-wins' | 'later-put-wins' | 'namespace-wins' | 'put-wins';

/** One `(<path>, <reason>)` warning pair (SPEC §6.4). */
export type WarningPair = readonly [string, WarningReason];

/**
 * What replay produces: the materialized tree, the warning pairs of its own integrations, and
 * the patches in the order this replay integrated them (§6.1, first integrated first) — the
 * canonical integration order `log` prints reversed.
 */
export interface ReplayResult {
  readonly tree: Tree;
  readonly warnings: readonly WarningPair[];
  readonly sequence: readonly Patch[];
}

/**
 * A pending patch with its decode-time index, kept for error context (`repository.patches[i]`)
 * after the ready-set loop has detached the patch from its array position.
 */
interface PendingPatch {
  readonly patch: Patch;
  readonly index: number;
}

/**
 * Replays every patch of `repository` in causal order from the empty tree (SPEC §6.1).
 *
 * Throws `SnapError` for §4.5 step-5 violations during integration — `delete of absent path`,
 * `text change on non-text base`, `no-op change`, edit-script and consumption failures through
 * `applyEdit`, and `tree paths conflict` — plus `cyclic or incomplete patch history` when no
 * pending patch is ready (a cycle or a base naming an unknown dot that pre-checks missed) and
 * the interim `concurrent replay is not implemented yet`. Warnings are empty until §6.2 exists:
 * every rule that emits a pair needs concurrent integration.
 */
export function replayRepository(repository: Repository): ReplayResult {
  return replayPatches(repository.patches.map((patch, index) => ({ patch, index })));
}

/**
 * The tree a known `version` selects (SPEC §6.1): every patch `(c, n)` with `n <= version[c]`,
 * replayed together. `diff` and `revert` materialize old versions and revert targets here.
 *
 * The caller must pass a repository that already passed `validateRepository` and a version in
 * `knownVersionKeys` — the checks every command owes before naming a version — because a valid
 * repository's selected subset can be neither cyclic nor concurrent: a subset of one linear
 * chain per contributor is still linearly ordered.
 */
export function materializeVersion(repository: Repository, version: Version): Tree {
  return replayPatches(
    repository.patches
      .map((patch, index) => ({ patch, index }))
      .filter((entry) => componentOf(version, entry.patch.author) >= entry.patch.revision),
  ).tree;
}

/**
 * The §6.1 integration loop shared by whole-repository replay and version-selected replay:
 * find ready patches, integrate the winner, recompute, until none remain.
 */
function replayPatches(entries: readonly PendingPatch[]): ReplayResult {
  let integrated: Version = EMPTY_VERSION;
  let tree: Tree = new Map<string, Uint8Array>();
  const sequence: Patch[] = [];
  // Keyed by `${author}->${revision}`: §3.1 forbids `->` inside contributor IDs, so the key is
  // unambiguous without a separator escape.
  const pending = new Map<string, PendingPatch>();
  for (const entry of entries) {
    pending.set(`${entry.patch.author}->${String(entry.patch.revision)}`, entry);
  }

  while (pending.size > 0) {
    const ready = [...pending.values()].filter(
      (entry) => compareVersions(entry.patch.base, integrated) !== 'after',
    );
    if (ready.length === 0) {
      throw new SnapError('cyclic or incomplete patch history');
    }
    const winner = ready.reduce((least, entry) =>
      readyOrder(entry.patch, least.patch) < 0 ? entry : least,
    );
    // A base equal to `I` applies plainly. A base strictly before `I` means `C` already holds
    // concurrent effects; integrating then needs §6.2's separate base tree and OT, which the
    // merge issue owes — so this replay refuses instead of approximating.
    if (compareVersions(winner.patch.base, integrated) === 'before') {
      throw new SnapError('concurrent replay is not implemented yet');
    }
    tree = integratePatch(winner.patch, winner.index, tree);
    integrated = resultVersion(winner.patch);
    sequence.push(winner.patch);
    pending.delete(`${winner.patch.author}->${String(winner.patch.revision)}`);
  }

  return { tree, warnings: [], sequence };
}

/**
 * The §6.1 ordering between two ready patches: least result version in Snap order, then author
 * in byte order, then revision. Distinct dots always decide at the first key — one patch moves
 * one component — so the tiebreakers exist for the corrupted ties the spec still orders.
 */
function readyOrder(a: Patch, b: Patch): number {
  const bySnap = snapOrder(resultVersion(a), resultVersion(b));
  if (bySnap !== 0) {
    return bySnap;
  }
  const byAuthor = compareBytes(a.author, b.author);
  if (byAuthor !== 0) {
    return byAuthor;
  }
  return a.revision < b.revision ? -1 : a.revision > b.revision ? 1 : 0;
}

/**
 * Applies one patch to `base`, which is the patch's exact base tree (`I == base` on the linear
 * subset). Each change is evaluated against `base` — never against earlier changes of the same
 * patch, since paths are distinct after decode — and every §4.5 step-5 rule fires here. The
 * result is checked prefix-free before it becomes a tree any caller can observe.
 */
function integratePatch(patch: Patch, index: number, base: Tree): Tree {
  const result = new Map(base);
  patch.changes.forEach((change, changeIndex) => {
    const oldBytes = base.get(change.path);
    switch (change.type) {
      case 'delete':
        if (oldBytes === undefined) {
          throw new SnapError(`delete of absent path: ${change.path}`);
        }
        result.delete(change.path);
        break;
      case 'put':
        if (oldBytes !== undefined && equalBytes(change.content, oldBytes)) {
          throw new SnapError(`no-op change: ${change.path}`);
        }
        result.set(change.path, change.content);
        break;
      case 'text': {
        if (oldBytes !== undefined && !isText(oldBytes)) {
          throw new SnapError(`text change on non-text base: ${change.path}`);
        }
        const oldTokens = oldBytes === undefined ? [] : tokenize(decodeUtf8(oldBytes));
        const newTokens = applyEdit(
          `repository.patches[${String(index)}].changes[${String(changeIndex)}].edit`,
          change.edit,
          oldTokens,
        );
        const newBytes = encodeUtf8(newTokens.join(''));
        if (oldBytes !== undefined && equalBytes(newBytes, oldBytes)) {
          // Absent-to-present never trips this: an empty edit creating an empty file changes
          // presence, which §4.3 counts as a real change.
          throw new SnapError(`no-op change: ${change.path}`);
        }
        result.set(change.path, newBytes);
        break;
      }
    }
  });
  assertPrefixFree(result);
  return result;
}
