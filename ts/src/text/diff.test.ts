import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import fc from 'fast-check';

import { diffTokens } from './diff.ts';
import { applyEdit, type EditOp } from './edit.ts';

describe('diffTokens goldens (SPEC §5)', () => {
  it('repeated lines: a b a -> b a a deletes first on the tie', () => {
    // The tests/05 golden. D(1,0) and D(0,1) are both 1 at the start, so the tie rule fires
    // immediately: delete a, then retain the shared b a, then insert the final a.
    const ops: readonly EditOp[] = diffTokens(['a\n', 'b\n', 'a\n'], ['b\n', 'a\n', 'a\n']);
    assert.deepEqual(ops, [{ delete: 1 }, { retain: 2 }, { insert: ['a\n'] }]);
  });

  it('the true tie a\\nb\\n -> b\\na\\n deletes rather than inserts', () => {
    // Both minimal scripts cost 2; only delete-then-insert is canonical.
    const ops: readonly EditOp[] = diffTokens(['a\n', 'b\n'], ['b\n', 'a\n']);
    assert.deepEqual(ops, [{ delete: 1 }, { retain: 1 }, { insert: ['a\n'] }]);
  });

  it('never trims the common suffix: [b] -> [a, b, b]', () => {
    // Suffix trimming would emit insert a, insert b, retain b; §5 requires insert a, retain b,
    // insert b. This is the research-verified counterexample that bans suffix trimming.
    const ops: readonly EditOp[] = diffTokens(['b\n'], ['a\n', 'b\n', 'b\n']);
    assert.deepEqual(ops, [{ insert: ['a\n'] }, { retain: 1 }, { insert: ['b\n'] }]);
  });
});

describe('diffTokens fast paths and trimming', () => {
  it('returns a single retain for identical sequences', () => {
    assert.deepEqual(diffTokens(['a\n', 'b\n'], ['a\n', 'b\n']), [{ retain: 2 }]);
  });

  it('returns an empty script for two empty sequences', () => {
    assert.deepEqual(diffTokens([], []), []);
  });

  it('inserts everything when the old side is empty', () => {
    assert.deepEqual(diffTokens([], ['a\n', 'b']), [{ insert: ['a\n', 'b'] }]);
  });

  it('deletes everything when the new side is empty', () => {
    assert.deepEqual(diffTokens(['a\n', 'b\n'], []), [{ delete: 2 }]);
  });

  it('keeps a common prefix as a leading retain', () => {
    const ops: readonly EditOp[] = diffTokens(['x\n', 'a\n', 'b\n'], ['x\n', 'b\n', 'c\n']);
    assert.deepEqual(ops, [{ retain: 1 }, { delete: 1 }, { retain: 1 }, { insert: ['c\n'] }]);
  });
});

describe('diffTokens property (SPEC §5, §11)', () => {
  it('applyEdit(diff(old, new), old) is exactly new', () => {
    // A small token alphabet forces repeated lines, where the tie rule matters.
    const tokens = fc.constantFrom('a\n', 'b\n', 'c\n', 'd\n');
    const sequences = fc.array(tokens, { maxLength: 8 });
    fc.assert(
      fc.property(sequences, sequences, (oldTokens, newTokens) => {
        assert.deepEqual(
          applyEdit('property', diffTokens(oldTokens, newTokens), oldTokens),
          newTokens,
        );
      }),
    );
  });

  it('never emits adjacent operations of the same kind', () => {
    const tokens = fc.constantFrom('a\n', 'b\n', 'c\n', 'd\n');
    const sequences = fc.array(tokens, { maxLength: 8 });
    fc.assert(
      fc.property(sequences, sequences, (oldTokens, newTokens) => {
        const ops = diffTokens(oldTokens, newTokens);
        for (let i = 1; i < ops.length; i += 1) {
          const [previous, current] = [ops[i - 1], ops[i]] as [EditOp, EditOp];
          const kind = (op: EditOp) =>
            'retain' in op ? 'retain' : 'delete' in op ? 'delete' : 'insert';
          assert.notEqual(kind(previous), kind(current));
        }
      }),
    );
  });
});
