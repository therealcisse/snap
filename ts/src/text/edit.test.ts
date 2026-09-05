import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { coalesceEditScript, applyEdit, type EditOp, validateEditScript } from './edit.ts';

describe('applyEdit (SPEC §4.4)', () => {
  it('applies retain, delete, and insert to a base sequence', () => {
    const ops: readonly EditOp[] = [{ retain: 1 }, { delete: 1 }, { insert: ['2\n'] }];
    assert.deepEqual(applyEdit('f edit', ops, ['one\n', 'two\n']), ['one\n', '2\n']);
  });

  it('creates a file with an insert-only script against an empty base', () => {
    assert.deepEqual(applyEdit('f edit', [{ insert: ['hello\n'] }], []), ['hello\n']);
  });

  it('creates an empty file with an empty script against an empty base', () => {
    // §4.4: an empty script is valid only when creating an empty text file.
    assert.deepEqual(applyEdit('f edit', [], []), []);
  });

  it('lets the final operation insert a token without LF', () => {
    assert.deepEqual(applyEdit('f edit', [{ insert: ['a'] }], []), ['a']);
  });

  it('rejects an empty script against a nonempty base', () => {
    assert.throws(() => applyEdit('f edit', [], ['a\n']), {
      message: 'f edit does not consume old content',
    });
  });

  it('rejects under-consumption with the suite-pinned fragment', () => {
    assert.throws(
      () => applyEdit('repository.patches[0].changes[0].edit', [{ retain: 1 }], ['a\n', 'b\n']),
      {
        message: 'repository.patches[0].changes[0].edit does not consume old content',
      },
    );
  });

  it('rejects over-consumption with the suite-pinned fragment', () => {
    assert.throws(() => applyEdit('x edit', [{ delete: 2 }], ['a\n']), {
      message: 'x edit consumes beyond old content',
    });
  });
});

describe('validateEditScript (SPEC §4.4)', () => {
  it('rejects adjacent operations of the same kind, naming the kind', () => {
    assert.throws(
      () => {
        validateEditScript('x edit', [{ retain: 1 }, { retain: 1 }]);
      },
      {
        message: 'x edit has adjacent retain operations',
      },
    );
    assert.throws(
      () => {
        validateEditScript('x edit', [{ delete: 1 }, { delete: 1 }]);
      },
      {
        message: 'x edit has adjacent delete operations',
      },
    );
    assert.throws(
      () => {
        validateEditScript('x edit', [{ insert: ['a\n'] }, { insert: ['b\n'] }]);
      },
      {
        message: 'x edit has adjacent insert operations',
      },
    );
  });

  it('rejects counts that are not positive safe integers', () => {
    for (const count of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
      assert.throws(
        () => {
          validateEditScript('x edit', [{ retain: count }]);
        },
        {
          message: 'x edit[0] must be a positive safe integer',
        },
      );
    }
  });

  it('rejects an empty insert', () => {
    assert.throws(
      () => {
        validateEditScript('x edit', [{ insert: [] }]);
      },
      {
        message: 'x edit[0] insert is empty',
      },
    );
  });

  it('rejects an insert token with LF before its final byte', () => {
    assert.throws(
      () => {
        validateEditScript('x edit', [{ insert: ['a\nb\n'] }]);
      },
      {
        message: 'x edit[0] must insert canonical tokens',
      },
    );
  });

  it('rejects a non-final insert whose last token lacks LF', () => {
    assert.throws(
      () => {
        validateEditScript('x edit', [{ insert: ['a'] }, { retain: 1 }]);
      },
      {
        message: 'x edit[0] must insert canonical tokens',
      },
    );
  });

  it('accepts a final insert whose last token lacks LF', () => {
    validateEditScript('x edit', [{ retain: 1 }, { insert: ['a'] }]);
  });

  it('accepts every well-formed shape', () => {
    validateEditScript('x edit', []);
    validateEditScript('x edit', [{ retain: 2 }]);
    validateEditScript('x edit', [{ insert: ['a\n', 'b'] }]);
  });
});

describe('coalesceEditScript', () => {
  it('adds adjacent retain and delete counts', () => {
    assert.deepEqual(
      coalesceEditScript([
        { retain: 1 },
        { retain: 2 },
        { insert: ['a\n'] },
        { delete: 1 },
        { delete: 3 },
      ]),
      [{ retain: 3 }, { insert: ['a\n'] }, { delete: 4 }],
    );
  });

  it('concatenates adjacent insert token lists', () => {
    assert.deepEqual(coalesceEditScript([{ insert: ['a\n'] }, { insert: ['b\n', 'c\n'] }]), [
      { insert: ['a\n', 'b\n', 'c\n'] },
    ]);
  });

  it('leaves scripts without adjacent same-kind operations untouched', () => {
    const ops: readonly EditOp[] = [{ retain: 1 }, { delete: 1 }, { insert: ['a\n'] }];
    assert.deepEqual(coalesceEditScript(ops), ops);
  });

  it('returns an empty script unchanged', () => {
    assert.deepEqual(coalesceEditScript([]), []);
  });
});
