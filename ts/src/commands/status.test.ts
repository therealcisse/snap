import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';

import { SNAP_DIRECTORY } from '../fs/locate.ts';
import { EMPTY_REPOSITORY_JSON } from '../repo/model.ts';

import { status } from './status.ts';

/**
 * A repository root with the canonical empty repository and optional files, each written from
 * `[path, text]`; the working tree starts matching whatever the fixture intends.
 */
function repository(...files: readonly (readonly [string, string])[]): string {
  const root = mkdtempSync(join(tmpdir(), 'snap-status-'));
  mkdirSync(join(root, SNAP_DIRECTORY), { recursive: true });
  writeFileSync(join(root, SNAP_DIRECTORY, 'repository.json'), EMPTY_REPOSITORY_JSON);
  for (const [path, text] of files) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  return root;
}

describe('status', () => {
  it('prints only the version line for a clean empty repository', () => {
    const root = repository();
    assert.deepEqual(status(root), { stdout: 'version ()\n', stderr: '' });
  });

  it('codes adds, modifications, and deletes in byte order', () => {
    const root = repository(
      ['z.txt', 'z\n'],
      ['m.txt', 'middle\n'],
      ['nested/file', 'nested\n'],
      ['\u00e9', 'accent\n'],
      ['\u{1F600}', 'emoji\n'],
    );
    assert.equal(
      status(root).stdout,
      'version ()\nA m.txt\nA nested/file\nA z.txt\nA \u00e9\nA \u{1F600}\n',
    );
  });

  it('works from a subdirectory of the root', () => {
    const root = repository();
    mkdirSync(join(root, 'sub/deep'), { recursive: true });
    assert.deepEqual(status(join(root, 'sub/deep')), { stdout: 'version ()\n', stderr: '' });
  });

  it('reports the least scan offender instead of a status', () => {
    const root = repository();
    symlinkSync('missing', join(root, 'link'));
    assert.throws(() => status(root), { message: 'unsupported working tree entry: link' });
  });
});
