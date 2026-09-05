import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import fc from 'fast-check';

import { SnapError } from './errors.ts';
import { JsonCursor, type JsonValue, parseJson } from './json.ts';

const invalidJson = { message: /^invalid JSON: / };

/** Converts a parsed tree back to plain data so it can be compared with `JSON.parse`. */
function plain(value: JsonValue): unknown {
  switch (value.kind) {
    case 'null':
      return null;
    case 'boolean':
    case 'number':
    case 'string':
      return value.value;
    case 'array':
      return value.items.map(plain);
    case 'object':
      return Object.fromEntries([...value.entries].map(([key, item]) => [key, plain(item)]));
  }
}

function number(text: string): { value: number; isInteger: boolean } {
  const value = parseJson(text, 'root');
  assert.equal(value.kind, 'number');
  return { value: value.value, isInteger: value.isInteger };
}

describe('parseJson', () => {
  it('rejects a duplicate key at the root with the root path', () => {
    assert.throws(() => parseJson('{"format":1,"format":1}', 'repository'), {
      message: 'duplicate JSON key format at repository',
    });
  });

  it('rejects a nested duplicate key with the dotted path', () => {
    assert.throws(() => parseJson('{"contributor":{"id":"a@x","id":"b@x"}}', 'configuration'), {
      message: 'duplicate JSON key id at configuration.contributor',
    });
  });

  it('marks a number as an integer only from its lexeme', () => {
    assert.deepEqual(number('1'), { value: 1, isInteger: true });
    assert.deepEqual(number('-0'), { value: -0, isInteger: true });
    assert.deepEqual(number('1.0'), { value: 1, isInteger: false });
    assert.deepEqual(number('1e0'), { value: 1, isInteger: false });
    assert.deepEqual(number('1.5'), { value: 1.5, isInteger: false });
    assert.deepEqual(number('1E+2'), { value: 100, isInteger: false });
  });

  it('parses an unsafe integer lexeme as an integer; the cursor rejects it', () => {
    const value = number('9007199254740993');
    assert.equal(value.isInteger, true);
    assert.throws(
      () => new JsonCursor(parseJson('9007199254740993', 'root'), 'root').positiveSafeInteger(),
      { message: 'root must be a positive safe integer' },
    );
  });

  it('accepts surrounding RFC 8259 whitespace', () => {
    assert.deepEqual(plain(parseJson(' \t\r\n{} \n', 'root')), {});
    assert.deepEqual(plain(parseJson('\n[1]\n', 'root')), [1]);
  });

  it('rejects any non-whitespace byte after the value', () => {
    assert.throws(() => parseJson('{}}}', 'root'), invalidJson);
    assert.throws(() => parseJson('1 2', 'root'), invalidJson);
    assert.throws(() => parseJson('{} x', 'root'), invalidJson);
    assert.throws(() => parseJson('{}\u00a0', 'root'), invalidJson);
  });

  it('rejects malformed and truncated input', () => {
    for (const text of ['not json', '{', '{"a":}', '', '   ', '[1,]', '{"a":1,}', '"abc', 'tru']) {
      assert.throws(() => parseJson(text, 'root'), invalidJson);
    }
  });

  it('rejects numbers JSON does not allow', () => {
    for (const text of ['01', '+1', '.5', '1.', 'NaN', 'Infinity', '0x10']) {
      assert.throws(() => parseJson(text, 'root'), invalidJson);
    }
  });

  it('decodes every escape including surrogate pairs', () => {
    const text = '"\\" \\\\ \\/ \\b \\f \\n \\r \\t \\u00e9 \\ud83d\\ude00"';
    assert.equal(plain(parseJson(text, 'root')), '" \\ / \b \f \n \r \t \u00e9 \u{1F600}');
  });

  it('rejects an unescaped control character and a bad escape inside a string', () => {
    assert.throws(() => parseJson('"a\nb"', 'root'), invalidJson);
    assert.throws(() => parseJson('"\\x"', 'root'), invalidJson);
    assert.throws(() => parseJson('"\\u12"', 'root'), invalidJson);
  });

  it('keeps object keys in file order', () => {
    const value = parseJson('{"z":1,"a":2,"m":3}', 'root');
    assert.equal(value.kind, 'object');
    assert.deepEqual([...value.entries.keys()], ['z', 'a', 'm']);
  });

  it('agrees with JSON.parse on every value JSON.stringify can produce', () => {
    fc.assert(
      fc.property(fc.jsonValue(), (json) => {
        const text = JSON.stringify(json);
        assert.deepEqual(plain(parseJson(text, 'root')), JSON.parse(text));
      }),
    );
  });
});

describe('JsonCursor', () => {
  function cursor(text: string, root = 'repository'): JsonCursor {
    return new JsonCursor(parseJson(text, root), root);
  }

  it('renders nested paths with dots and indices', () => {
    const root = cursor('{"patches":[{"changes":[1,"two"]}]}').object();
    const change = root.field('patches').array()[0]!.object().field('changes').array()[1]!;
    assert.equal(change.path, 'repository.patches[0].changes[1]');
    assert.equal(change.string(), 'two');
  });

  it('reports the first unread key in file order as unknown', () => {
    const root = cursor('{"format":1,"frontier":[],"patches":[],"unknown":true}').object();
    root.field('format');
    root.field('frontier');
    root.field('patches');
    assert.throws(
      () => {
        root.finishObject();
      },
      { message: 'repository has unknown field: unknown' },
    );
    const nested = cursor('{"a":{"zeta":1,"alpha":2}}').object().field('a').object();
    assert.throws(
      () => {
        nested.finishObject();
      },
      { message: 'repository.a has unknown field: zeta' },
    );
  });

  it('treats a key as read whether or not it was present', () => {
    const root = cursor('{}').object();
    assert.equal(root.optionalField('missing'), undefined);
    root.finishObject();
    assert.throws(() => root.field('missing'), {
      message: 'repository is missing field: missing',
    });
  });

  it('names the expected and actual kinds on a type mismatch', () => {
    assert.throws(() => cursor('[]').object(), {
      message: 'repository must be an object, not an array',
    });
    assert.throws(() => cursor('{"a":null}').object().field('a').string(), {
      message: 'repository.a must be a string, not null',
    });
    assert.throws(() => cursor('{"a":true}').object().field('a').array(), {
      message: 'repository.a must be an array, not a boolean',
    });
  });

  it('accepts only positive safe integer lexemes', () => {
    assert.equal(cursor('1').positiveSafeInteger(), 1);
    assert.equal(cursor('9007199254740991').positiveSafeInteger(), 9007199254740991);
    for (const text of ['0', '-1', '1.0', '1e0', '1.5', '9007199254740992', '"1"', 'null']) {
      assert.throws(() => cursor(text).positiveSafeInteger(), {
        message: 'repository must be a positive safe integer',
      });
    }
  });

  it('requires an exact integer lexeme for a fixed field', () => {
    cursor('1').integerEqual(1);
    for (const text of ['2', '1.0', '"1"']) {
      assert.throws(
        () => {
          cursor(text).integerEqual(1);
        },
        { message: 'repository must be 1' },
      );
    }
  });

  it('rejects an empty string where a nonempty one is required', () => {
    assert.equal(cursor('"x"').nonEmptyString(), 'x');
    assert.throws(() => cursor('""').nonEmptyString(), { message: 'repository is empty' });
  });

  it('restricts a discriminator to the allowed literals', () => {
    assert.equal(cursor('"put"').literal(['text', 'put', 'delete']), 'put');
    assert.throws(() => cursor('"move"').literal(['text', 'put', 'delete']), {
      message: 'repository must be one of: text, put, delete',
    });
  });

  it('counts object keys', () => {
    assert.equal(cursor('{"retain":1,"delete":1}').keyCount(), 2);
    assert.throws(() => cursor('[]').keyCount(), SnapError);
  });
});
