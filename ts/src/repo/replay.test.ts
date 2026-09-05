import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { decodeUtf8 } from '../core/bytes.ts';

import { decodeRepository, type Repository } from './model.ts';
import { materializeVersion, replayRepository } from './replay.ts';
import { sortedPaths } from './tree.ts';

/** A raw JSON patch object, kept loose so failure fixtures stay one-liners. */
type RawPatch = Record<string, unknown>;

function patch(
  author: string,
  revision: number,
  base: readonly (readonly [string, number])[],
  changes: readonly unknown[],
): RawPatch {
  return { author, revision, base, message: 'm', changes };
}

function repositoryOf(frontier: unknown, patches: readonly RawPatch[]): Repository {
  return decodeRepository(JSON.stringify({ format: 1, frontier, patches }));
}

/** `a@x->1` creating text file `f` with `one\ntwo\n`, the base most fixtures edit. */
const createF = { type: 'text', path: 'f', edit: [{ insert: ['one\n', 'two\n'] }] };

describe('replayRepository: linear histories', () => {
  it('replays create, edit, put, and delete chains to the frontier tree', () => {
    const result = replayRepository(
      repositoryOf(
        [['a@x', 2]],
        [
          patch('a@x', 1, [], [{ type: 'put', path: 'bin', content: 'AAEC' }, createF]),
          patch(
            'a@x',
            2,
            [['a@x', 1]],
            [
              { type: 'delete', path: 'bin' },
              {
                type: 'text',
                path: 'f',
                edit: [{ retain: 1 }, { delete: 1 }, { insert: ['2\n'] }],
              },
            ],
          ),
        ],
      ),
    );
    assert.deepEqual(sortedPaths(result.tree), ['f']);
    assert.equal(decodeUtf8(result.tree.get('f')!), 'one\n2\n');
    assert.deepEqual(result.warnings, []);
  });

  it('advances across authors when each base is the previous result', () => {
    const result = replayRepository(
      repositoryOf(
        [
          ['a@x', 1],
          ['b@x', 1],
        ],
        [
          patch('a@x', 1, [], [createF]),
          patch(
            'b@x',
            1,
            [['a@x', 1]],
            [
              {
                type: 'text',
                path: 'f',
                edit: [{ retain: 1 }, { insert: ['edited\n'] }, { delete: 1 }],
              },
            ],
          ),
        ],
      ),
    );
    assert.equal(decodeUtf8(result.tree.get('f')!), 'one\nedited\n');
  });

  it('accepts an empty text edit creating an empty file', () => {
    const result = replayRepository(
      repositoryOf([['a@x', 1]], [patch('a@x', 1, [], [{ type: 'text', path: 'e', edit: [] }])]),
    );
    assert.deepEqual(result.tree.get('e'), new Uint8Array());
  });

  it('replaces put content with later put bytes', () => {
    const result = replayRepository(
      repositoryOf(
        [['a@x', 2]],
        [
          patch('a@x', 1, [], [{ type: 'put', path: 'f', content: 'YQ==' }]),
          patch('a@x', 2, [['a@x', 1]], [{ type: 'put', path: 'f', content: 'AQ==' }]),
        ],
      ),
    );
    assert.deepEqual(result.tree.get('f'), new Uint8Array([1]));
  });

  it('replays the empty repository to the empty tree with no warnings', () => {
    const result = replayRepository(repositoryOf([], []));
    assert.deepEqual(sortedPaths(result.tree), []);
    assert.deepEqual(result.warnings, []);
  });
});

describe('replayRepository: §4.5 step-5 violations', () => {
  it('rejects a delete of an absent path with the exact unprefixed message', () => {
    assert.throws(
      () =>
        replayRepository(
          repositoryOf([['a@x', 1]], [patch('a@x', 1, [], [{ type: 'delete', path: 'f' }])]),
        ),
      { message: 'delete of absent path: f' },
    );
  });

  it('rejects a text change on a non-text base', () => {
    assert.throws(
      () =>
        replayRepository(
          repositoryOf(
            [['a@x', 2]],
            [
              patch('a@x', 1, [], [{ type: 'put', path: 'bin', content: 'AAEC' }]),
              patch('a@x', 2, [['a@x', 1]], [{ type: 'text', path: 'bin', edit: [{ delete: 1 }] }]),
            ],
          ),
        ),
      { message: 'text change on non-text base: bin' },
    );
  });

  it('rejects a put that rewrites identical bytes as a no-op', () => {
    assert.throws(
      () =>
        replayRepository(
          repositoryOf(
            [['a@x', 2]],
            [
              patch('a@x', 1, [], [{ type: 'put', path: 'f', content: 'YQ==' }]),
              patch('a@x', 2, [['a@x', 1]], [{ type: 'put', path: 'f', content: 'YQ==' }]),
            ],
          ),
        ),
      { message: 'no-op change: f' },
    );
  });

  it('rejects a text edit that reproduces the base bytes as a no-op', () => {
    assert.throws(
      () =>
        replayRepository(
          repositoryOf(
            [['a@x', 2]],
            [
              patch('a@x', 1, [], [createF]),
              patch('a@x', 2, [['a@x', 1]], [{ type: 'text', path: 'f', edit: [{ retain: 2 }] }]),
            ],
          ),
        ),
      { message: 'no-op change: f' },
    );
  });

  it('surfaces under-consumption with the repository edit context', () => {
    assert.throws(
      () =>
        replayRepository(
          repositoryOf(
            [['a@x', 2]],
            [
              patch('a@x', 1, [], [createF]),
              patch('a@x', 2, [['a@x', 1]], [{ type: 'text', path: 'f', edit: [{ retain: 1 }] }]),
            ],
          ),
        ),
      { message: 'repository.patches[1].changes[0].edit does not consume old content' },
    );
  });

  it('surfaces over-consumption with the repository edit context', () => {
    assert.throws(
      () =>
        replayRepository(
          repositoryOf(
            [['a@x', 2]],
            [
              patch('a@x', 1, [], [createF]),
              patch('a@x', 2, [['a@x', 1]], [{ type: 'text', path: 'f', edit: [{ delete: 5 }] }]),
            ],
          ),
        ),
      { message: 'repository.patches[1].changes[0].edit consumes beyond old content' },
    );
  });

  it('surfaces adjacent-insert through the repository edit context', () => {
    assert.throws(
      () =>
        replayRepository(
          repositoryOf(
            [['a@x', 2]],
            [
              patch('a@x', 1, [], [createF]),
              patch(
                'a@x',
                2,
                [['a@x', 1]],
                [
                  {
                    type: 'text',
                    path: 'f',
                    edit: [{ delete: 2 }, { insert: ['a\n'] }, { insert: ['b\n'] }],
                  },
                ],
              ),
            ],
          ),
        ),
      { message: 'repository.patches[1].changes[0].edit has adjacent insert operations' },
    );
  });

  it('rejects a patch result that breaks the prefix-free tree invariant', () => {
    assert.throws(
      () =>
        replayRepository(
          repositoryOf(
            [['a@x', 2]],
            [
              patch('a@x', 1, [], [{ type: 'put', path: 'a/b', content: 'YQ==' }]),
              patch('a@x', 2, [['a@x', 1]], [{ type: 'put', path: 'a', content: 'YQ==' }]),
            ],
          ),
        ),
      { message: 'tree paths conflict: a and a/b' },
    );
  });
});

describe('replayRepository: history-level failures', () => {
  it('rejects the tests/15 cycle fixture as cyclic', () => {
    assert.throws(
      () =>
        replayRepository(
          repositoryOf(
            [
              ['a@x', 2],
              ['b@x', 1],
            ],
            [
              patch('a@x', 1, [['b@x', 1]], [{ type: 'put', path: 'f', content: 'YQ==' }]),
              patch('b@x', 1, [['a@x', 1]], [{ type: 'put', path: 'g', content: 'YQ==' }]),
            ],
          ),
        ),
      { message: 'cyclic or incomplete patch history' },
    );
  });

  it('rejects a base naming an unknown dot as incomplete', () => {
    assert.throws(
      () =>
        replayRepository(
          repositoryOf(
            [['b@x', 1]],
            [patch('b@x', 1, [['a@x', 1]], [{ type: 'put', path: 'f', content: 'YQ==' }])],
          ),
        ),
      { message: 'cyclic or incomplete patch history' },
    );
  });

  it('integrates ready patches in Snap order, then refuses the one left behind', () => {
    // Both patches base `()`, so both are ready. §6.1 picks the least result version in Snap
    // order — `(b@x->1)` reads 0 at `a@x` while `(a@x->1)` reads 1 — so b1 integrates first;
    // afterwards a1's base is strictly before the integrated version, which needs §6.2.
    assert.throws(
      () =>
        replayRepository(
          repositoryOf(
            [
              ['a@x', 1],
              ['b@x', 1],
            ],
            [
              patch('a@x', 1, [], [{ type: 'put', path: 'f', content: 'YQ==' }]),
              patch('b@x', 1, [], [{ type: 'put', path: 'g', content: 'Zw==' }]),
            ],
          ),
        ),
      { message: 'concurrent replay is not implemented yet' },
    );
  });

  it('surfaces a step-5 violation from the Snap-least of two ready patches (tests/23)', () => {
    // a1 creates f and b1 deletes it, both from `()`. The delete belongs to the Snap-least
    // patch, so replay integrates it first and its §4.5 failure surfaces without ever needing
    // §6.2 — the case the strict-validation matrix pins.
    assert.throws(
      () =>
        replayRepository(
          repositoryOf(
            [
              ['a@x', 1],
              ['b@x', 1],
            ],
            [
              patch('a@x', 1, [], [{ type: 'put', path: 'f', content: 'YQ==' }]),
              patch('b@x', 1, [], [{ type: 'delete', path: 'f' }]),
            ],
          ),
        ),
      { message: 'delete of absent path: f' },
    );
  });
});

describe('replayRepository: sequence', () => {
  it('records patches in integration order, newest last', () => {
    const repository = repositoryOf(
      [['a@x', 2]],
      [
        patch('a@x', 1, [], [createF]),
        patch(
          'a@x',
          2,
          [['a@x', 1]],
          [{ type: 'text', path: 'f', edit: [{ retain: 1 }, { delete: 1 }] }],
        ),
      ],
    );
    const result = replayRepository(repository);
    assert.deepEqual(
      result.sequence.map((entry) => `${entry.author}->${String(entry.revision)}`),
      ['a@x->1', 'a@x->2'],
    );
    // The empty repository integrates nothing.
    assert.deepEqual(replayRepository(repositoryOf([], [])).sequence, []);
  });
});

describe('materializeVersion', () => {
  it('replays the subset a known version selects', () => {
    const repository = repositoryOf(
      [['a@x', 3]],
      [
        patch('a@x', 1, [], [createF]),
        patch('a@x', 2, [['a@x', 1]], [{ type: 'text', path: 'g', edit: [{ insert: ['g\n'] }] }]),
        patch('a@x', 3, [['a@x', 2]], [{ type: 'delete', path: 'f' }]),
      ],
    );
    const atOne = materializeVersion(repository, [['a@x', 1]]);
    assert.deepEqual(sortedPaths(atOne), ['f']);
    assert.equal(decodeUtf8(atOne.get('f')!), 'one\ntwo\n');
    const atTwo = materializeVersion(repository, [['a@x', 2]]);
    assert.deepEqual(sortedPaths(atTwo), ['f', 'g']);
    const atThree = materializeVersion(repository, [['a@x', 3]]);
    assert.deepEqual(sortedPaths(atThree), ['g']);
    // The empty tree's version `()` selects nothing.
    assert.deepEqual(sortedPaths(materializeVersion(repository, [])), []);
  });
});
