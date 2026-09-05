import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { decodeUtf8 } from '../core/bytes.ts';
import { formatVersion } from '../core/version.ts';

import { decodeRepository, type Repository } from './model.ts';
import { replayRepository } from './replay.ts';
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
});

describe('replayRepository: §6.1 selection order', () => {
  it('integrates concurrent roots so the canonically later create wins', () => {
    // §6.1 sequences the two roots by Snap order of result version — b@x's `(b@x->1)` before
    // a@x's `(a@x->1)` — so a@x integrates second and §6.4's rule 4 awards `f` to it.
    const result = replayRepository(
      repositoryOf(
        [
          ['a@x', 1],
          ['b@x', 1],
        ],
        [
          patch('a@x', 1, [], [{ type: 'put', path: 'f', content: 'YQ==' }]),
          patch('b@x', 1, [], [{ type: 'put', path: 'f', content: 'AQ==' }]),
        ],
      ),
    );
    assert.deepEqual(result.tree.get('f'), new Uint8Array([0x61]));
    assert.deepEqual(result.warnings, [['f', 'later-create-wins']]);
  });
});

describe('replayRepository: §6.2 rule 2', () => {
  it('collapses identical concurrent edits into one effect with no warning', () => {
    const edit = [{ delete: 1 }, { insert: ['X\n'] }, { retain: 1 }];
    const result = replayRepository(
      repositoryOf(
        [
          ['a@x', 1],
          ['b@x', 1],
          ['c@x', 1],
        ],
        [
          patch('a@x', 1, [], [createF]),
          patch('b@x', 1, [['a@x', 1]], [{ type: 'text', path: 'f', edit }]),
          patch('c@x', 1, [['a@x', 1]], [{ type: 'text', path: 'f', edit }]),
        ],
      ),
    );
    // c@x integrates before b@x (Snap order), so b@x's change lands where C already equals T.
    assert.equal(decodeUtf8(result.tree.get('f')!), 'X\ntwo\n');
    assert.deepEqual(result.warnings, []);
  });
});

describe('replayRepository: §6.2 rule 3', () => {
  it('transforms a concurrent insert through the aggregate context edit', () => {
    const result = replayRepository(
      repositoryOf(
        [
          ['a@x', 1],
          ['b@x', 1],
          ['c@x', 1],
        ],
        [
          patch('a@x', 1, [], [createF]),
          patch(
            'b@x',
            1,
            [['a@x', 1]],
            [{ type: 'text', path: 'f', edit: [{ insert: ['B\n'] }, { retain: 2 }] }],
          ),
          patch(
            'c@x',
            1,
            [['a@x', 1]],
            [{ type: 'text', path: 'f', edit: [{ insert: ['C\n'] }, { retain: 2 }] }],
          ),
        ],
      ),
    );
    // Both edits insert at the shared starting cursor; c@x's integrates first and becomes the
    // context, so §6.3's Q-insert priority puts b@x's insert after it: C then B, neither lost.
    assert.equal(decodeUtf8(result.tree.get('f')!), 'C\nB\none\ntwo\n');
    assert.deepEqual(result.warnings, []);
  });
});

describe('replayRepository: §6.4 winner table', () => {
  it('lets a later-integrating delete remove an edited file (delete-wins)', () => {
    const result = replayRepository(
      repositoryOf(
        [
          ['a@x', 1],
          ['b@x', 1],
          ['c@x', 1],
        ],
        [
          patch('a@x', 1, [], [createF]),
          patch('b@x', 1, [['a@x', 1]], [{ type: 'delete', path: 'f' }]),
          patch(
            'c@x',
            1,
            [['a@x', 1]],
            [{ type: 'text', path: 'f', edit: [{ retain: 2 }, { insert: ['tail\n'] }] }],
          ),
        ],
      ),
    );
    // c@x's edit integrates first; b@x's delete then arrives with T absent and C present.
    assert.deepEqual(sortedPaths(result.tree), []);
    assert.deepEqual(result.warnings, [['f', 'delete-wins']]);
  });

  it('keeps an earlier-integrating delete against a concurrent edit (delete-wins)', () => {
    const result = replayRepository(
      repositoryOf(
        [
          ['a@x', 1],
          ['b@x', 1],
          ['c@x', 1],
        ],
        [
          patch('a@x', 1, [], [createF]),
          patch(
            'b@x',
            1,
            [['a@x', 1]],
            [{ type: 'text', path: 'f', edit: [{ retain: 2 }, { insert: ['tail\n'] }] }],
          ),
          patch('c@x', 1, [['a@x', 1]], [{ type: 'delete', path: 'f' }]),
        ],
      ),
    );
    // Now the delete integrates first, so the edit arrives with B present and C absent.
    assert.deepEqual(sortedPaths(result.tree), []);
    assert.deepEqual(result.warnings, [['f', 'delete-wins']]);
  });

  it('awards concurrent puts of the same path to the later integration (later-put-wins)', () => {
    const result = replayRepository(
      repositoryOf(
        [
          ['a@x', 1],
          ['b@x', 1],
          ['c@x', 1],
        ],
        [
          patch('a@x', 1, [], [createF]),
          patch('b@x', 1, [['a@x', 1]], [{ type: 'put', path: 'f', content: 'Ag==' }]),
          patch('c@x', 1, [['a@x', 1]], [{ type: 'put', path: 'f', content: 'AQ==' }]),
        ],
      ),
    );
    assert.deepEqual(result.tree.get('f'), new Uint8Array([2]));
    assert.deepEqual(result.warnings, [['f', 'later-put-wins']]);
  });

  it('keeps non-text current content against a concurrent text edit (put-wins)', () => {
    const result = replayRepository(
      repositoryOf(
        [
          ['a@x', 1],
          ['b@x', 1],
          ['c@x', 1],
        ],
        [
          patch('a@x', 1, [], [createF]),
          patch(
            'b@x',
            1,
            [['a@x', 1]],
            [{ type: 'text', path: 'f', edit: [{ retain: 2 }, { insert: ['tail\n'] }] }],
          ),
          patch('c@x', 1, [['a@x', 1]], [{ type: 'put', path: 'f', content: 'AAEC' }]),
        ],
      ),
    );
    // The put integrates first, so the text edit meets non-text C and cannot take the OT path.
    assert.deepEqual(result.tree.get('f'), new Uint8Array([0, 1, 2]));
    assert.deepEqual(result.warnings, [['f', 'put-wins']]);
  });
});

describe('replayRepository: §6.2 namespace rule', () => {
  it('removes the conflicting current descendant and installs the incoming file', () => {
    const result = replayRepository(
      repositoryOf(
        [
          ['a@x', 1],
          ['b@x', 1],
        ],
        [
          patch('a@x', 1, [], [{ type: 'put', path: 'a', content: 'YQ==' }]),
          patch('b@x', 1, [], [{ type: 'put', path: 'a/b', content: 'YQ==' }]),
        ],
      ),
    );
    // b@x's `a/b` integrates first, then a@x's file `a` conflicts with it: `a` installs.
    assert.deepEqual(sortedPaths(result.tree), ['a']);
    assert.deepEqual(result.warnings, [['a/b', 'namespace-wins']]);
  });

  it('removes the conflicting current ancestor and installs the incoming directory file', () => {
    const result = replayRepository(
      repositoryOf(
        [
          ['a@x', 1],
          ['b@x', 1],
        ],
        [
          patch('a@x', 1, [], [{ type: 'put', path: 'a/b', content: 'YQ==' }]),
          patch('b@x', 1, [], [{ type: 'put', path: 'a', content: 'YQ==' }]),
        ],
      ),
    );
    // `a` integrates first, then a@x's `a/b` removes its ancestor `a` from the tree.
    assert.deepEqual(sortedPaths(result.tree), ['a/b']);
    assert.deepEqual(result.warnings, [['a', 'namespace-wins']]);
  });

  it('ignores a path the patch itself deletes when scanning for conflicts', () => {
    const result = replayRepository(
      repositoryOf(
        [
          ['a@x', 1],
          ['b@x', 1],
        ],
        [
          patch('b@x', 1, [], [{ type: 'put', path: 'a', content: 'YQ==' }]),
          patch(
            'a@x',
            1,
            [['b@x', 1]],
            [
              { type: 'delete', path: 'a' },
              { type: 'put', path: 'a/b', content: 'YQ==' },
            ],
          ),
        ],
      ),
    );
    // §6.2 scans C without the patch's own deletions: deleting `a` and creating `a/b` in one
    // patch is a rename-shaped move, not a namespace conflict against its own deletion.
    assert.deepEqual(sortedPaths(result.tree), ['a/b']);
    assert.deepEqual(result.warnings, []);
  });
});

describe('replayRepository: sub-replays and the exact-base memo', () => {
  it('discards warnings produced while materializing an exact base', () => {
    const result = replayRepository(
      repositoryOf(
        [
          ['a@x', 1],
          ['m@x', 1],
          ['z@x', 2],
        ],
        [
          patch('a@x', 1, [], [{ type: 'text', path: 'n', edit: [{ insert: ['n\n'] }] }]),
          patch('m@x', 1, [], [{ type: 'text', path: 'n/x', edit: [{ insert: ['x\n'] }] }]),
          patch('z@x', 1, [], [{ type: 'text', path: 'n', edit: [{ insert: ['zz\n'] }] }]),
          patch(
            'z@x',
            2,
            [
              ['a@x', 1],
              ['z@x', 1],
            ],
            [{ type: 'text', path: 'n', edit: [{ retain: 1 }, { insert: ['2\n'] }] }],
          ),
        ],
      ),
    );
    // The tests/31 shape: m@x's `n/x` removes `n` (namespace-wins), a@x's `n` removes `n/x`
    // back, and z@x->2's base `(a@x->1,z@x->1)` sub-replays — resolving a@x's create against
    // z@x's by later-create-wins — whose warning §6.2 discards. Only the top-level pairs
    // remain, and the sub-replay's resolved base feeds z@x->2's linear edit on top of `n\n`.
    assert.equal(decodeUtf8(result.tree.get('n')!), 'n\n2\n');
    assert.equal(result.tree.get('n/x'), undefined);
    assert.deepEqual(result.warnings, [
      ['n', 'namespace-wins'],
      ['n/x', 'namespace-wins'],
    ]);
  });

  it('materializes at most P+1 exact bases on a three-contributor history', () => {
    const materialized: string[] = [];
    const result = replayRepository(
      repositoryOf(
        [
          ['a@x', 1],
          ['b@x', 2],
          ['c@x', 2],
        ],
        [
          patch('a@x', 1, [], [createF]),
          patch(
            'b@x',
            1,
            [['a@x', 1]],
            [{ type: 'text', path: 'f', edit: [{ insert: ['B\n'] }, { retain: 2 }] }],
          ),
          patch(
            'b@x',
            2,
            [
              ['a@x', 1],
              ['b@x', 1],
            ],
            [{ type: 'text', path: 'f', edit: [{ delete: 1 }, { retain: 2 }] }],
          ),
          patch(
            'c@x',
            1,
            [['a@x', 1]],
            [{ type: 'text', path: 'f', edit: [{ retain: 2 }, { insert: ['C\n'] }] }],
          ),
          patch(
            'c@x',
            2,
            [
              ['a@x', 1],
              ['c@x', 1],
            ],
            [{ type: 'text', path: 'f', edit: [{ retain: 2 }, { delete: 1 }] }],
          ),
        ],
      ),
      { onMaterialize: (base) => materialized.push(formatVersion(base)) },
    );
    // P = 5, so the memo's bound is 6. In this order only b@x->2's base never passes through
    // as the running `I`: every other base is the shortcut or a seeded snapshot, which is the
    // bound's intended steady state — few sub-replays, not one per patch.
    assert.ok(materialized.length <= 6);
    assert.deepEqual(materialized, ['(a@x->1,b@x->1)']);
    assert.equal(decodeUtf8(result.tree.get('f')!), 'one\ntwo\n');
    assert.deepEqual(result.warnings, []);
  });

  it('never materializes a sub-replay on a linear history', () => {
    let calls = 0;
    const result = replayRepository(
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
                edit: [{ retain: 1 }, { insert: ['x\n'] }, { retain: 1 }],
              },
            ],
          ),
        ],
      ),
      {
        onMaterialize: () => {
          calls += 1;
        },
      },
    );
    assert.equal(calls, 0);
    assert.equal(decodeUtf8(result.tree.get('f')!), 'one\nx\ntwo\n');
  });
});
