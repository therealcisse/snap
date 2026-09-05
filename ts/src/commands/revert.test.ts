import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { SNAP_DIRECTORY } from '../fs/locate.ts';
import { EMPTY_REPOSITORY_JSON, decodeRepository } from '../repo/model.ts';

import { commit } from './commit.ts';
import { log } from './log.ts';
import { revert } from './revert.ts';

/** A repository root with the empty repository and `a@x` configured locally. */
function repository(options: { config?: boolean } = {}): string {
  const root = mkdtempSync(join(tmpdir(), 'snap-revert-'));
  mkdirSync(join(root, SNAP_DIRECTORY), { recursive: true });
  writeFileSync(join(root, SNAP_DIRECTORY, 'repository.json'), EMPTY_REPOSITORY_JSON);
  if (options.config ?? true) {
    writeFileSync(join(root, SNAP_DIRECTORY, 'config.json'), '{"contributor":{"id":"a@x"}}');
  }
  return root;
}

describe('revert', () => {
  it('restores an older tree with one additive patch across a directory transition', () => {
    const root = repository();
    writeFileSync(join(root, 'node'), 'file\n');
    commit('file', root, {});
    rmSync(join(root, 'node'));
    mkdirSync(join(root, 'node'));
    writeFileSync(join(root, 'node/child'), 'child\n');
    commit('directory', root, {});

    assert.deepEqual(revert('(a@x->1)', root, {}), {
      kind: 'success',
      label: 'Reverted',
      version: '(a@x->3)',
    });
    assert.equal(readFileSync(join(root, 'node'), 'utf8'), 'file\n');
    assert.ok(!existsSync(join(root, 'node/child')));

    assert.deepEqual(revert('(a@x->2)', root, {}), {
      kind: 'success',
      label: 'Reverted',
      version: '(a@x->4)',
    });
    assert.equal(readFileSync(join(root, 'node/child'), 'utf8'), 'child\n');
    assert.deepEqual(log(root), {
      kind: 'log',
      entries: [
        { version: '(a@x->4)', author: 'a@x', message: 'revert to (a@x->2)' },
        { version: '(a@x->3)', author: 'a@x', message: 'revert to (a@x->1)' },
        { version: '(a@x->2)', author: 'a@x', message: 'directory' },
        { version: '(a@x->1)', author: 'a@x', message: 'file' },
      ],
    });
    const stored = decodeRepository(
      readFileSync(join(root, SNAP_DIRECTORY, 'repository.json'), 'utf8'),
    );
    assert.equal(stored.patches.length, 4);
    assert.equal(stored.frontier.length, 1);
  });

  it('refuses an equal current and target tree as already current', () => {
    const root = repository();
    writeFileSync(join(root, 'node'), 'file\n');
    commit('file', root, {});
    rmSync(join(root, 'node'));
    mkdirSync(join(root, 'node'));
    writeFileSync(join(root, 'node/child'), 'child\n');
    commit('directory', root, {});
    assert.throws(() => revert('(a@x->2)', root, {}), {
      message: 'target tree is already current',
    });
  });

  it('refuses a dirty working tree', () => {
    const root = repository();
    writeFileSync(join(root, 'f'), 'one\n');
    commit('one', root, {});
    writeFileSync(join(root, 'dirty'), 'dirty\n');
    assert.throws(() => revert('(a@x->1)', root, {}), { message: 'working tree is dirty' });
  });

  it('refuses a missing contributor after the version and clean checks pass', () => {
    const root = repository();
    writeFileSync(join(root, 'f'), 'one\n');
    commit('one', root, {});
    rmSync(join(root, SNAP_DIRECTORY, 'config.json'));
    assert.throws(() => revert('(a@x->1)', root, {}), {
      message: 'contributor.id is required; configure it locally or globally',
    });
  });

  it('refuses an unknown target version before asking for a contributor', () => {
    const root = repository({ config: false });
    assert.throws(() => revert('(unknown@x->1)', root, {}), {
      message: 'unknown version: (unknown@x->1)',
    });
  });
});
