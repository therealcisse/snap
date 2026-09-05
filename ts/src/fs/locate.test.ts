import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { decodeConfiguration } from './locate.ts';

describe('decodeConfiguration', () => {
  it('reads the contributor ID from the canonical shape', () => {
    assert.deepEqual(decodeConfiguration('{"contributor":{"id":"alice@example.com"}}'), {
      contributorId: 'alice@example.com',
    });
  });

  it('accepts surrounding whitespace such as a trailing LF', () => {
    assert.deepEqual(decodeConfiguration('{"contributor":{"id":"global@example.com"}}\n'), {
      contributorId: 'global@example.com',
    });
  });

  it('treats an empty object and an empty contributor as no ID', () => {
    assert.deepEqual(decodeConfiguration('{}'), { contributorId: undefined });
    assert.deepEqual(decodeConfiguration('{"contributor":{}}'), { contributorId: undefined });
  });

  it('rejects unknown fields at either level', () => {
    assert.throws(() => decodeConfiguration('{"contributor":{"id":"old@x"},"unknown":true}'), {
      message: 'configuration has unknown field: unknown',
    });
    assert.throws(() => decodeConfiguration('{"contributor":{"id":"a@x","name":"A"}}'), {
      message: 'configuration.contributor has unknown field: name',
    });
  });

  it('rejects a duplicate id key', () => {
    assert.throws(() => decodeConfiguration('{"contributor":{"id":"a@x","id":"b@x"}}'), {
      message: 'duplicate JSON key id at configuration.contributor',
    });
  });

  it('rejects an invalid ID', () => {
    assert.throws(() => decodeConfiguration('{"contributor":{"id":"not-an-id"}}'), {
      message: 'invalid contributor id: not-an-id',
    });
  });

  it('rejects a non-string id and a non-object contributor', () => {
    assert.throws(() => decodeConfiguration('{"contributor":{"id":1}}'), {
      message: 'configuration.contributor.id must be a string, not a number',
    });
    assert.throws(() => decodeConfiguration('{"contributor":"a@x"}'), {
      message: 'configuration.contributor must be an object, not a string',
    });
  });

  it('rejects trailing bytes and malformed text as invalid JSON', () => {
    assert.throws(() => decodeConfiguration('{"contributor":{"id":"global@example.com"}}}}'), {
      message: /^invalid JSON: /,
    });
    assert.throws(() => decodeConfiguration('not json'), { message: /^invalid JSON: / });
    assert.throws(() => decodeConfiguration(''), { message: /^invalid JSON: / });
  });
});
