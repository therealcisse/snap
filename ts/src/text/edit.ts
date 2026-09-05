/**
 * Edit scripts over canonical tokens (SPEC §4.4).
 *
 * This module owns the edit-script *value space*: the operation union, the §4.4 well-formedness
 * rules, application to a base sequence, and coalescing. Decoding scripts from repository JSON
 * stays in `repo/model.ts` (schema decoding is the repository model's job); every script this
 * module validates, whether decoded or built by `diffTokens`/`transformEdit`, obeys the same
 * rules: counts are positive safe integers, adjacent operations differ in kind, the script
 * consumes its base exactly, and the produced sequence is canonical.
 */
import { SnapError } from '../core/errors.ts';

import { isCanonicalTokenSequence } from './tokens.ts';

/**
 * One operation of an edit script (SPEC §4.4): copy `n` old tokens, consume and remove `n` old
 * tokens, or insert tokens verbatim. Counts are positive safe integers. The one-key shape is the
 * repository JSON form; `in`-checks narrow the union exhaustively.
 */
export type EditOp =
  | { readonly retain: number }
  | { readonly delete: number }
  | { readonly insert: readonly string[] };

/** The three §4.4 operation kinds, used for the adjacency rule and error messages. */
type EditOpKind = 'retain' | 'delete' | 'insert';

/** The kind of one operation; the union is exhausted by construction. */
function editOpKind(op: EditOp): EditOpKind {
  if ('retain' in op) {
    return 'retain';
  }
  if ('delete' in op) {
    return 'delete';
  }
  return 'insert';
}

/**
 * Merges adjacent operations of the same kind into one (§4.4 forbids them in a script; §5 step 5
 * and §6.3 both end with this pass). Counts add for retain/delete and token lists concatenate
 * for insert. An empty script stays empty.
 */
export function coalesceEditScript(ops: readonly EditOp[]): EditOp[] {
  const merged: EditOp[] = [];
  for (const op of ops) {
    const previous = merged[merged.length - 1];
    if ('retain' in op) {
      if (previous !== undefined && 'retain' in previous) {
        merged[merged.length - 1] = { retain: previous.retain + op.retain };
      } else {
        merged.push(op);
      }
    } else if ('delete' in op) {
      if (previous !== undefined && 'delete' in previous) {
        merged[merged.length - 1] = { delete: previous.delete + op.delete };
      } else {
        merged.push(op);
      }
    } else if (previous !== undefined && !('retain' in previous) && !('delete' in previous)) {
      // Both are inserts: concatenate the token lists.
      merged[merged.length - 1] = { insert: [...previous.insert, ...op.insert] };
    } else {
      merged.push(op);
    }
  }
  return merged;
}

/**
 * Checks the §4.4 rules that need no base sequence, throwing `SnapError` with `<context>`
 * prefixing every message (callers pass a path such as `repository.patches[0].changes[0].edit`
 * so failures read like the rest of the validation errors).
 *
 * Enforced: counts are positive safe integers, insert lists are nonempty and their tokens are
 * canonical — every inserted token except possibly the final operation's last token ends in LF,
 * because content follows it — and adjacent operations differ in kind. Consumption against a
 * base is `applyEdit`'s rule; a script that passes here may still over- or under-consume.
 */
export function validateEditScript(context: string, ops: readonly EditOp[]): void {
  const last = ops.length - 1;
  let previousKind: EditOpKind | undefined;
  for (const [index, op] of ops.entries()) {
    if ('retain' in op || 'delete' in op) {
      const count = 'retain' in op ? op.retain : op.delete;
      if (!Number.isSafeInteger(count) || count < 1) {
        throw new SnapError(`${context}[${String(index)}] must be a positive safe integer`);
      }
    } else {
      if (op.insert.length === 0) {
        throw new SnapError(`${context}[${String(index)}] insert is empty`);
      }
      if (!isCanonicalTokenSequence(op.insert)) {
        throw new SnapError(`${context}[${String(index)}] must insert canonical tokens`);
      }
      if (index !== last) {
        const finalToken = op.insert[op.insert.length - 1];
        if (finalToken !== undefined && !finalToken.endsWith('\n')) {
          // More operations follow, so this insert cannot carry the result's final LF-less
          // token; only the final operation may produce it.
          throw new SnapError(`${context}[${String(index)}] must insert canonical tokens`);
        }
      }
    }
    const kind = editOpKind(op);
    if (kind === previousKind) {
      throw new SnapError(`${context} has adjacent operations of the same kind`);
    }
    previousKind = kind;
  }
}

/**
 * Applies `ops` to `oldTokens` (SPEC §4.4), after validating the script. The script must consume
 * the old sequence exactly — there is no implicit trailing retain — so a count mismatch is an
 * expected failure whose fragments the acceptance suite pins: `does not consume old content`
 * and `consumes beyond old content`, again prefixed with `<context>`. An empty script consumes
 * nothing and therefore applies only to an empty base: the empty-file creation case.
 *
 * `oldTokens` must itself be canonical; the result then is too, by construction.
 */
export function applyEdit(
  context: string,
  ops: readonly EditOp[],
  oldTokens: readonly string[],
): string[] {
  validateEditScript(context, ops);
  let consumed = 0;
  for (const op of ops) {
    if ('retain' in op) {
      consumed += op.retain;
    } else if ('delete' in op) {
      consumed += op.delete;
    }
  }
  if (consumed < oldTokens.length) {
    throw new SnapError(`${context} does not consume old content`);
  }
  if (consumed > oldTokens.length) {
    throw new SnapError(`${context} consumes beyond old content`);
  }
  const result: string[] = [];
  let index = 0;
  for (const op of ops) {
    if ('retain' in op) {
      result.push(...oldTokens.slice(index, index + op.retain));
      index += op.retain;
    } else if ('delete' in op) {
      index += op.delete;
    } else {
      result.push(...op.insert);
    }
  }
  return result;
}
