import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { decodeUtf8 } from '../core/bytes.ts';

import { type Repository, decodeRepository } from './model.ts';
import { assertNoPatchCollisions, validateRepository } from './validate.ts';

type RawPatch = Record<string, unknown>;

function patch(
  author: string,
  revision: number,
  base: readonly (readonly [string, number])[],
  changes: readonly unknown[],
): RawPatch {
  return { author, revision, base, message: 'm', changes };
}

function repositoryOf(
  frontier: readonly (readonly [string, number])[],
  patchesRaw: readonly RawPatch[],
): Repository {
  return decodeRepository(JSON.stringify({ format: 1, frontier, patches: patchesRaw }));
}

/** `a@x->1` creating text file `f`, the valid seed most fixtures build on. */
const createF = { type: 'text', path: 'f', edit: [{ insert: ['one\n'] }] };

describe('validateRepository: acceptance', () => {
  it('accepts a valid multi-author linear repository and returns its replayed tree', () => {
    const result = validateRepository(
      repositoryOf(
        [
          ['a@x', 2],
          ['b@x', 1],
        ],
        [
          patch('a@x', 1, [], [createF]),
          patch(
            'a@x',
            2,
            [['a@x', 1]],
            [{ type: 'text', path: 'f', edit: [{ retain: 1 }, { insert: ['two\n'] }] }],
          ),
          patch('b@x', 1, [['a@x', 2]], [{ type: 'put', path: 'bin', content: 'AAEC' }]),
        ],
      ),
    );
    assert.equal(decodeUtf8(result.tree.get('f')!), 'one\ntwo\n');
    assert.deepEqual(result.tree.get('bin'), new Uint8Array([0, 1, 2]));
  });

  it('accepts the empty repository', () => {
    validateRepository(repositoryOf([], []));
  });
});

describe('validateRepository: §4.5 steps 2–4', () => {
  it('rejects a repeated dot', () => {
    assert.throws(
      () =>
        validateRepository(
          repositoryOf(
            [['a@x', 1]],
            [
              patch('a@x', 1, [], [createF]),
              patch('a@x', 1, [], [{ type: 'put', path: 'g', content: 'YQ==' }]),
            ],
          ),
        ),
      { message: 'duplicate dot: a@x->1' },
    );
  });

  it('rejects patches out of (author, revision) order', () => {
    assert.throws(
      () =>
        validateRepository(
          repositoryOf(
            [
              ['a@x', 1],
              ['b@x', 1],
            ],
            [
              patch('b@x', 1, [['a@x', 1]], [{ type: 'put', path: 'g', content: 'YQ==' }]),
              patch('a@x', 1, [], [createF]),
            ],
          ),
        ),
      { message: 'repository.patches are not sorted by (author, revision)' },
    );
  });

  it('rejects a revision that skips the base component', () => {
    assert.throws(
      () => validateRepository(repositoryOf([['a@x', 2]], [patch('a@x', 2, [], [createF])])),
      { message: 'revision does not follow base: a@x->2' },
    );
  });

  it('attributes a missing base dot to closure, not the frontier gap (tests/15 fixture)', () => {
    // Frontier names a@x->2 and the only patch is a@x->2 based on the absent a@x->1: closure
    // fires first, so the message names the missing base dot, never the frontier's phantom gap.
    assert.throws(
      () =>
        validateRepository(repositoryOf([['a@x', 2]], [patch('a@x', 2, [['a@x', 1]], [createF])])),
      { message: 'repository is missing a@x->1' },
    );
  });
});

describe('validateRepository: replay orchestration', () => {
  it('attributes a two-dot cycle to replay, not the frontier gap (tests/15 fixture)', () => {
    // Both patches pass order, revision, and closure checks; replay alone detects that neither
    // is ever ready. The frontier gap (a@x->2 with no a@x->2 patch) must stay unreported.
    assert.throws(
      () =>
        validateRepository(
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

  it('rejects a patch the frontier never reaches (tests/23 fixture)', () => {
    // The patch integrates cleanly first; only the post-replay frontier match rejects it.
    assert.throws(() => validateRepository(repositoryOf([], [patch('a@x', 1, [], [createF])])), {
      message: 'unreachable patch: a@x->1',
    });
  });

  it('rejects a frontier naming a revision no patch provides', () => {
    assert.throws(
      () => validateRepository(repositoryOf([['a@x', 2]], [patch('a@x', 1, [], [createF])])),
      { message: 'repository is missing a@x->2' },
    );
  });

  it('accepts concurrent-ready histories through replay, returning the joined tree', () => {
    const result = validateRepository(
      repositoryOf(
        [
          ['a@x', 1],
          ['b@x', 1],
        ],
        [
          patch('a@x', 1, [], [createF]),
          patch('b@x', 1, [], [{ type: 'put', path: 'g', content: 'YQ==' }]),
        ],
      ),
    );
    // The two roots integrate in §6.1 order — b@x's `(b@x->1)` before a@x's `(a@x->1)` —
    // and touch disjoint paths, so validation now succeeds where it used to fail on §6.2's
    // absence. The returned tree is the whole-history join, exactly what commands materialize.
    assert.equal(decodeUtf8(result.tree.get('f')!), 'one\n');
    assert.deepEqual(result.tree.get('g'), new Uint8Array([0x61]));
    assert.deepEqual(result.warnings, []);
  });

  it('surfaces step-5 change failures from inside the replay walk', () => {
    assert.throws(
      () =>
        validateRepository(
          repositoryOf([['a@x', 1]], [patch('a@x', 1, [], [{ type: 'delete', path: 'f' }])]),
        ),
      { message: 'delete of absent path: f' },
    );
  });
});

describe('assertNoPatchCollisions: the §7.6 cross-repository dot check', () => {
  it('accepts structurally equal shared dots', () => {
    const left = repositoryOf([['a@x', 1]], [patch('a@x', 1, [], [createF])]);
    const right = repositoryOf([['a@x', 1]], [patch('a@x', 1, [], [createF])]);
    assertNoPatchCollisions(left, right);
  });

  it('compares parsed values, not JSON spelling: reordered keys agree', () => {
    // The same patch as local's with every object's keys in a different insertion order — §4.2
    // structural equality is the comparison unit, mirroring tests/26's duplicate fixtures.
    const right = repositoryOf(
      [['a@x', 1]],
      [
        {
          changes: [{ edit: [{ insert: ['one\n'] }], path: 'f', type: 'text' }],
          message: 'm',
          base: [],
          revision: 1,
          author: 'a@x',
        },
      ],
    );
    assertNoPatchCollisions(repositoryOf([['a@x', 1]], [patch('a@x', 1, [], [createF])]), right);
  });

  it('accepts repositories with no dot in common', () => {
    assertNoPatchCollisions(
      repositoryOf([['a@x', 1]], [patch('a@x', 1, [], [createF])]),
      repositoryOf(
        [['b@x', 1]],
        [patch('b@x', 1, [], [{ type: 'put', path: 'g', content: 'YQ==' }])],
      ),
    );
  });

  it('rejects a differing message, edit, or content on a shared dot', () => {
    const left = repositoryOf([['a@x', 1]], [patch('a@x', 1, [], [createF])]);
    const differings = [
      { ...patch('a@x', 1, [], [createF]), message: 'different' },
      patch('a@x', 1, [], [{ type: 'text', path: 'f', edit: [{ insert: ['uno\n'] }] }]),
      patch('a@x', 1, [], [{ type: 'put', path: 'f', content: 'YQI=' }]),
    ];
    for (const differing of differings) {
      assert.throws(
        () => {
          assertNoPatchCollisions(left, repositoryOf([['a@x', 1]], [differing]));
        },
        { message: 'patch collision: a@x revision 1' },
      );
    }
  });

  it('reports the least dot in byte order when several collide', () => {
    const left = repositoryOf(
      [
        ['a@x', 1],
        ['b@x', 1],
      ],
      [
        patch('a@x', 1, [], [createF]),
        patch('b@x', 1, [['a@x', 1]], [{ type: 'put', path: 'g', content: 'YQ==' }]),
      ],
    );
    const right = repositoryOf(
      [
        ['a@x', 1],
        ['b@x', 1],
      ],
      [
        patch('a@x', 1, [], [{ type: 'put', path: 'h', content: 'YQ==' }]),
        patch('b@x', 1, [['a@x', 1]], [{ type: 'put', path: 'g', content: 'YQI=' }]),
      ],
    );
    assert.throws(
      () => {
        assertNoPatchCollisions(left, right);
      },
      { message: 'patch collision: a@x revision 1' },
    );
  });
});
