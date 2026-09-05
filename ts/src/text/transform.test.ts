import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import fc from 'fast-check';

import { diffTokens } from './diff.ts';
import { applyEdit, type EditOp } from './edit.ts';
import { transformEdit } from './transform.ts';

describe('transformEdit table rows (SPEC §6.3)', () => {
  it('Q insert: the transformed P retains the inserted length, consuming Q only', () => {
    // Base [a]: Q inserts x before a; P retains a. The table emits retain 1 (skip x) then
    // retain 1 (a), which §6.3's coalescing pass merges into a single retain 2.
    assert.deepEqual(transformEdit([{ retain: 1 }], [{ insert: ['x\n'] }, { retain: 1 }]), [
      { retain: 2 },
    ]);
  });

  it('P insert: passes through unchanged, consuming P only', () => {
    assert.deepEqual(transformEdit([{ insert: ['x\n'] }, { retain: 1 }], [{ retain: 1 }]), [
      { insert: ['x\n'] },
      { retain: 1 },
    ]);
  });

  it('P retain with Q retain: retain the shared minimum from both', () => {
    assert.deepEqual(transformEdit([{ retain: 2 }], [{ retain: 2 }]), [{ retain: 2 }]);
  });

  it('P delete with Q retain: delete the shared minimum from both', () => {
    assert.deepEqual(transformEdit([{ delete: 1 }, { retain: 1 }], [{ retain: 2 }]), [
      { delete: 1 },
      { retain: 1 },
    ]);
  });

  it('P retain with Q delete: emit nothing, consuming both', () => {
    // Q already removed the token P wanted to retain.
    assert.deepEqual(transformEdit([{ retain: 1 }], [{ delete: 1 }]), []);
  });

  it('P delete with Q delete: emit nothing, consuming both', () => {
    assert.deepEqual(transformEdit([{ delete: 2 }], [{ delete: 1 }, { retain: 1 }]), [
      { delete: 1 },
    ]);
  });
});

describe('transformEdit behavior', () => {
  it('gives the Q insert row priority at a shared cursor', () => {
    // Base [a]; both sides insert before a. Q's insert is skipped first, then P's insert
    // lands, so concurrent inserts appear in canonical integration order (context first).
    assert.deepEqual(
      transformEdit([{ insert: ['p\n'] }, { retain: 1 }], [{ insert: ['q\n'] }, { retain: 1 }]),
      [{ retain: 1 }, { insert: ['p\n'] }, { retain: 1 }],
    );
  });

  it('processes a trailing P insert after both bases are consumed', () => {
    // Base [a]: Q appends q; P deletes a and appends p. After the delete passes the base,
    // Q's trailing insert becomes a retain ahead of P's trailing insert.
    assert.deepEqual(
      transformEdit([{ delete: 1 }, { insert: ['p\n'] }], [{ retain: 1 }, { insert: ['q\n'] }]),
      [{ delete: 1 }, { retain: 1 }, { insert: ['p\n'] }],
    );
  });

  it('keeps a P insert alive across a Q deletion', () => {
    // Base [a, b]: Q deletes both tokens; P retains a and inserts x before b. The insert
    // survives: deletions consume only base tokens.
    assert.deepEqual(
      transformEdit([{ retain: 1 }, { insert: ['x\n'] }, { retain: 1 }], [{ delete: 2 }]),
      [{ insert: ['x\n'] }],
    );
  });

  it('returns an empty script when both scripts are empty', () => {
    assert.deepEqual(transformEdit([], []), []);
  });

  it('throws a plain Error when the scripts consume different bases', () => {
    assert.throws(() => transformEdit([{ retain: 1 }], [{ retain: 2 }]), {
      name: 'Error',
      message: 'transform scripts consume different bases: 1 and 2',
    });
  });
});

describe('transformEdit property (SPEC §6.3, §11)', () => {
  const tokens = fc.constantFrom('a\n', 'b\n', 'c\n', 'd\n');
  const sequences = fc.array(tokens, { maxLength: 8 });

  /**
   * Positional reference for the canonical merge transformEdit must produce: decompose
   * each script by base position (which tokens each script retains, what each inserts at
   * each cursor), then emit per cursor Q's inserts before P's — the §6.3 Q-insert priority
   * — followed by the base token only when both scripts retain it. §6.5's convergence
   * guarantee comes from replaying patches in this canonical order (SPEC §6.1), not from
   * T(P,Q) and T(Q,P) agreeing — with a directional insert priority they deliberately do
   * not (base [], P inserts a, Q inserts b ⇒ 'b,a' vs 'a,b').
   */
  function referenceMerge(
    base: readonly string[],
    p: readonly EditOp[],
    q: readonly EditOp[],
  ): string[] {
    const decompose = (ops: readonly EditOp[]) => {
      const inserts: string[][] = Array.from({ length: base.length + 1 }, () => []);
      const retained: boolean[] = Array.from({ length: base.length }, () => false);
      let cursor = 0;
      for (const op of ops) {
        if ('retain' in op) {
          for (let k = 0; k < op.retain; k += 1) {
            retained[cursor] = true;
            cursor += 1;
          }
        } else if ('delete' in op) {
          cursor += op.delete;
        } else {
          inserts[cursor]!.push(...op.insert);
        }
      }
      return { inserts, retained };
    };
    const pd = decompose(p);
    const qd = decompose(q);
    const merged: string[] = [];
    for (let i = 0; i <= base.length; i += 1) {
      merged.push(...qd.inserts[i]!, ...pd.inserts[i]!);
      if (i < base.length && pd.retained[i] && qd.retained[i]) {
        merged.push(base[i]!);
      }
    }
    return merged;
  }

  it('reproduces the canonical context-first merge on random concurrent edits', () => {
    // Applying Q then the transformed P must land exactly on the positional reference
    // merge. P and Q come from the canonical diff of one shared base, so they consume it
    // exactly — the precondition transformEdit states.
    fc.assert(
      fc.property(sequences, sequences, sequences, (base, pResult, qResult) => {
        const p = diffTokens(base, pResult);
        const q = diffTokens(base, qResult);
        const pAfterQ = applyEdit('p', transformEdit(p, q), applyEdit('q', q, base));
        assert.deepEqual(pAfterQ, referenceMerge(base, p, q));
      }),
    );
  });

  it('never drops a token P inserted', () => {
    fc.assert(
      fc.property(sequences, sequences, sequences, (base, pResult, qResult) => {
        const p = diffTokens(base, pResult);
        const q = diffTokens(base, qResult);
        const merged = applyEdit('p', transformEdit(p, q), applyEdit('q', q, base));
        for (const op of p) {
          if ('insert' in op) {
            for (const token of op.insert) {
              assert.ok(merged.includes(token));
            }
          }
        }
      }),
    );
  });

  it('emits a script that fully consumes the post-Q sequence', () => {
    // The transformed P applies to `base` after Q, so its retain+delete total must equal
    // exactly the post-Q length — and applying it must succeed, which applyEdit checks.
    fc.assert(
      fc.property(sequences, sequences, sequences, (base, pResult, qResult) => {
        const p = diffTokens(base, pResult);
        const q = diffTokens(base, qResult);
        const afterQ = applyEdit('q', q, base);
        const transformed = transformEdit(p, q);
        let consumed = 0;
        for (const op of transformed) {
          if ('retain' in op) {
            consumed += op.retain;
          } else if ('delete' in op) {
            consumed += op.delete;
          }
        }
        assert.equal(consumed, afterQ.length);
        applyEdit('p', transformed, afterQ);
      }),
    );
  });
});
