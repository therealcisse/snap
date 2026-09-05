/**
 * The inclusion transform (SPEC §6.3).
 *
 * Replay integrates a patch `P` against an aggregate context edit `Q = diff(B, C)` by
 * transforming `P` so it applies *after* `Q`: both scripts consume the same base tokens, so the
 * streams walk together and `Q`'s effects become offsets in the transformed `P`. The table's
 * two rules that carry the semantics: the `Q insert` row has priority, so concurrent inserts at
 * one cursor appear in canonical integration order (context first), and deletions consume only
 * base tokens, so text the other side inserted survives. Snap runs this once per (patch, path)
 * against the aggregate context — never once per historical patch.
 */
import { coalesceEditScript, type EditOp } from './edit.ts';

/**
 * Transforms incoming edit `P` so it applies after context edit `Q` (SPEC §6.3), returning the
 * coalesced transformed script.
 *
 * Precondition: `p` and `q` are well-formed scripts that consume one common base token
 * sequence — the §4.4 full-consumption rule makes each script's retain+delete total exactly the
 * base length, so the two totals must match. A violation is a defect in the caller (the CLI
 * reports it as an internal failure, exit 2), not an expected failure.
 */
export function transformEdit(p: readonly EditOp[], q: readonly EditOp[]): EditOp[] {
  const pBase = consumedBaseTokens(p);
  const qBase = consumedBaseTokens(q);
  if (pBase !== qBase) {
    throw new Error(
      `transform scripts consume different bases: ${String(pBase)} and ${String(qBase)}`,
    );
  }

  const out: EditOp[] = [];
  let pi = 0;
  let qi = 0;
  // How much of the current retain/delete operation each stream has already consumed; inserts
  // are never split, so only these two counts carry partial progress.
  let pOffset = 0;
  let qOffset = 0;
  for (;;) {
    const po = p[pi];
    const qo = q[qi];
    if (po === undefined && qo === undefined) {
      break;
    }
    if (qo !== undefined && 'insert' in qo) {
      // Q's insert becomes content the transformed P must skip; its priority puts concurrent
      // inserts at one cursor in canonical integration order.
      out.push({ retain: qo.insert.length });
      qi += 1;
      continue;
    }
    if (po !== undefined && 'insert' in po) {
      // P's insert passes through unchanged: deletions never consume it.
      out.push(po);
      pi += 1;
      continue;
    }
    if (po === undefined || qo === undefined) {
      // Unreachable under the precondition: the exhausted stream has consumed every base
      // token, so the other can hold only inserts, which the rows above already handled.
      throw new Error('transform streams desynchronized over base tokens');
    }
    const pCount = 'retain' in po ? po.retain : po.delete;
    const qCount = 'retain' in qo ? qo.retain : qo.delete;
    const shared = Math.min(pCount - pOffset, qCount - qOffset);
    if ('retain' in po && 'retain' in qo) {
      out.push({ retain: shared });
    } else if ('delete' in po && 'retain' in qo) {
      out.push({ delete: shared });
    }
    // P retain with Q delete, and P delete with Q delete, emit nothing: Q already consumed
    // those base tokens, and P's delete of them (if any) is subsumed.
    pOffset += shared;
    if (pOffset === pCount) {
      pi += 1;
      pOffset = 0;
    }
    qOffset += shared;
    if (qOffset === qCount) {
      qi += 1;
      qOffset = 0;
    }
  }
  return coalesceEditScript(out);
}

/** Total base tokens `ops` consumes (SPEC §4.4): the sum of its retain and delete counts. */
function consumedBaseTokens(ops: readonly EditOp[]): number {
  let total = 0;
  for (const op of ops) {
    if ('retain' in op) {
      total += op.retain;
    } else if ('delete' in op) {
      total += op.delete;
    }
  }
  return total;
}
