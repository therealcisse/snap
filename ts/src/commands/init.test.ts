import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { SNAP_DIRECTORY } from '../fs/locate.ts';
import { EMPTY_REPOSITORY_JSON } from '../repo/model.ts';

import { init } from './init.ts';

/** A fresh temporary working directory. */
function cwd(): string {
  return mkdtempSync(join(tmpdir(), 'snap-init-'));
}

describe('init (SPEC §7.1, tests/01, tests/02)', () => {
  it('creates .snap/repository.json with the exact canonical bytes and prints ()', () => {
    const dir = cwd();
    const output = init('.', dir);
    assert.deepEqual(output, { stdout: '()\n', stderr: '' });
    assert.equal(
      readFileSync(join(dir, SNAP_DIRECTORY, 'repository.json'), 'utf8'),
      EMPTY_REPOSITORY_JSON,
    );
  });

  it('preserves existing working files', () => {
    const dir = cwd();
    writeFileSync(join(dir, 'notes.txt'), 'keep me');
    init('.', dir);
    assert.equal(readFileSync(join(dir, 'notes.txt'), 'utf8'), 'keep me');
  });

  it('creates the target and its missing parents for a nested path', () => {
    const dir = cwd();
    const output = init('new/repository', dir);
    assert.equal(output.stdout, '()\n');
    assert.ok(existsSync(join(dir, 'new', 'repository', SNAP_DIRECTORY, 'repository.json')));
  });

  it('refuses to re-initialize and leaves the existing repository untouched', () => {
    const dir = cwd();
    init('.', dir);
    assert.throws(() => init('.', dir), { message: 'repository already exists' });
    assert.equal(
      readFileSync(join(dir, SNAP_DIRECTORY, 'repository.json'), 'utf8'),
      EMPTY_REPOSITORY_JSON,
    );
  });

  it('refuses to initialize inside a repository and creates nothing', () => {
    const root = cwd();
    init('.', root);
    mkdirSync(join(root, 'child'));
    assert.throws(() => init('.', join(root, 'child')), {
      message: 'cannot initialize inside repository',
    });
    assert.ok(!existsSync(join(root, 'child', SNAP_DIRECTORY)));
  });

  it('refuses an inside-repository target given as a path operand', () => {
    const root = cwd();
    init('.', root);
    assert.throws(() => init('child', root), {
      message: 'cannot initialize inside repository',
    });
    assert.ok(!existsSync(join(root, 'child')));
  });
});
