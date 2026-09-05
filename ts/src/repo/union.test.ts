import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { type Repository, decodeRepository } from './model.ts';
import { unionRepositories } from './union.ts';
import { validateRepository } from './validate.ts';

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
const createG = { type: 'put', path: 'g', content: 'YQ==' };

describe('unionRepositories (SPEC §7.6)', () => {
  it('interleaves disjoint histories into (author, revision) order', () => {
    const local = repositoryOf(
      [
        ['a@x', 2],
        ['c@x', 1],
      ],
      [
        patch('a@x', 1, [], [createF]),
        patch('a@x', 2, [['a@x', 1]], [{ type: 'delete', path: 'f' }]),
        patch('c@x', 1, [['a@x', 2]], [{ type: 'put', path: 'z', content: 'Wg==' }]),
      ],
    );
    // Remote's b@x->1 builds on the shared a@x->1, so the shared dot appears on both sides.
    const remote = repositoryOf(
      [
        ['a@x', 1],
        ['b@x', 1],
      ],
      [patch('a@x', 1, [], [createF]), patch('b@x', 1, [['a@x', 1]], [createG])],
    );
    const joined = unionRepositories(local, remote);
    assert.deepEqual(
      joined.patches.map((p) => `${p.author}->${String(p.revision)}`),
      ['a@x->1', 'a@x->2', 'b@x->1', 'c@x->1'],
    );
    assert.deepEqual(joined.frontier, [
      ['a@x', 2],
      ['b@x', 1],
      ['c@x', 1],
    ]);
  });

  it('keeps a shared dot once and the local side beyond it', () => {
    // Remote knows only the shared root; local has built a@x->2 on top. The union is the local
    // history itself, with the shared dot appearing exactly one time.
    const shared = patch('a@x', 1, [], [createF]);
    const local = repositoryOf(
      [['a@x', 2]],
      [shared, patch('a@x', 2, [['a@x', 1]], [{ type: 'delete', path: 'f' }])],
    );
    const remote = repositoryOf([['a@x', 1]], [shared]);
    const joined = unionRepositories(local, remote);
    assert.equal(joined.patches.length, 2);
    assert.deepEqual(
      joined.patches.map((p) => `${p.author}->${String(p.revision)}`),
      ['a@x->1', 'a@x->2'],
    );
  });

  it('joins the frontiers componentwise, not by concatenation', () => {
    // Local is ahead of remote on a@x; remote alone knows b@x. The join takes each maximum.
    const local = repositoryOf(
      [['a@x', 2]],
      [
        patch('a@x', 1, [], [createF]),
        patch('a@x', 2, [['a@x', 1]], [{ type: 'delete', path: 'f' }]),
      ],
    );
    const remote = repositoryOf(
      [
        ['a@x', 1],
        ['b@x', 1],
      ],
      [patch('a@x', 1, [], [createF]), patch('b@x', 1, [['a@x', 1]], [createG])],
    );
    const joined = unionRepositories(local, remote);
    assert.deepEqual(joined.frontier, [
      ['a@x', 2],
      ['b@x', 1],
    ]);
  });

  it('produces a repository that passes §4.5 validation and replays the joined tree', () => {
    const local = repositoryOf([['a@x', 1]], [patch('a@x', 1, [], [createF])]);
    const remote = repositoryOf([['b@x', 1]], [patch('b@x', 1, [], [createG])]);
    const joined = unionRepositories(local, remote);
    const replay = validateRepository(joined);
    // Presence, not key order: Map order follows the integration order, which §6.1 fixes but
    // this test has no stake in.
    assert.equal(replay.tree.size, 2);
    assert.deepEqual(replay.tree.get('g'), new Uint8Array([0x61]));
    assert.equal(replay.sequence.length, 2);
  });

  it('merges with an empty side unchanged', () => {
    const local = repositoryOf([['a@x', 1]], [patch('a@x', 1, [], [createF])]);
    const empty = repositoryOf([], []);
    assert.deepEqual(unionRepositories(local, empty), local);
    assert.deepEqual(unionRepositories(empty, local), local);
  });

  it('throws the collision error before producing any union', () => {
    const local = repositoryOf(
      [
        ['a@x', 1],
        ['b@x', 1],
      ],
      [patch('a@x', 1, [], [createF]), patch('b@x', 1, [['a@x', 1]], [createG])],
    );
    const remote = repositoryOf(
      [
        ['a@x', 1],
        ['b@x', 1],
      ],
      [
        patch('a@x', 1, [], [createF]),
        patch('b@x', 1, [['a@x', 1]], [{ type: 'put', path: 'g', content: 'Wg==' }]),
      ],
    );
    assert.throws(() => unionRepositories(local, remote), {
      message: 'patch collision: b@x revision 1',
    });
  });
});
