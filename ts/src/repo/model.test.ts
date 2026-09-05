import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { EMPTY_VERSION, parseVersion, versionKey } from '../core/version.ts';

import {
  EMPTY_REPOSITORY_JSON,
  type Patch,
  type Repository,
  decodeRepository,
  knownVersionKeys,
} from './model.ts';

/** A minimal valid patch: author, revision, base, and one change. */
function authoredPatch(
  author: string,
  revision: number,
  base: readonly (readonly [string, number])[],
): Patch {
  return { author, revision, base, message: 'm', changes: [{ type: 'delete', path: 'f' }] };
}

/** A repository of `patches` with a placeholder frontier. */
function repositoryOf(...patches: readonly Patch[]): Repository {
  return { format: 1, frontier: EMPTY_VERSION, patches };
}

/** A one-patch repository with `patch` fields overriding the defaults. */
function withPatch(patch: Record<string, unknown>): string {
  return JSON.stringify({
    format: 1,
    frontier: [['a@x', 1]],
    patches: [
      {
        author: 'a@x',
        revision: 1,
        base: [],
        message: 'm',
        changes: [{ type: 'text', path: 'f', edit: [] }],
        ...patch,
      },
    ],
  });
}

/** A one-patch repository whose only change is `change`. */
function withChange(change: Record<string, unknown>): string {
  return withPatch({ changes: [change] });
}

describe('decodeRepository', () => {
  it('decodes a two-patch repository into the typed model', () => {
    const repository = decodeRepository(
      JSON.stringify({
        format: 1,
        frontier: [
          ['a@x', 1],
          ['b@x', 1],
        ],
        patches: [
          {
            author: 'a@x',
            revision: 1,
            base: [],
            message: 'base\twith tab\nand LF',
            changes: [
              { type: 'put', path: 'bin', content: 'AAEC' },
              { type: 'text', path: 'f', edit: [{ insert: ['one\n', 'two\n'] }] },
            ],
          },
          {
            author: 'b@x',
            revision: 1,
            base: [['a@x', 1]],
            message: 'edit',
            changes: [
              { type: 'delete', path: 'bin' },
              {
                type: 'text',
                path: 'f',
                edit: [{ retain: 1 }, { delete: 1 }, { insert: ['2\n'] }],
              },
            ],
          },
        ],
      }),
    );
    assert.deepEqual(repository, {
      format: 1,
      frontier: [
        ['a@x', 1],
        ['b@x', 1],
      ],
      patches: [
        {
          author: 'a@x',
          revision: 1,
          base: [],
          message: 'base\twith tab\nand LF',
          changes: [
            { type: 'put', path: 'bin', content: new Uint8Array([0, 1, 2]) },
            { type: 'text', path: 'f', edit: [{ insert: ['one\n', 'two\n'] }] },
          ],
        },
        {
          author: 'b@x',
          revision: 1,
          base: [['a@x', 1]],
          message: 'edit',
          changes: [
            { type: 'delete', path: 'bin' },
            { type: 'text', path: 'f', edit: [{ retain: 1 }, { delete: 1 }, { insert: ['2\n'] }] },
          ],
        },
      ],
    });
  });

  it('decodes the empty repository', () => {
    assert.deepEqual(decodeRepository('{"format":1,"frontier":[],"patches":[]}'), {
      format: 1,
      frontier: [],
      patches: [],
    });
  });

  describe('schema fixtures from the acceptance suite', () => {
    const cases: readonly (readonly [string, string, string | RegExp])[] = [
      [
        'tests/23: unknown root field',
        '{"format":1,"frontier":[],"patches":[],"unknown":true}',
        'repository has unknown field: unknown',
      ],
      [
        'tests/23: non-canonical frontier',
        JSON.stringify({
          format: 1,
          frontier: [
            ['b@x', 1],
            ['a@x', 1],
          ],
          patches: [],
        }),
        'repository.frontier is not in canonical order',
      ],
      [
        'tests/23: fractional revision',
        withPatch({}).replace('"revision":1', '"revision":1.5'),
        'repository.patches[0].revision must be a positive safe integer',
      ],
      ['tests/23: empty message', withPatch({ message: '' }), /message is empty$/],
      ['tests/23: empty changes', withPatch({ changes: [] }), /changes is empty$/],
      [
        'tests/23: unknown change field',
        withChange({ type: 'put', path: 'f', content: 'YQ==', extra: 1 }),
        /unknown field: extra$/,
      ],
      [
        'tests/23: two operations in one op object',
        withChange({ type: 'text', path: 'f', edit: [{ retain: 1, delete: 1 }] }),
        /must have one operation$/,
      ],
      [
        'tests/23: zero count',
        withChange({ type: 'text', path: 'f', edit: [{ retain: 0 }] }),
        /positive safe integer$/,
      ],
      [
        'tests/23: empty insert',
        withChange({ type: 'text', path: 'f', edit: [{ insert: [] }] }),
        /insert is empty$/,
      ],
      [
        'tests/15: duplicate key',
        '{"format":1,"format":1,"frontier":[],"patches":[]}',
        'duplicate JSON key format at repository',
      ],
      [
        'tests/15: path inside .snap',
        withChange({ type: 'put', path: '.snap/secret', content: 'YQ==' }),
        'path is invalid: .snap/secret',
      ],
      [
        'tests/15: non-canonical base64',
        withChange({ type: 'put', path: 'f', content: 'abc' }),
        'content is not canonical base64',
      ],
      [
        'tests/27: unknown patch field',
        withPatch({ unknown: true }),
        'repository.patches[0] has unknown field: unknown',
      ],
      [
        'tests/27: changes not sorted by path',
        withPatch({
          changes: [
            { type: 'text', path: 'z', edit: [] },
            { type: 'text', path: 'a', edit: [] },
          ],
        }),
        'repository.patches[0].changes are not sorted by path',
      ],
      [
        'tests/30: fractional revision lexeme',
        withPatch({}).replace('"revision":1', '"revision":1.0'),
        /positive safe integer$/,
      ],
      [
        'tests/30: exponent frontier lexeme',
        withPatch({}).replace('"frontier":[["a@x",1]]', '"frontier":[["a@x",1e0]]'),
        'repository.frontier[0][1] must be a positive safe integer',
      ],
      [
        'tests/30: fractional format lexeme',
        withPatch({}).replace('"format":1', '"format":1.0'),
        'repository.format must be 1',
      ],
    ];

    for (const [name, text, expected] of cases) {
      it(name, () => {
        assert.throws(() => decodeRepository(text), { message: expected });
      });
    }
  });

  describe('field-level rules', () => {
    it('rejects an invalid author', () => {
      assert.throws(() => decodeRepository(withPatch({ author: 'nobody' })), {
        message: 'invalid contributor id: nobody',
      });
    });

    it('rejects a control character other than tab or LF in the message', () => {
      assert.throws(() => decodeRepository(withPatch({ message: 'a\rb' })), {
        message: 'repository.patches[0].message has an invalid control character',
      });
      assert.throws(() => decodeRepository(withPatch({ message: 'a\u007f' })), {
        message: 'repository.patches[0].message has an invalid control character',
      });
    });

    it('rejects a duplicate path in changes', () => {
      assert.throws(
        () =>
          decodeRepository(
            withPatch({
              changes: [
                { type: 'text', path: 'f', edit: [] },
                { type: 'delete', path: 'f' },
              ],
            }),
          ),
        { message: 'repository.patches[0].changes are not sorted by path' },
      );
    });

    it('orders changes by UTF-8 bytes rather than UTF-16 code units', () => {
      const repository = decodeRepository(
        withPatch({
          changes: [
            { type: 'text', path: '\uFF01', edit: [] },
            { type: 'text', path: '\u{1F600}', edit: [] },
          ],
        }),
      );
      assert.equal(repository.patches[0]!.changes.length, 2);
    });

    it('rejects an unknown change type and missing fields', () => {
      assert.throws(() => decodeRepository(withChange({ type: 'move', path: 'f' })), {
        message: 'repository.patches[0].changes[0].type must be one of: text, put, delete',
      });
      assert.throws(() => decodeRepository(withChange({ type: 'text', path: 'f' })), {
        message: 'repository.patches[0].changes[0] is missing field: edit',
      });
      assert.throws(() => decodeRepository(withChange({ type: 'delete', path: 'f', edit: [] })), {
        message: 'repository.patches[0].changes[0] has unknown field: edit',
      });
    });

    it('rejects an unknown operation and an empty insert token', () => {
      assert.throws(
        () => decodeRepository(withChange({ type: 'text', path: 'f', edit: [{ keep: 1 }] })),
        { message: 'repository.patches[0].changes[0].edit[0] has unknown field: keep' },
      );
      assert.throws(
        () => decodeRepository(withChange({ type: 'text', path: 'f', edit: [{ insert: [''] }] })),
        { message: 'repository.patches[0].changes[0].edit[0].insert[0] is empty' },
      );
    });

    it('rejects a malformed version pair', () => {
      assert.throws(() => decodeRepository(withPatch({ base: [['a@x']] })), {
        message: 'repository.patches[0].base[0] must be an [id, revision] pair',
      });
    });

    it('rejects a wrong format value and a missing root field', () => {
      assert.throws(() => decodeRepository('{"format":2,"frontier":[],"patches":[]}'), {
        message: 'repository.format must be 1',
      });
      assert.throws(() => decodeRepository('{"format":1,"patches":[]}'), {
        message: 'repository is missing field: frontier',
      });
    });
  });
});

describe('EMPTY_REPOSITORY_JSON', () => {
  it('is the canonical text: two-space indent, trailing LF, no extra bytes', () => {
    assert.equal(
      EMPTY_REPOSITORY_JSON,
      '{\n  "format": 1,\n  "frontier": [],\n  "patches": []\n}\n',
    );
  });

  it('decodes to the empty repository', () => {
    assert.deepEqual(decodeRepository(EMPTY_REPOSITORY_JSON), {
      format: 1,
      frontier: [],
      patches: [],
    });
  });
});

describe('knownVersionKeys (SPEC §4.2, §7.6)', () => {
  it('knows only the empty version for an empty repository', () => {
    assert.deepEqual(new Set(knownVersionKeys(repositoryOf())), new Set(['()']));
  });

  it('adds each patch’s result version', () => {
    const keys = knownVersionKeys(
      repositoryOf(authoredPatch('a@x', 1, []), authoredPatch('a@x', 2, [['a@x', 1]])),
    );
    assert.deepEqual(keys, new Set(['()', '(a@x->1)', '(a@x->2)']));
  });

  it('sets the author component, replacing in place or inserting in canonical order', () => {
    // Replacing the author's prior component (a@x) and inserting a new author (c@x) between
    // a@x and d@x: both results must be sorted pair arrays, which versionKey requires.
    const replaced = knownVersionKeys(
      repositoryOf(
        authoredPatch('a@x', 2, [
          ['a@x', 1],
          ['b@x', 2],
        ]),
      ),
    );
    assert.ok(replaced.has('(a@x->2,b@x->2)'));
    assert.ok(!replaced.has('(a@x->1,b@x->2)'));

    const inserted = knownVersionKeys(
      repositoryOf(
        authoredPatch('c@x', 1, [
          ['a@x', 1],
          ['d@x', 1],
        ]),
      ),
    );
    assert.ok(inserted.has('(a@x->1,c@x->1,d@x->1)'));
  });

  it('keys in versionKey form, matching freshly parsed versions', () => {
    const repository = decodeRepository(
      JSON.stringify({
        format: 1,
        frontier: [],
        patches: [
          {
            author: 'a@x',
            revision: 1,
            base: [],
            message: 'm',
            changes: [{ type: 'delete', path: 'f' }],
          },
        ],
      }),
    );
    assert.ok(knownVersionKeys(repository).has(versionKey(parseVersion('(a@x->1)'))));
  });
});
