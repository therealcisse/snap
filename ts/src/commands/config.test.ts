import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { SNAP_DIRECTORY } from '../fs/locate.ts';

import { setContributorId } from './config.ts';

const CANONICAL = '{\n  "contributor": {\n    "id": "a@x"\n  }\n}\n';

/** A fresh temporary working directory. */
function directory(): string {
  return mkdtempSync(join(tmpdir(), 'snap-config-'));
}

/** A directory that counts as a repository root because it contains `.snap`. */
function repository(): string {
  const root = directory();
  mkdirSync(join(root, SNAP_DIRECTORY), { recursive: true });
  return root;
}

describe('setContributorId (SPEC §7.2, §8, tests/03)', () => {
  it('writes the global file under $HOME with the exact canonical bytes, silently', () => {
    const home = directory();
    const output = setContributorId('a@x', { global: true, cwd: directory(), home });
    assert.deepEqual(output, { stdout: '', stderr: '' });
    assert.equal(readFileSync(join(home, '.snapconfig.json'), 'utf8'), CANONICAL);
  });

  it('writes the local file in the nearest repository', () => {
    const root = repository();
    mkdirSync(join(root, 'sub'));
    setContributorId('a@x', { global: false, cwd: join(root, 'sub'), home: directory() });
    assert.equal(readFileSync(join(root, SNAP_DIRECTORY, 'config.json'), 'utf8'), CANONICAL);
  });

  it('validates the ID before writing anything', () => {
    const home = directory();
    assert.throws(() => setContributorId('bad-id', { global: true, cwd: home, home }), {
      message: 'invalid contributor id: bad-id',
    });
    assert.ok(!existsSync(join(home, '.snapconfig.json')));
  });

  it('requires an enclosing repository for a local write', () => {
    assert.throws(
      () => setContributorId('a@x', { global: false, cwd: directory(), home: directory() }),
      { message: 'not a Snap repository' },
    );
  });

  it('requires a usable HOME for a global write', () => {
    assert.throws(
      () => setContributorId('a@x', { global: true, cwd: directory(), home: undefined }),
      {
        message: 'HOME is not set',
      },
    );
    assert.throws(() => setContributorId('a@x', { global: true, cwd: directory(), home: '' }), {
      message: 'HOME is not set',
    });
  });
});
