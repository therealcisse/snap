import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import fc from 'fast-check';

import {
  compareBytes,
  decodeBase64,
  decodeUtf8,
  encodeUtf8,
  isText,
  isValidTrackedPath,
} from './bytes.ts';
import { SnapError } from './errors.ts';

/** Strings over every code point, including astral ones, where UTF-16 and UTF-8 orders diverge. */
const anyString = fc.string({ unit: 'binary' });

describe('compareBytes', () => {
  it('orders U+FF01 before U+1F600 where UTF-16 code-unit order does not', () => {
    const [fullwidthBang, grinning] = ['\uFF01', '\u{1F600}'];
    assert.ok(fullwidthBang > grinning);
    assert.ok(compareBytes(fullwidthBang, grinning) < 0);
  });

  it('agrees in sign with Buffer.compare on the UTF-8 encodings', () => {
    fc.assert(
      fc.property(anyString, anyString, (a, b) => {
        assert.equal(Math.sign(compareBytes(a, b)), Buffer.compare(Buffer.from(a), Buffer.from(b)));
      }),
    );
  });

  it('places a prefix before its extension and equal strings at zero', () => {
    assert.ok(compareBytes('a', 'a/b') < 0);
    assert.ok(compareBytes('a/b', 'a') > 0);
    assert.equal(compareBytes('é', 'é'), 0);
  });
});

describe('isText', () => {
  it('rejects a NUL byte', () => {
    assert.equal(isText(new Uint8Array([0x61, 0x00])), false);
  });

  it('accepts a UTF-8 BOM', () => {
    assert.equal(isText(new Uint8Array([0xef, 0xbb, 0xbf, 0x61])), true);
  });

  it('rejects invalid UTF-8', () => {
    assert.equal(isText(new Uint8Array([0xff])), false);
  });

  it('accepts the empty file', () => {
    assert.equal(isText(new Uint8Array()), true);
  });
});

describe('decodeUtf8 and encodeUtf8', () => {
  it('preserves a leading BOM', () => {
    assert.equal(decodeUtf8(new Uint8Array([0xef, 0xbb, 0xbf, 0x61])), '\uFEFFa');
  });

  it('round-trips any well-formed string', () => {
    fc.assert(
      fc.property(anyString, (text) => {
        assert.equal(decodeUtf8(encodeUtf8(text)), text);
      }),
    );
  });
});

describe('decodeBase64', () => {
  const notCanonical = { message: 'content is not canonical base64' };

  it('rejects non-zero padding bits', () => {
    assert.throws(() => decodeBase64('AR=='), notCanonical);
  });

  it('decodes canonical input', () => {
    assert.deepEqual(decodeBase64('AQ=='), new Uint8Array([1]));
    assert.deepEqual(decodeBase64('YQ=='), new Uint8Array([0x61]));
    assert.deepEqual(decodeBase64('AAEC'), new Uint8Array([0, 1, 2]));
  });

  it('decodes the empty string to zero bytes', () => {
    assert.deepEqual(decodeBase64(''), new Uint8Array());
  });

  it('rejects missing padding, a URL-safe alphabet, and whitespace', () => {
    assert.throws(() => decodeBase64('abc'), notCanonical);
    assert.throws(() => decodeBase64('-_=='), notCanonical);
    assert.throws(() => decodeBase64('YQ==\n'), notCanonical);
    assert.throws(() => decodeBase64('YQ=='.concat(' ')), SnapError);
  });

  it('round-trips every byte sequence through the canonical encoding', () => {
    fc.assert(
      fc.property(fc.uint8Array(), (bytes) => {
        assert.deepEqual(decodeBase64(Buffer.from(bytes).toString('base64')), bytes);
      }),
    );
  });
});

describe('isValidTrackedPath', () => {
  const cases: readonly (readonly [string, boolean])[] = [
    ['', false],
    ['a\\b', false],
    ['a\u0001', false],
    ['a\u007f', false],
    ['/a', false],
    ['a/', false],
    ['a//b', false],
    ['./a', false],
    ['a/..', false],
    ['..', false],
    ['.snap', false],
    ['.snap/x', false],
    ['sub/.snap/x', true],
    ['.snapshot', true],
    ['é', true],
    ['😀', true],
    ['a-x', true],
    ['a b', true],
    ['nested/file', true],
  ];

  for (const [path, expected] of cases) {
    it(`${expected ? 'accepts' : 'rejects'} ${JSON.stringify(path)}`, () => {
      assert.equal(isValidTrackedPath(path), expected);
    });
  }
});
