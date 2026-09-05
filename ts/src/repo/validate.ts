/**
 * Repository validation (SPEC §4.5) over a decoded value: the cross-patch checks that decide a
 * repository is trustworthy before any command uses it.
 *
 * Steps 2–4 (patch order and dot uniqueness, the revision rule, base closure) run here as cheap
 * single passes. Steps 5–6 live inside `replayRepository`'s integration walk — change-vs-base
 * checks need each patch's materialized base, which is replay's machinery; validating them here
 * would materialize every tree twice. The frontier match runs last, after replay, because a
 * frontier gap and a cyclic history can describe the same broken repository and the spec's
 * error ordering (§4.5, pinned by the acceptance suite) attributes it to replay first.
 *
 * The cross-repository dot check (§7.6) also lives here because it is validation over decoded
 * values, not replay: `assertNoPatchCollisions` is the gate both `diff --repo` and `merge`'s
 * dot-keyed union (§7.8) owe before trusting a shared history across two repositories.
 */
import { compareBytes } from '../core/bytes.ts';
import { SnapError } from '../core/errors.ts';
import { componentOf } from '../core/version.ts';

import { encodePatch, type Patch, type Repository } from './model.ts';
import { type ReplayResult, replayRepository } from './replay.ts';

/**
 * Runs §4.5 steps 2–6 over `repository`, throwing `SnapError` with the spec's exact detail text
 * on the first violation, and returns the replay result so callers never materialize the tree
 * twice. Callers must pass a decoded value; step 1 is `decodeRepository`'s own schema check.
 */
export function validateRepository(repository: Repository): ReplayResult {
  checkPatchOrder(repository.patches);
  checkRevisionRule(repository.patches);
  checkBaseClosure(repository.patches);
  const replayed = replayRepository(repository);
  checkFrontier(repository);
  return replayed;
}

/**
 * The cross-repository dot check (SPEC §7.6): every dot present in both repositories must parse
 * to the same patch. Comparison goes through `encodePatch` — §4.2's structural-equality form —
 * so two repositories describing one change with different JSON key order or spacing agree,
 * while any difference in meaning (message, edit, content, base) fails as corrupt. The detail
 * text is pinned by tests/16: `patch collision: <author> revision <n>`.
 *
 * Walks `local`'s patches, which step 2 keeps ascending by author then revision, so where
 * several dots collide the one reported is the least in byte order — the same determinism
 * every other multi-failure check here offers.
 */
export function assertNoPatchCollisions(local: Repository, remote: Repository): void {
  const remotePatches = new Map<string, string>();
  for (const patch of remote.patches) {
    remotePatches.set(`${patch.author}->${String(patch.revision)}`, encodePatch(patch));
  }
  for (const patch of local.patches) {
    const counterpart = remotePatches.get(`${patch.author}->${String(patch.revision)}`);
    if (counterpart !== undefined && counterpart !== encodePatch(patch)) {
      throw new SnapError(`patch collision: ${patch.author} revision ${String(patch.revision)}`);
    }
  }
}

/**
 * Step 2: patches ascend by author in byte order, then by revision, and no dot repeats. One
 * pass checks both — duplicates and inversions are both violations of the same total order —
 * and non-adjacent duplicates can only appear in an order-violating array, which this names
 * first. Pinned messages: `duplicate dot: <c>-><r>`.
 */
function checkPatchOrder(patches: readonly Patch[]): void {
  let previous: Patch | undefined;
  for (const patch of patches) {
    if (previous !== undefined) {
      const order = compareBytes(previous.author, patch.author);
      if (order === 0 && previous.revision === patch.revision) {
        throw new SnapError(`duplicate dot: ${patch.author}->${String(patch.revision)}`);
      }
      if (order > 0 || (order === 0 && previous.revision > patch.revision)) {
        throw new SnapError('repository.patches are not sorted by (author, revision)');
      }
    }
    previous = patch;
  }
}

/** Step 3: a patch's revision is its base's author component plus one (SPEC §4.2). */
function checkRevisionRule(patches: readonly Patch[]): void {
  for (const patch of patches) {
    if (patch.revision !== componentOf(patch.base, patch.author) + 1) {
      throw new SnapError(
        `revision does not follow base: ${patch.author}->${String(patch.revision)}`,
      );
    }
  }
}

/**
 * Step 4, first half: every dot any base names is itself a patch's dot — bases are closed under
 * the patch set. Together with the revision rule this forces each author's revisions to be
 * exactly `1..m` with no interior gaps, which `checkFrontier` relies on.
 */
function checkBaseClosure(patches: readonly Patch[]): void {
  const dots = new Set<string>(
    patches.map((patch) => `${patch.author}->${String(patch.revision)}`),
  );
  for (const patch of patches) {
    for (const [id, revision] of patch.base) {
      if (!dots.has(`${id}->${String(revision)}`)) {
        throw new SnapError(`repository is missing ${id}->${String(revision)}`);
      }
    }
  }
}

/**
 * Step 2's frontier half and step 4's remainder, checked after replay: the frontier names
 * exactly each author's highest reached revision. A frontier beyond the patches is a gap
 * (`repository is missing <c>-><k>` names the first unreachable one); a patch beyond the
 * frontier was never integrated by any path to it (`unreachable patch: <c>-><r>`).
 */
function checkFrontier(repository: Repository): void {
  const highest = new Map<string, number>();
  for (const patch of repository.patches) {
    highest.set(patch.author, Math.max(highest.get(patch.author) ?? 0, patch.revision));
  }
  for (const [id, revision] of repository.frontier) {
    const reached = highest.get(id) ?? 0;
    if (reached < revision) {
      throw new SnapError(`repository is missing ${id}->${String(reached + 1)}`);
    }
  }
  for (const patch of repository.patches) {
    if (patch.revision > componentOf(repository.frontier, patch.author)) {
      throw new SnapError(`unreachable patch: ${patch.author}->${String(patch.revision)}`);
    }
  }
}
