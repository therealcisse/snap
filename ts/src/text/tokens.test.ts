import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { decodeUtf8, encodeUtf8 } from '../core/bytes.ts';

import { isCanonicalTokenSequence, tokenize } from './tokens.ts';

describe('tokenize (SPEC §4.4)', () => {
  it('splits immediately after every LF, retaining LF in the token', () => {
    assert.deepEqual(tokenize('a\nb\n'), ['a\n', 'b\n']);
  });

  it('splits after the LF of a CRLF pair, keeping the CR in the first token', () => {
    // The §4.4 example: only LF delimits, so the CR is ordinary token content.
    assert.deepEqual(tokenize('a\r\nb'), ['a\r\n', 'b']);
  });

  it('returns no tokens for the empty file', () => {
    assert.deepEqual(tokenize(''), []);
  });

  it('keeps a final segment without LF as its own token', () => {
    assert.deepEqual(tokenize('a'), ['a']);
    assert.deepEqual(tokenize('a\nb'), ['a\n', 'b']);
  });

  it('keeps a leading BOM in the first token', () => {
    // decodeUtf8 preserves a BOM as U+FEFF (ignoreBOM), and tokenization does not treat it
    // specially: it is content until the first LF.
    assert.deepEqual(tokenize('\uFEFF\na\n'), ['\uFEFF\n', 'a\n']);
  });

  it('emits one token per LF in a run of empty lines', () => {
    assert.deepEqual(tokenize('a\n\nb'), ['a\n', '\n', 'b']);
  });

  it('carries multi-byte characters without splitting them', () => {
    assert.deepEqual(tokenize('é\n😀\nz'), ['é\n', '😀\n', 'z']);
  });

  it('round-trips: tokens join back to exactly the decoded bytes', () => {
    const texts = ['a\r\nb', '', 'a', '\uFEFF\na\n', 'a\n\nb', 'é\n😀\nz'];
    for (const text of texts) {
      const decoded = decodeUtf8(encodeUtf8(text));
      assert.equal(tokenize(decoded).join(''), decoded);
    }
  });
});

describe('isCanonicalTokenSequence (SPEC §4.4)', () => {
  it('accepts sequences whose tokens all end in LF', () => {
    assert.equal(isCanonicalTokenSequence(['a\n', 'b\n']), true);
  });

  it('accepts a final token without LF', () => {
    assert.equal(isCanonicalTokenSequence(['a\n', 'b']), true);
    assert.equal(isCanonicalTokenSequence(['a']), true);
  });

  it('accepts the empty sequence', () => {
    assert.equal(isCanonicalTokenSequence([]), true);
  });

  it('rejects a non-final token without LF', () => {
    assert.equal(isCanonicalTokenSequence(['a', 'b\n']), false);
  });

  it('rejects a token with LF before its final byte', () => {
    assert.equal(isCanonicalTokenSequence(['a\nb\n']), false);
  });

  it('rejects an empty token', () => {
    assert.equal(isCanonicalTokenSequence(['a\n', '']), false);
  });
});
