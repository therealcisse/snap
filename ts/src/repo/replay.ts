/**
 * Deterministic replay (SPEC §6) — the linear-history subset this issue owes.
 *
 * Replay carries an integrated version `I` (the causal join of everything applied so far) and the
 * canonical tree `C` built from it. A patch is *ready* when its base is causally `I` or before it.
 * On a valid linear history exactly one patch is ever ready and its base equals `I`, so `C` is
 * that patch's exact base tree `B` and integration is plain application — no OT, no memoized
 * base materialization. Concurrent-ready histories (two ready patches, or one whose base is
 * strictly before `I`) need §6.2–§6.4 and fail with an explicit interim error until the merge
 * issue lands them.
 *
 * `replayRepository` replays the whole patch set, not a frontier-selected subset: §6.1's
 * selection is trivial for the frontier itself, and validation (§4.5) must still surface
 * unreachable patches, which a selection would silently drop.
 */
import { decodeUtf8, encodeUtf8, isText } from '../core/bytes.ts';
import { SnapError } from '../core/errors.ts';
import { EMPTY_VERSION, type Version, compareVersions } from '../core/version.ts';
import { applyEdit } from '../text/edit.ts';
import { tokenize } from '../text/tokens.ts';

import { type Patch, type Repository, resultVersion } from './model.ts';
import { type Tree, assertPrefixFree } from './tree.ts';

/** The §6.4 auto-resolution reasons; a rule that discards an effect emits one warning pair. */
export type WarningReason =
  'delete-wins' | 'later-create-wins' | 'later-put-wins' | 'namespace-wins' | 'put-wins';

/** One `(<path>, <reason>)` warning pair (SPEC §6.4). */
export type WarningPair = readonly [string, WarningReason];

/** What replay produces: the materialized tree and the warning pairs of its own integrations. */
export interface ReplayResult {
  readonly tree: Tree;
  readonly warnings: readonly WarningPair[];
}

/**
 * A pending patch with its decode-time index, kept for error context (`repository.patches[i]`)
 * after the ready-set loop has detached the patch from its array position.
 */
interface PendingPatch {
  readonly patch: Patch;
  readonly index: number;
}

/** Byte equality for the §4.3 no-op rule; `Uint8Array` has no content equality of its own. */
function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((byte, i) => byte === b[i]);
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
  let integrated: Version = EMPTY_VERSION;
  let tree: Tree = new Map<string, Uint8Array>();
  // Keyed by `${author}->${revision}`: §3.1 forbids `->` inside contributor IDs, so the key is
  // unambiguous without a separator escape.
  const pending = new Map<string, PendingPatch>();
  repository.patches.forEach((patch, index) => {
    pending.set(`${patch.author}->${String(patch.revision)}`, { patch, index });
  });

  while (pending.size > 0) {
    const ready = [...pending.values()].filter(
      (entry) => compareVersions(entry.patch.base, integrated) !== 'after',
    );
    const winner = ready.at(0);
    if (winner === undefined) {
      throw new SnapError('cyclic or incomplete patch history');
    }
    // Both cases need §6.2: several ready patches are concurrent, and a lone patch whose base is
    // strictly before `I` needs its base `B` materialized apart from the running tree `C`.
    const concurrent =
      ready.length > 1 || compareVersions(winner.patch.base, integrated) === 'before';
    if (concurrent) {
      throw new SnapError('concurrent replay is not implemented yet');
    }
    tree = integratePatch(winner.patch, winner.index, tree);
    integrated = resultVersion(winner.patch);
    pending.delete(`${winner.patch.author}->${String(winner.patch.revision)}`);
  }

  return { tree, warnings: [] };
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
