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
 * Cross-repository dot comparison (SPEC §4.2, §7.6, §7.8): every dot present in both
 * repositories must carry structurally equal patches. The same dot with different values is
 * corruption, not a merge conflict (§3.5), so `merge` and the cross-repository `diff` both
 * fail here — before any output or mutation.
 *
 * Structural equality is `encodePatch` string equality: the parsed typed value, not its JSON
 * spelling, is authoritative (§4.1), so one patch written under a different key order or
 * whitespace still agrees. Both repositories must already have passed `validateRepository`;
 * the walk below runs in `local`'s validated (author, revision) order, which makes the first
 * differing shared dot also the byte-order-first one. Pinned message (tests/16):
 * `patch collision: <author> revision <n>`.
 */
export function assertNoPatchCollisions(local: Repository, remote: Repository): void {
  const remoteDots = new Map(remote.patches.map((p) => [dotKey(p), encodePatch(p)]));
  for (const patch of local.patches) {
    const remoteEncoding = remoteDots.get(dotKey(patch));
    if (remoteEncoding !== undefined && remoteEncoding !== encodePatch(patch)) {
      throw new SnapError(`patch collision: ${patch.author} revision ${String(patch.revision)}`);
    }
  }
}

/** `author->revision`; §3.1 forbids `->` in contributor IDs, so the key is unambiguous. */
function dotKey(patch: Patch): string {
  return `${patch.author}->${String(patch.revision)}`;
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
