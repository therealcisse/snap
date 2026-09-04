import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { type Output, run } from './main.ts';

interface Captured extends Output {
  readonly out: string[];
  readonly err: string[];
}

function captured(): Captured {
  const out: string[] = [];
  const err: string[] = [];
  return {
    out,
    err,
    stdout: (text) => {
      out.push(text);
    },
    stderr: (text) => {
      err.push(text);
    },
  };
}

describe('run', () => {
  it('reports an unimplemented invocation on stderr with exit status 1', () => {
    const io = captured();
    assert.equal(run(['--version'], io), 1);
    assert.equal(io.out.join(''), '');
    assert.equal(io.err.join(''), 'snap: not implemented: --version\n');
  });

  it('omits the trailing space when there are no arguments', () => {
    const io = captured();
    assert.equal(run([], io), 1);
    assert.equal(io.out.join(''), '');
    assert.equal(io.err.join(''), 'snap: not implemented:\n');
  });
});
