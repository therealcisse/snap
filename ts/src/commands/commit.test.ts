import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { encodeUtf8 } from '../core/bytes.ts';
import { SNAP_DIRECTORY } from '../fs/locate.ts';
import { EMPTY_REPOSITORY_JSON, decodeRepository } from '../repo/model.ts';
import { diffTrees } from '../repo/tree.ts';

import { commit, nextRevision, selectChanges } from './commit.ts';

/** A repository root with the empty repository and `a@x` configured locally. */
function repository(options: { config?: string } = {}): string {
  const root = mkdtempSync(join(tmpdir(), 'snap-commit-'));
  mkdirSync(join(root, SNAP_DIRECTORY), { recursive: true });
  writeFileSync(join(root, SNAP_DIRECTORY, 'repository.json'), EMPTY_REPOSITORY_JSON);
  const config = options.config ?? 'a@x';
  if (config !== 'none') {
    writeFileSync(join(root, SNAP_DIRECTORY, 'config.json'), `{"contributor":{"id":"${config}"}}`);
  }
  return root;
}

function write(root: string, path: string, text: string | Buffer): void {
  writeFileSync(join(root, path), text);
}

describe('selectChanges', () => {
  it('maps presence and bytes to delete, text, and put', () => {
    const delta = diffTrees(
      new Map([
        ['gone', encodeUtf8('x\n')],
        ['edited', encodeUtf8('one\n')],
        ['binary', new Uint8Array([0, 1])],
      ]),
      new Map([
        ['edited', encodeUtf8('one\n2\n')],
        ['binary', new Uint8Array([0, 2])],
        ['fresh', encodeUtf8('new\n')],
      ]),
    );
    assert.deepEqual(selectChanges(delta), [
      { type: 'put', path: 'binary', content: new Uint8Array([0, 2]) },
      { type: 'text', path: 'edited', edit: [{ retain: 1 }, { insert: ['2\n'] }] },
      { type: 'text', path: 'fresh', edit: [{ insert: ['new\n'] }] },
      { type: 'delete', path: 'gone' },
    ]);
  });

  it('authors an empty file as the empty text edit and textless bytes as put', () => {
    const delta = diffTrees(new Map(), new Map([['empty', new Uint8Array()]]));
    assert.deepEqual(selectChanges(delta), [{ type: 'text', path: 'empty', edit: [] }]);
    const binary = diffTrees(new Map(), new Map([['bin', new Uint8Array([0x00])]]));
    assert.deepEqual(selectChanges(binary), [
      { type: 'put', path: 'bin', content: new Uint8Array([0x00]) },
    ]);
  });
});

describe('commit', () => {
  it('authors one patch, returns the committed version, and writes canonical metadata', () => {
    const root = repository();
    write(root, 'a.txt', 'a\n');
    assert.deepEqual(commit('first', root, { HOME: '/nonexistent' }), {
      kind: 'success',
      label: 'Committed',
      version: '(a@x->1)',
    });
    const stored = decodeRepository(
      readFileSync(join(root, SNAP_DIRECTORY, 'repository.json'), 'utf8'),
    );
    assert.deepEqual(
      stored.patches.map((patch) => ({
        author: patch.author,
        revision: patch.revision,
        base: patch.base,
        message: patch.message,
      })),
      [{ author: 'a@x', revision: 1, base: [], message: 'first' }],
    );
    // The suite-pinned change shape: an added text file is the all-insert script.
    assert.deepEqual(stored.patches[0]!.changes, [
      { type: 'text', path: 'a.txt', edit: [{ insert: ['a\n'] }] },
    ]);
  });

  it('refuses a clean tree, keeping the metadata untouched', () => {
    const root = repository();
    assert.throws(() => commit('nothing', root, {}), { message: 'working tree is clean' });
    assert.equal(
      readFileSync(join(root, SNAP_DIRECTORY, 'repository.json'), 'utf8'),
      EMPTY_REPOSITORY_JSON,
    );
  });

  it('refuses messages before judging the tree, per the pinned order', () => {
    const root = repository();
    write(root, 'dirty', 'dirty\n');
    assert.throws(() => commit('', root, {}), { message: 'invalid commit message' });
    assert.throws(() => commit('bad\u0007control', root, {}), {
      message: 'invalid commit message',
    });
    const long = 'x'.repeat(4097);
    assert.throws(() => commit(long, root, {}), { message: 'invalid commit message' });
  });

  it('refuses an unconfigured contributor before anything else', () => {
    const root = repository({ config: 'none' });
    write(root, 'f', 'f\n');
    assert.throws(() => commit('m', root, { HOME: '/nonexistent' }), {
      message: 'contributor.id is required; configure it locally or globally',
    });
  });

  it('inserts the patch in (author, revision) order on a multi-author history', () => {
    const root = repository();
    // Seed a valid two-author linear history: a1 creates f, b1 (base a1) creates g.
    writeFileSync(
      join(root, SNAP_DIRECTORY, 'repository.json'),
      JSON.stringify(
        {
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
              message: 'a1',
              changes: [{ type: 'put', path: 'f', content: 'YQ==' }],
            },
            {
              author: 'b@x',
              revision: 1,
              base: [['a@x', 1]],
              message: 'b1',
              changes: [{ type: 'put', path: 'g', content: 'Zw==' }],
            },
          ],
        },
        null,
        2,
      ) + '\n',
    );
    write(root, 'f', 'b');
    assert.deepEqual(commit('a2', root, {}), {
      kind: 'success',
      label: 'Committed',
      version: '(a@x->2,b@x->1)',
    });
    const stored = decodeRepository(
      readFileSync(join(root, SNAP_DIRECTORY, 'repository.json'), 'utf8'),
    );
    // An append would put a2 after b1 and break the sortedness §4.1 requires.
    assert.deepEqual(
      stored.patches.map((patch) => `${patch.author}->${String(patch.revision)}`),
      ['a@x->1', 'a@x->2', 'b@x->1'],
    );
  });
});

describe('nextRevision', () => {
  it('increments the contributor component and refuses the unsafe overflow', () => {
    const repository = decodeRepository(EMPTY_REPOSITORY_JSON);
    assert.equal(nextRevision(repository, 'a@x'), 1);
    const maxed = decodeRepository(
      JSON.stringify({
        format: 1,
        frontier: [['a@x', Number.MAX_SAFE_INTEGER - 1]],
        patches: [],
      }),
    );
    // A frontier without its patches would never validate, but the arithmetic under test is
    // pure: the last safe increment succeeds, the one past it refuses.
    assert.equal(nextRevision(maxed, 'a@x'), Number.MAX_SAFE_INTEGER);
    const past = decodeRepository(
      JSON.stringify({
        format: 1,
        frontier: [['a@x', Number.MAX_SAFE_INTEGER]],
        patches: [],
      }),
    );
    assert.throws(() => nextRevision(past, 'a@x'), { message: 'revision overflow' });
  });
});
