/**
 * `snap commit <message>` (SPEC §7.5): author one patch that moves the frontier from the
 * current tree to the working tree.
 *
 * The check order is fixed by the acceptance suite: contributor configuration, then the
 * message, then the working-tree scan and its cleanliness — so a bad message on a clean tree
 * reports the message (tests/25), and a scan failure reports the scan before the tree could
 * be called clean or dirty (tests/29). The patch's changes come from `selectChanges`, the one
 * place that decides §7.5's text-or-put-or-delete per path; `revert` reuses both this decision
 * and `writeRepositoryVersion` for its own authored patch.
 */
import { decodeUtf8, encodeUtf8, isText } from '../core/bytes.ts';
import { SnapError } from '../core/errors.ts';
import { type ContributorId, componentOf, formatVersion } from '../core/version.ts';
import { loadValidatedRepository, resolveContributorId } from '../fs/locate.ts';
import { writeRepository } from '../fs/materialize.ts';
import { scanWorkingTree } from '../fs/worktree.ts';
import {
  type Change,
  type Patch,
  type Repository,
  encodeRepository,
  withPatch,
} from '../repo/model.ts';
import { diffTrees, type TreeChange } from '../repo/tree.ts';
import { diffTokens } from '../text/diff.ts';
import { tokenize } from '../text/tokens.ts';

import type { CommandResult, SuccessLabel } from './output.ts';

/** §7.5's message bound. A shorter limit would silently rewrite what users may say. */
const MAX_MESSAGE_BYTES = 4096;

/**
 * Commits the working tree's changes as one patch by the configured contributor.
 *
 * Throws `SnapError` — configuration and contributor-ID failures from `resolveContributorId`,
 * `contributor.id is required; configure it locally or globally`, `invalid commit message`,
 * the scan's refusals, `working tree is clean`, `revision overflow` — all before the metadata
 * write, so a refused commit leaves the repository untouched.
 */
export function commit(
  message: string,
  cwd: string,
  env: Readonly<Record<string, string | undefined>>,
): CommandResult {
  const { root, repository, replay } = loadValidatedRepository(cwd);
  const contributor = resolveContributorId(root, env);
  if (contributor === undefined) {
    throw new SnapError('contributor.id is required; configure it locally or globally');
  }
  validateMessage(message);
  const delta = diffTrees(replay.tree, scanWorkingTree(root));
  if (delta.length === 0) {
    throw new SnapError('working tree is clean');
  }
  const patch: Patch = {
    author: contributor,
    revision: nextRevision(repository, contributor),
    base: repository.frontier,
    message,
    changes: selectChanges(delta),
  };
  return writeRepositoryVersion(root, repository, patch, 'Committed');
}

/**
 * §7.5's per-path decision, given a path delta in byte order. Absent target bytes are a
 * `delete`. Present-and-text target bytes with an absent-or-text base are a `text` change over
 * the §5 token diff — an empty file is the empty edit, an added file the all-insert script.
 * Everything else (binary content, or text arriving where non-text stands) is a `put`.
 */
export function selectChanges(delta: readonly TreeChange[]): Change[] {
  return delta.map((change): Change => {
    const target = change.new;
    if (target === undefined) {
      return { type: 'delete', path: change.path };
    }
    if (isText(target) && (change.old === undefined || isText(change.old))) {
      const oldTokens = change.old === undefined ? [] : tokenize(decodeUtf8(change.old));
      return {
        type: 'text',
        path: change.path,
        edit: diffTokens(oldTokens, tokenize(decodeUtf8(target))),
      };
    }
    return { type: 'put', path: change.path, content: target };
  });
}

/**
 * The next revision for `contributor`: its frontier component plus one, refusing the value
 * past the largest safe integer rather than letting it round (§3.2 has no such revision).
 */
export function nextRevision(repository: Repository, contributor: ContributorId): number {
  const revision = componentOf(repository.frontier, contributor) + 1;
  if (revision > Number.MAX_SAFE_INTEGER) {
    throw new SnapError('revision overflow');
  }
  return revision;
}

/**
 * Adds `patch` to the repository, replaces `repository.json`, and returns the success record
 * for the new frontier version. Metadata is written only here, after every check, so commands
 * that also touch working files can order them first (§10). `label` says which command is
 * speaking — plain mode prints only the version, §7.11's terminal line adds the label.
 */
export function writeRepositoryVersion(
  root: string,
  repository: Repository,
  patch: Patch,
  label: SuccessLabel,
): CommandResult {
  const updated = withPatch(repository, patch);
  writeRepository(root, encodeRepository(updated));
  return { kind: 'success', label, version: formatVersion(updated.frontier) };
}

/**
 * §7.5's message rules: nonempty, at most 4096 UTF-8 bytes, and decodable back — the §4.2
 * controls a stored message may carry are tab and LF only, so a message Snap could not
 * re-read is rejected at authoring time rather than corrupting the repository.
 */
function validateMessage(message: string): void {
  if (message.length === 0 || encodeUtf8(message).length > MAX_MESSAGE_BYTES) {
    throw new SnapError('invalid commit message');
  }
  for (let i = 0; i < message.length; i += 1) {
    const unit = message.charCodeAt(i);
    if ((unit < 0x20 && unit !== 0x09 && unit !== 0x0a) || unit === 0x7f) {
      throw new SnapError('invalid commit message');
    }
  }
}
