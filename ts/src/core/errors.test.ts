import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import fc from 'fast-check';

import { SnapError, describeFailure } from './errors.ts';

describe('describeFailure', () => {
  it('reports a SnapError as an expected failure with exit status 1', () => {
    assert.deepEqual(describeFailure(new SnapError('x')), { exitCode: 1, line: 'snap: x\n' });
  });

  it('reports any other Error as an internal error with exit status 2', () => {
    assert.deepEqual(describeFailure(new TypeError('boom')), {
      exitCode: 2,
      line: 'snap: internal error: boom\n',
    });
  });

  it('reports a thrown non-Error value by its string form', () => {
    assert.deepEqual(describeFailure('raw'), {
      exitCode: 2,
      line: 'snap: internal error: raw\n',
    });
  });

  it('passes every single-line SnapError detail through verbatim', () => {
    fc.assert(
      fc.property(
        fc.string().filter((s) => !s.includes('\n')),
        (detail) => {
          assert.equal(describeFailure(new SnapError(detail)).line, `snap: ${detail}\n`);
        },
      ),
    );
  });
});

describe('SnapError', () => {
  it('is an Error named SnapError', () => {
    const error = new SnapError('x');
    assert.ok(error instanceof Error);
    assert.equal(error.name, 'SnapError');
    assert.equal(error.message, 'x');
  });
});
