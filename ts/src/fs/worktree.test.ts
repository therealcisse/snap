import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';

import { decodeUtf8 } from '../core/bytes.ts';

import { scanWorkingTree } from './worktree.ts';

/** A fresh empty directory standing in for a repository root. */
function root(): string {
  return mkdtempSync(join(tmpdir(), 'snap-worktree-'));
}

/** Writes a file, creating missing parents like the YAML harness's `write_file` does. */
function write(root: string, path: string, data: string | Buffer): void {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), data);
}

describe('scanWorkingTree', () => {
  it('returns files with exact bytes, iterating in byte order', () => {
    const directory = root();
    write(directory, 'z', 'z\n');
    write(directory, 'nested/file', 'nested\n');
    write(directory, '\u00e9', 'accent\n');
    write(directory, '\u{1F600}', Buffer.from([0xf0, 0x9f, 0x98, 0x80, 0x0a]));
    const tree = scanWorkingTree(directory);
    assert.deepEqual([...tree.keys()], ['nested/file', 'z', '\u00e9', '\u{1F600}']);
    assert.equal(decodeUtf8(tree.get('nested/file')!), 'nested\n');
    assert.deepEqual(tree.get('\u{1F600}'), Buffer.from([0xf0, 0x9f, 0x98, 0x80, 0x0a]));
  });

  it('excludes only the root .snap directory; a deeper .snap is ordinary', () => {
    const directory = root();
    mkdirSync(join(directory, '.snap'));
    write(directory, '.snap/untracked', 'metadata\n');
    write(directory, 'sub/.snap/x', 'tracked\n');
    const tree = scanWorkingTree(directory);
    assert.deepEqual([...tree.keys()], ['sub/.snap/x']);
  });

  it('ignores empty directories whatever their name', () => {
    const directory = root();
    mkdirSync(join(directory, 'dir\\empty'), { recursive: true });
    mkdirSync(join(directory, 'a/b'), { recursive: true });
    assert.deepEqual([...scanWorkingTree(directory).keys()], []);
  });

  it('refuses a symlink as an unsupported entry, without following it', () => {
    const directory = root();
    mkdirSync(join(directory, 'real'));
    writeFileSync(join(directory, 'real/inside'), 'inside\n');
    symlinkSync(join(directory, 'real'), join(directory, 'link'));
    assert.throws(() => scanWorkingTree(directory), {
      message: 'unsupported working tree entry: link',
    });
  });

  it('refuses a regular file whose path is not a valid tracked path', () => {
    const directory = root();
    writeFileSync(join(directory, 'z\\x'), 'backslash\n');
    assert.throws(() => scanWorkingTree(directory), {
      message: 'invalid working tree path: z\\x',
    });
    writeFileSync(join(directory, 'bad\u0001name'), 'control\n');
    assert.throws(() => scanWorkingTree(join(directory, '.')), {
      message: 'invalid working tree path: bad\u0001name',
    });
  });

  it('reports the least offender in byte order across both classes, not the walk order', () => {
    // Unsupported `m-link` (0x6d) beats invalid `z\x` (0x7a)…
    const directory = root();
    symlinkSync('missing', join(directory, 'm-link'));
    writeFileSync(join(directory, 'z\\x'), 'backslash\n');
    assert.throws(() => scanWorkingTree(directory), {
      message: 'unsupported working tree entry: m-link',
    });

    // …and invalid `a\u0001x` (0x61 0x01 0x78) beats unsupported `a/b` (0x61 0x2f) even though
    // a directory-first walk visits `a/b` first.
    const other = root();
    mkdirSync(join(other, 'a'));
    symlinkSync('missing', join(other, 'a/b'));
    writeFileSync(join(other, 'a\u0001x'), 'control\n');
    assert.throws(() => scanWorkingTree(other), {
      message: 'invalid working tree path: a\u0001x',
    });
  });
});
