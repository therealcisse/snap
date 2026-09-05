/**
 * The canonical token diff (SPEC §5).
 *
 * Patch creation, displayed diffs, and OT all use this one deterministic script. The recurrence
 * `D(i, j)` (minimum inserts/deletes to turn `A[i..]` into `B[j..]`) is filled as a flat
 * `Int32Array` suffix table, and the forward walk from `(0, 0)` retains on equal tokens and
 * otherwise deletes on ties (`D(i+1, j) <= D(i, j+1)`), which — not edit distance alone — is
 * what fixes the output when several minimal scripts exist. Design `snap-ts-architecture`
 * decision 5 locks this direct form: Myers or Hirschberg variants may replace it only behind a
 * demonstrated equivalence, and the common suffix is never trimmed because a shared trailing
 * token can still be an insert (`[b] -> [a, b, b]`, pinned in the tests).
 */
import { coalesceEditScript, type EditOp } from './edit.ts';

/**
 * Produces the canonical edit script turning `oldTokens` into `newTokens` (SPEC §5). Both sides
 * must be canonical sequences. The result is coalesced and well-formed by construction.
 */
export function diffTokens(oldTokens: readonly string[], newTokens: readonly string[]): EditOp[] {
  if (equalSequences(oldTokens, newTokens)) {
    return oldTokens.length === 0 ? [] : [{ retain: oldTokens.length }];
  }
  // Trim the common prefix: the walk retains on equality regardless of D, so the prefix is
  // exactly what walking it would emit, and the DP decides only the divergent suffix.
  const limit = Math.min(oldTokens.length, newTokens.length);
  let prefix = 0;
  while (prefix < limit && oldTokens[prefix] === newTokens[prefix]) {
    prefix += 1;
  }
  const ops = walk(oldTokens.slice(prefix), newTokens.slice(prefix));
  return prefix === 0 ? coalesceEditScript(ops) : coalesceEditScript([{ retain: prefix }, ...ops]);
}

function equalSequences(oldTokens: readonly string[], newTokens: readonly string[]): boolean {
  if (oldTokens.length !== newTokens.length) {
    return false;
  }
  return oldTokens.every((token, index) => token === newTokens[index]);
}

/**
 * Walks the §5 recurrence over the trimmed suffixes, emitting single-step operations that the
 * caller coalesces. Tokens are interned to integers first: the table compares tokens `O(n·m)`
 * times but only for equality, and integer compares keep that inner loop cheap without touching
 * the output.
 */
function walk(oldTokens: readonly string[], newTokens: readonly string[]): EditOp[] {
  const n = oldTokens.length;
  const m = newTokens.length;
  const ids = new Map<string, number>();
  const oldIds = new Int32Array(n);
  for (const [i, token] of oldTokens.entries()) {
    oldIds[i] = intern(ids, token);
  }
  const newIds = new Int32Array(m);
  for (const [j, token] of newTokens.entries()) {
    newIds[j] = intern(ids, token);
  }

  // D[i, j] for suffixes i.. and j.., filled from the bottom-right corners inward. Row n and
  // column m are the exhausted sides: only inserts (or deletes) remain.
  const width = m + 1;
  const d = new Int32Array((n + 1) * width);
  for (let j = 0; j <= m; j += 1) {
    d[n * width + j] = m - j;
  }
  for (let i = n - 1; i >= 0; i -= 1) {
    d[i * width + m] = n - i;
    for (let j = m - 1; j >= 0; j -= 1) {
      d[i * width + j] =
        cell(oldIds, i) === cell(newIds, j)
          ? cell(d, (i + 1) * width + j + 1)
          : 1 + Math.min(cell(d, (i + 1) * width + j), cell(d, i * width + j + 1));
    }
  }

  const ops: EditOp[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (cell(oldIds, i) === cell(newIds, j)) {
      ops.push({ retain: 1 });
      i += 1;
      j += 1;
    } else if (cell(d, (i + 1) * width + j) <= cell(d, i * width + j + 1)) {
      // Delete on ties: the §5 rule that selects among equally minimal scripts.
      ops.push({ delete: 1 });
      i += 1;
    } else {
      ops.push({ insert: newTokens.slice(j, j + 1) });
      j += 1;
    }
  }
  if (i < n) {
    ops.push({ delete: n - i });
  }
  if (j < m) {
    ops.push({ insert: newTokens.slice(j) });
  }
  return ops;
}

/** Maps `token` to a small integer id, assigning the next one on first sight. */
function intern(ids: Map<string, number>, token: string): number {
  let id = ids.get(token);
  if (id === undefined) {
    id = ids.size;
    ids.set(token, id);
  }
  return id;
}

/**
 * Reads `values[index]`, failing loudly on an out-of-range index. Indices are in range by
 * construction everywhere this is used; the guard exists because `noUncheckedIndexedAccess`
 * types typed-array reads as possibly undefined and non-null assertions are banned in `src/`.
 */
function cell(values: Int32Array, index: number): number {
  const value = values.at(index);
  if (value === undefined) {
    throw new Error(`diff table index ${String(index)} out of range`);
  }
  return value;
}
