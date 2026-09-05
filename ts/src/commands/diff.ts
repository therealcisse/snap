/**
 * `snap diff` (SPEC §7.6), both forms: no operands compares the current tree with the working
 * tree; `diff <old> <new>` compares two locally known versions.
 *
 * Rendering is private to this file and adds nothing the spec does not fix: one whole-file
 * block per changed text path — headers always from 1, `@@ -1,<old count> +1,<new count> @@`,
 * the §5 script's tokens prefixed by space/minus/plus — `/dev/null` for an absent side, the
 * missing-final-LF marker, and the one `Binary files … differ` line when either side is
 * present-and-non-text. Both versions are resolved and materialized before any output, so a
 * bad operand fails the whole command rather than half-printing a diff.
 */
import { decodeUtf8, isText } from '../core/bytes.ts';
import { loadValidatedRepository } from '../fs/locate.ts';
import { scanWorkingTree } from '../fs/worktree.ts';
import { resolveKnownVersion } from '../repo/model.ts';
import { materializeVersion } from '../repo/replay.ts';
import { diffTrees, type TreeChange } from '../repo/tree.ts';
import { diffTokens } from '../text/diff.ts';
import { type EditOp } from '../text/edit.ts';
import { tokenize } from '../text/tokens.ts';

import type { CommandOutput } from './output.ts';

/** The §7.6 line that follows a token lacking its final LF; one backslash, like git. */
const NO_NEWLINE = '\\ No newline at end of file\n';

/** The working-tree form: the frontier tree against one fresh scan, refusals included. */
export function diffWorktree(cwd: string): CommandOutput {
  const { root, replay } = loadValidatedRepository(cwd);
  const working = scanWorkingTree(root);
  return { stdout: render(diffTrees(replay.tree, working)), stderr: '' };
}

/**
 * The two-version form. `--repo` stays with the CLI boundary — the cross-repository diff is
 * not implemented, and the boundary already speaks its `not implemented` line — so this body
 * sees only local operands, resolved in order: old, then new (§7.6 validates before output).
 */
export function diffVersions(oldVersion: string, newVersion: string, cwd: string): CommandOutput {
  const { repository } = loadValidatedRepository(cwd);
  const oldTree = materializeVersion(repository, resolveKnownVersion(repository, oldVersion));
  const newTree = materializeVersion(repository, resolveKnownVersion(repository, newVersion));
  return { stdout: render(diffTrees(oldTree, newTree)), stderr: '' };
}

/** Renders the delta's blocks in `diffTrees`' byte order; an empty delta is no output. */
function render(delta: readonly TreeChange[]): string {
  return delta.map(renderChange).join('');
}

/**
 * One path's block. A side participates in text rendering when it is absent or text, so only
 * a present-and-binary side forces the binary line. The body re-derives the §5 script with
 * `diffTokens` — the same script `commit` would author — and walks it against the old
 * tokens, so displayed lines and committed edits can never disagree.
 */
function renderChange(change: TreeChange): string {
  const oldTextual = change.old === undefined || isText(change.old);
  const newTextual = change.new === undefined || isText(change.new);
  if (!oldTextual || !newTextual) {
    return `Binary files ${side('a', change.path, change.old)} and ${side('b', change.path, change.new)} differ\n`;
  }
  const oldTokens = change.old === undefined ? [] : tokenize(decodeUtf8(change.old));
  const newTokens = change.new === undefined ? [] : tokenize(decodeUtf8(change.new));
  const script = diffTokens(oldTokens, newTokens);
  return (
    `--- ${side('a', change.path, change.old)}\n` +
    `+++ ${side('b', change.path, change.new)}\n` +
    `@@ -1,${String(oldTokens.length)} +1,${String(newTokens.length)} @@\n` +
    renderScript(script, oldTokens)
  );
}

/** `a/<path>` or `b/<path>` for a present side, `/dev/null` for an absent one (§7.6). */
function side(prefix: string, path: string, bytes: Uint8Array | undefined): string {
  return bytes === undefined ? '/dev/null' : `${prefix}/${path}`;
}

/**
 * Walks the script, emitting one line per token: retained from the old sequence with a space,
 * deleted with a minus, inserted with a plus. A token that does not end in LF ends its line
 * anyway and earns the marker line right after — that the file's final token is the usual
 * case is the point of the marker.
 */
function renderScript(script: readonly EditOp[], oldTokens: readonly string[]): string {
  let text = '';
  let index = 0;
  const emit = (prefix: string, token: string): void => {
    text += token.endsWith('\n') ? `${prefix}${token}` : `${prefix}${token}\n${NO_NEWLINE}`;
  };
  for (const op of script) {
    if ('retain' in op) {
      for (let i = 0; i < op.retain; i += 1) {
        emit(' ', token(oldTokens, index));
        index += 1;
      }
    } else if ('delete' in op) {
      for (let i = 0; i < op.delete; i += 1) {
        emit('-', token(oldTokens, index));
        index += 1;
      }
    } else {
      for (const inserted of op.insert) {
        emit('+', inserted);
      }
    }
  }
  return text;
}

/**
 * Reads `tokens[index]`, failing loudly on an out-of-range index. Indices are in range by
 * construction — the script came from `diffTokens` over these very tokens — so a miss is a
 * defect, and the guard exists because `noUncheckedIndexedAccess` types array reads as
 * possibly undefined while non-null assertions are banned in `src/`.
 */
function token(tokens: readonly string[], index: number): string {
  const value = tokens.at(index);
  if (value === undefined) {
    throw new Error(`diff render token index ${String(index)} out of range`);
  }
  return value;
}
