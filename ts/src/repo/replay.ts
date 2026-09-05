/**
 * Deterministic replay (SPEC §6): patch selection (§6.1), exact-base materialization and
 * integration (§6.2), and the warning set of the top-level integrations (§6.4).
 *
 * Replay carries an integrated version `I` — the causal join of every integrated patch's result
 * — and the canonical tree `C` built from them. A patch is *ready* when its base is causally `I`
 * or before it; §6.1 picks the least ready patch by Snap order of result version, then author,
 * then revision, which sequences causal dependencies before concurrent patches. Integration
 * resolves each change against the patch's exact base tree `B` and the current `C` (§6.2):
 * namespace conflicts first, then the per-path rules, with §6.4's winner table deciding
 * whole-file conflicts and emitting one warning pair per discarded effect.
 *
 * When `I == base` the running tree is already `B`, so linear histories replay with no memo
 * traffic. Otherwise `B` comes from the exact-base memo, seeded by snapshotting the running
 * `(I, C)` state whenever `I` is a version some patch names as its base; only bases the
 * top-level order never passes through need a sub-replay, whose own warnings §6.2 discards.
 *
 * `replayRepository` replays the whole patch set, not a frontier-selected subset: selection
 * would silently drop exactly the unreachable patches validation (§4.5) must report. §6.1's
 * selection by version runs only inside sub-replays, where dropping is the point.
 */
import { compareBytes, decodeUtf8, encodeUtf8, isText } from '../core/bytes.ts';
import { SnapError } from '../core/errors.ts';
import {
  EMPTY_VERSION,
  type Version,
  compareVersions,
  componentOf,
  joinVersions,
  snapOrder,
  versionKey,
} from '../core/version.ts';
import { diffTokens } from '../text/diff.ts';
import { applyEdit } from '../text/edit.ts';
import { tokenize } from '../text/tokens.ts';
import { transformEdit } from '../text/transform.ts';

import { type Change, type Patch, type Repository, resultVersion } from './model.ts';
import { type Tree, assertPrefixFree, namespaceConflicts } from './tree.ts';

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
 * Optional replay instrumentation. `onMaterialize` fires once per exact base that needed an
 * actual sub-replay — not for memo hits, snapshot seeding, or the `I == base` shortcut — so a
 * caller can assert the memo's bound: at most `P + 1` materializations for `P` patches, since
 * each distinct version materializes at most once.
 */
export interface ReplayHooks {
  readonly onMaterialize?: (base: Version) => void;
}

/**
 * A pending patch with its decode-time index, kept for error context (`repository.patches[i]`)
 * after selection has detached the patch from its array position; sub-replays select subsets,
 * so the index must travel with the patch.
 */
interface PendingPatch {
  readonly patch: Patch;
  readonly index: number;
}

/** State shared by the top-level replay and every sub-replay it spawns. */
interface ReplayCore {
  readonly repository: Repository;
  /** Exact-base trees keyed by canonical version string: at most one entry per distinct base. */
  readonly memo: Map<string, Tree>;
  /** Canonical keys of every base the patch set names: the snapshot-seeding trigger set. */
  readonly baseKeys: ReadonlySet<string>;
  readonly hooks: ReplayHooks | undefined;
}

/**
 * One path's content: bytes, or structured absence. §6.2 and §6.4 reason about `B`, `C`, and `T`
 * as presence-plus-bytes ("T is absent", "B present and C absent"), so absence is a value here
 * rather than an `undefined` that every comparison must remember to handle.
 */
type Slot = { readonly present: false } | { readonly present: true; readonly bytes: Uint8Array };

/**
 * One change plus its authored result `T` (SPEC §6.2): what the change produces over the exact
 * base tree, or absence for a delete. Carries the change itself and its position, because the
 * per-path rules need the change's kind and the OT path needs the error context.
 */
interface AuthoredChange {
  readonly change: Change;
  readonly changeIndex: number;
  readonly slot: Slot;
}

/**
 * Replays every patch of `repository` in §6.1 order from the empty tree, returning the canonical
 * tree and the §6.4 warning set of the top-level integrations.
 *
 * Throws `SnapError` for §4.5 step-5 violations during integration — `delete of absent path`,
 * `text change on non-text base`, `no-op change`, edit-script failures through `applyEdit`, and
 * `tree paths conflict` — plus `cyclic or incomplete patch history` when no pending patch is
 * ready (a cycle, or a base naming a version no selected patch ever produced). Warnings fire
 * only for §6.4 rules that discard an effect; warnings produced while materializing an exact
 * base are discarded (§6.2), so the warning set describes the top-level integrations alone.
 */
export function replayRepository(repository: Repository, hooks?: ReplayHooks): ReplayResult {
  const core: ReplayCore = {
    repository,
    memo: new Map<string, Tree>(),
    baseKeys: new Set<string>(repository.patches.map((patch) => versionKey(patch.base))),
    hooks,
  };
  const pending = repository.patches.map((patch, index): PendingPatch => ({ patch, index }));
  const warnings = new Map<string, WarningPair>();
  const tree = replaySelection(core, pending, warnings);
  return { tree, warnings: sortWarnings(warnings) };
}

/**
 * The shared §6.1–§6.2 walk: integrate every patch of `pending` from the empty tree in
 * least-ready order, recording warning pairs into `warnings`. The top-level call keeps its
 * map; a sub-replay passes one it discards (§6.2). Both walks share one memo: a base
 * materialized by either is the same tree.
 */
function replaySelection(
  core: ReplayCore,
  pending: readonly PendingPatch[],
  warnings: Map<string, WarningPair>,
): Tree {
  let integrated: Version = EMPTY_VERSION;
  let tree: Tree = new Map<string, Uint8Array>();
  snapshotBaseState(core, integrated, tree);
  const waiting = new Map<string, PendingPatch>(
    pending.map((entry) => [dotKey(entry.patch), entry]),
  );

  while (waiting.size > 0) {
    const winner = leastReady(waiting, integrated);
    if (winner === undefined) {
      // No pending patch's base is causally reached by the integrated set: the history cycles,
      // or a base names a version the selected patches never produce.
      throw new SnapError('cyclic or incomplete patch history');
    }
    const base = materializeBase(core, winner.patch.base, integrated, tree);
    tree = integratePatch(winner.patch, winner.index, base, tree, warnings);
    integrated = joinVersions(integrated, resultVersion(winner.patch));
    waiting.delete(dotKey(winner.patch));
    snapshotBaseState(core, integrated, tree);
  }
  return tree;
}

/** `author->revision`; §3.1 forbids `->` in contributor IDs, so the key is unambiguous. */
function dotKey(patch: Patch): string {
  return `${patch.author}->${String(patch.revision)}`;
}

/**
 * The least ready pending patch (§6.1). Ready means the patch's base is causally `integrated`
 * or before it — a *concurrent* base is not ready; the patch has not seen that work yet.
 */
function leastReady(
  waiting: ReadonlyMap<string, PendingPatch>,
  integrated: Version,
): PendingPatch | undefined {
  let winner: PendingPatch | undefined;
  for (const entry of waiting.values()) {
    const relation = compareVersions(entry.patch.base, integrated);
    if (relation === 'after' || relation === 'concurrent') {
      continue;
    }
    if (winner === undefined || readyOrder(entry.patch, winner.patch) < 0) {
      winner = entry;
    }
  }
  return winner;
}

/**
 * §6.1's ordering keys in sequence: Snap order of result versions, then author bytes, then
 * revision. The tie-breakers exist for totality — on a valid history, equal result versions
 * mean each patch names the other's dot, which is the cycle replay rejects — but they keep
 * the winner unique in every walk, sub-replays included.
 */
function readyOrder(a: Patch, b: Patch): number {
  const byResult = snapOrder(resultVersion(a), resultVersion(b));
  if (byResult !== 0) {
    return byResult;
  }
  const byAuthor = compareBytes(a.author, b.author);
  return byAuthor !== 0 ? byAuthor : a.revision - b.revision;
}

/**
 * Seeds the memo with the running tree whenever `integrated` is a version some patch names as
 * its base. The top-level walk passes through most named bases as its own `I`, so this makes
 * the common exact-base lookup a hit rather than a sub-replay.
 */
function snapshotBaseState(core: ReplayCore, integrated: Version, tree: Tree): void {
  const key = versionKey(integrated);
  if (core.baseKeys.has(key) && !core.memo.has(key)) {
    core.memo.set(key, tree);
  }
}

/**
 * The exact base tree of a patch whose base is `base`, for a walk whose running state is
 * `(integrated, tree)` = `(I, C)` (§6.2).
 *
 * `I == base` makes `C` itself `B`: the integrated set is exactly the patches `base` selects,
 * because §6.1's order integrates any causally dominated ready patch first, so this shortcut
 * serves every patch of a linear history without memo traffic. Otherwise the memo decides, and
 * only a base the walk never passed through costs a sub-replay of the patches `base` selects
 * — those whose dots it contains — with the sub-replay's warnings discarded. A sub-replay can
 * never re-enter `materializeBase` for the same `base`: a selected patch with that base would
 * need `base` to contain its own dot, which the revision rule excludes. So each distinct
 * version sub-replays at most once, and the memo holds at most one tree per named base.
 */
function materializeBase(core: ReplayCore, base: Version, integrated: Version, tree: Tree): Tree {
  if (compareVersions(base, integrated) === 'equal') {
    return tree;
  }
  const key = versionKey(base);
  const memoized = core.memo.get(key);
  if (memoized !== undefined) {
    return memoized;
  }
  core.hooks?.onMaterialize?.(base);
  const selected: PendingPatch[] = [];
  core.repository.patches.forEach((patch, index) => {
    if (componentOf(base, patch.author) >= patch.revision) {
      selected.push({ patch, index });
    }
  });
  const materialized = replaySelection(core, selected, new Map<string, WarningPair>());
  core.memo.set(key, materialized);
  return materialized;
}

/**
 * Integrates one patch (§6.2) against its exact base tree `base` (`B`) and the canonical tree
 * `current` (`C`), returning the next canonical tree. Each change's authored result `T` is
 * computed against `B` — §4.5 step 5 runs there, wherever the patch integrates, so failures
 * carry the same messages as linear replay. The namespace rule then settles whole-tree
 * conflicts for the patch as a whole (it overrides the per-path rules), the remaining changed
 * paths resolve by §6.2's rules 1–4 with §6.4's winner table, and every rule that discards an
 * effect records one warning pair. All of a patch's path changes apply together.
 */
function integratePatch(
  patch: Patch,
  index: number,
  base: Tree,
  current: Tree,
  warnings: Map<string, WarningPair>,
): Tree {
  const authored = new Map<string, AuthoredChange>();
  patch.changes.forEach((change, changeIndex) => {
    authored.set(change.path, {
      change,
      changeIndex,
      slot: authoredResult(index, changeIndex, change, base),
    });
  });

  // `B` with every change applied must itself be prefix-free (§4.5 step 5's final check); this
  // is also what guarantees two made-present paths of one patch cannot conflict below.
  const authoredTree = new Map<string, Uint8Array>(base);
  for (const entry of authored.values()) {
    if (entry.slot.present) {
      authoredTree.set(entry.change.path, entry.slot.bytes);
    } else {
      authoredTree.delete(entry.change.path);
    }
  }
  assertPrefixFree(authoredTree);

  // Namespace pass (§6.2): `S` is the paths the patch makes present; the scan runs over `C`
  // without the patch's own deletions, so a path the patch deletes cannot be its own conflict.
  // A made-present path with a present ancestor or descendant installs its authored result and
  // removes every conflicting current path — one `namespace-wins` pair per removed path.
  const namespaceView = new Map<string, Uint8Array>(current);
  for (const entry of authored.values()) {
    if (!entry.slot.present) {
      namespaceView.delete(entry.change.path);
    }
  }
  const settled = new Map<string, AuthoredChange>();
  const removedByNamespace = new Set<string>();
  for (const entry of authored.values()) {
    if (!entry.slot.present) {
      continue;
    }
    const conflicts = namespaceConflicts(namespaceView, entry.change.path);
    if (conflicts.length === 0) {
      continue;
    }
    settled.set(entry.change.path, entry);
    for (const conflict of conflicts) {
      removedByNamespace.add(conflict);
      recordWarning(warnings, conflict, 'namespace-wins');
    }
  }

  const result = new Map<string, Uint8Array>(current);
  for (const path of removedByNamespace) {
    result.delete(path);
  }
  for (const entry of authored.values()) {
    if (!settled.has(entry.change.path)) {
      resolvePath(entry, index, base, current, result, warnings);
    }
  }
  // Settled paths install last and override whatever the per-path rules would have said —
  // §6.2's namespace rule outranks them. Settled paths are made-present by construction.
  for (const entry of settled.values()) {
    if (entry.slot.present) {
      result.set(entry.change.path, entry.slot.bytes);
    }
  }

  assertPrefixFree(result);
  return result;
}

/**
 * One change's authored result `T` (§4.3): the bytes the change produces over its exact base
 * tree, or absence for a delete. This is where §4.5 step 5 runs — creation and edit presence
 * rules, the no-op rule, and edit-script consumption all evaluate against `B` — so a patch
 * fails with the same messages wherever it integrates.
 */
function authoredResult(index: number, changeIndex: number, change: Change, base: Tree): Slot {
  switch (change.type) {
    case 'delete': {
      if (!base.has(change.path)) {
        throw new SnapError(`delete of absent path: ${change.path}`);
      }
      return { present: false };
    }
    case 'put': {
      const oldBytes = base.get(change.path);
      if (oldBytes !== undefined && equalBytes(change.content, oldBytes)) {
        throw new SnapError(`no-op change: ${change.path}`);
      }
      return { present: true, bytes: change.content };
    }
    case 'text': {
      const oldBytes = base.get(change.path);
      if (oldBytes !== undefined && !isText(oldBytes)) {
        throw new SnapError(`text change on non-text base: ${change.path}`);
      }
      const oldTokens = oldBytes === undefined ? [] : tokenize(decodeUtf8(oldBytes));
      const newTokens = applyEdit(
        `repository.patches[${String(index)}].changes[${String(changeIndex)}].edit`,
        change.edit,
        oldTokens,
      );
      const bytes = encodeUtf8(newTokens.join(''));
      if (oldBytes !== undefined && equalBytes(bytes, oldBytes)) {
        // Absent-to-present never trips this: an empty edit creating an empty file changes
        // presence, which §4.3 counts as a real change.
        throw new SnapError(`no-op change: ${change.path}`);
      }
      return { present: true, bytes };
    }
  }
}

/**
 * Resolves one unsettled changed path (§6.2 rules 1–4) against the same `B` and `C` as every
 * other path of the patch, writing the outcome into `result`. Identical-in-`B`-and-`C` applies
 * the authored change directly — the linear case; identical-in-`C`-and-`T` keeps `C`,
 * collapsing identical concurrent changes before OT can duplicate them; text-over-text goes
 * through one aggregate context transform (§5 diff, §6.3 transform); everything else falls to
 * §6.4's winner table.
 */
function resolvePath(
  entry: AuthoredChange,
  index: number,
  base: Tree,
  current: Tree,
  result: Map<string, Uint8Array>,
  warnings: Map<string, WarningPair>,
): void {
  const { change, changeIndex, slot: target } = entry;
  const path = change.path;
  const inBase = slotOf(base, path);
  const inCurrent = slotOf(current, path);

  if (sameSlot(inBase, inCurrent)) {
    setSlot(result, path, target);
    return;
  }
  if (sameSlot(inCurrent, target)) {
    return;
  }
  if (change.type === 'text' && inBase.present && inCurrent.present && isText(inCurrent.bytes)) {
    // §6.2 rule 3. `B` and `T` are text by construction — `authoredResult` rejects a text
    // change on a non-text base and a text change always produces text — so only `C`'s content
    // can disqualify the OT path. Transform once against the aggregate context edit
    // `Q = diff(B, C)`, never once per historical patch (§6.3); the transformed script consumes
    // `C`'s tokens by construction, so `applyEdit` validates it exactly like a decoded script.
    const context = `repository.patches[${String(index)}].changes[${String(changeIndex)}].edit`;
    const baseTokens = tokenize(decodeUtf8(inBase.bytes));
    const currentTokens = tokenize(decodeUtf8(inCurrent.bytes));
    const transformed = transformEdit(change.edit, diffTokens(baseTokens, currentTokens));
    const newTokens = applyEdit(context, transformed, currentTokens);
    result.set(path, encodeUtf8(newTokens.join('')));
    return;
  }
  // §6.2 rule 4: §6.4's winner table. Its rule 1 (C and T identical) is the `sameSlot` check
  // above, so the table starts at rule 2 and each case keeps the table's winner and warning.
  if (!target.present) {
    result.delete(path);
    recordWarning(warnings, path, 'delete-wins');
    return;
  }
  if (inBase.present && !inCurrent.present) {
    recordWarning(warnings, path, 'delete-wins');
    return;
  }
  if (!inBase.present && inCurrent.present) {
    result.set(path, target.bytes);
    recordWarning(warnings, path, 'later-create-wins');
    return;
  }
  if (change.type === 'put') {
    result.set(path, target.bytes);
    recordWarning(warnings, path, 'later-put-wins');
    return;
  }
  // §6.4 rule 6: a text change against non-text current content. The current content wins.
  recordWarning(warnings, path, 'put-wins');
}

/** §6.2's view of one path in a tree: bytes, or absence. */
function slotOf(tree: Tree, path: string): Slot {
  const bytes = tree.get(path);
  return bytes === undefined ? { present: false } : { present: true, bytes };
}

/** §6.2's "identical": byte equality when both are present, and absence equal to absence. */
function sameSlot(a: Slot, b: Slot): boolean {
  if (!a.present || !b.present) {
    return a.present === b.present;
  }
  return equalBytes(a.bytes, b.bytes);
}

/** Writes one resolution outcome: presence for absence, bytes otherwise. */
function setSlot(result: Map<string, Uint8Array>, path: string, slot: Slot): void {
  if (slot.present) {
    result.set(path, slot.bytes);
  } else {
    result.delete(path);
  }
}

/**
 * Records one §6.4 warning pair, collapsing duplicates. NUL cannot appear in a tracked path
 * (§2) and the reasons are fixed literals, so `path + '\0' + reason` is an unambiguous key.
 */
function recordWarning(
  warnings: Map<string, WarningPair>,
  path: string,
  reason: WarningReason,
): void {
  const key = `${path}\0${reason}`;
  if (!warnings.has(key)) {
    warnings.set(key, [path, reason]);
  }
}

/** Unique pairs ascending by path, then reason, in byte order (§6.4). */
function sortWarnings(warnings: ReadonlyMap<string, WarningPair>): WarningPair[] {
  return [...warnings.values()].sort(
    (a, b) => compareBytes(a[0], b[0]) || compareBytes(a[1], b[1]),
  );
}

/** Byte equality for the §4.3 no-op rule; `Uint8Array` has no content equality of its own. */
function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((byte, i) => byte === b[i]);
}
