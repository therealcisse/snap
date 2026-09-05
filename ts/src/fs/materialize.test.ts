import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { encodeUtf8 } from '../core/bytes.ts';

import { SNAP_DIRECTORY } from './locate.ts';
import { installTree, writeRepository } from './materialize.ts';

import type { Tree } from '../repo/tree.ts';

/** A fresh empty directory standing in for a repository root. */
function root(): string {
  return mkdtempSync(join(tmpdir(), 'snap-materialize-'));
}

/** A tree built from `[path, text]` pairs. */
function treeOf(...entries: readonly (readonly [string, string])[]): Tree {
  return new Map(entries.map(([path, text]) => [path, encodeUtf8(text)]));
}

/** The bytes of a file below `root`, or `undefined` when absent. */
function read(rootDirectory: string, path: string): Uint8Array | undefined {
  try {
    return readFileSync(join(rootDirectory, path));
  } catch {
    return undefined;
  }
}

describe('installTree', () => {
  it('applies only the delta: writes adds and changes, removes deletes', () => {
    const directory = root();
    writeFileSync(join(directory, 'kept'), 'kept\n');
    writeFileSync(join(directory, 'gone'), 'gone\n');
    writeFileSync(join(directory, 'changed'), 'old\n');
    writeFileSync(join(directory, 'untracked'), 'leave me\n');
    const current = treeOf(['kept', 'kept\n'], ['gone', 'gone\n'], ['changed', 'old\n']);
    const target = treeOf(['kept', 'kept\n'], ['changed', 'new\n'], ['added', 'added\n']);
    installTree(directory, current, target);
    assert.equal(decode(read(directory, 'kept')), 'kept\n');
    assert.equal(read(directory, 'gone'), undefined);
    assert.equal(decode(read(directory, 'changed')), 'new\n');
    assert.equal(decode(read(directory, 'added')), 'added\n');
    // A file no tree names is not the install's business.
    assert.equal(decode(read(directory, 'untracked')), 'leave me\n');
  });

  it('moves a file to a directory and back, pruning what empties', () => {
    const directory = root();
    writeFileSync(join(directory, 'node'), 'file\n');
    installTree(directory, treeOf(['node', 'file\n']), treeOf(['node/child', 'child\n']));
    assert.equal(read(directory, 'node'), undefined);
    assert.equal(decode(read(directory, 'node/child')), 'child\n');

    installTree(directory, treeOf(['node/child', 'child\n']), treeOf(['node', 'file\n']));
    assert.equal(decode(read(directory, 'node')), 'file\n');
    assert.equal(read(directory, 'node/child'), undefined);
    assert.ok(!existsSync(join(directory, 'node/child')));
  });

  it('prunes only directories the removals empty, deepest first', () => {
    const directory = root();
    mkdirSync(join(directory, 'a/b'), { recursive: true });
    writeFileSync(join(directory, 'a/b/c'), 'c\n');
    writeFileSync(join(directory, 'a/b/d'), 'd\n');
    writeFileSync(join(directory, 'a/stays'), 'stays\n');
    installTree(
      directory,
      treeOf(['a/b/c', 'c\n'], ['a/b/d', 'd\n'], ['a/stays', 'stays\n']),
      treeOf(['a/stays', 'stays\n']),
    );
    assert.ok(!existsSync(join(directory, 'a/b')));
    assert.ok(existsSync(join(directory, 'a')));
    assert.equal(decode(read(directory, 'a/stays')), 'stays\n');
  });

  it('creates missing parent directories for written paths', () => {
    const directory = root();
    installTree(directory, treeOf(), treeOf(['x/y/z', 'deep\n']));
    assert.equal(decode(read(directory, 'x/y/z')), 'deep\n');
  });
});

describe('writeRepository', () => {
  it('replaces repository.json and leaves no temporary behind', () => {
    const directory = root();
    mkdirSync(join(directory, SNAP_DIRECTORY), { recursive: true });
    writeFileSync(join(directory, SNAP_DIRECTORY, 'repository.json'), 'old\n');
    writeRepository(directory, 'new\n');
    assert.equal(readFileSync(join(directory, SNAP_DIRECTORY, 'repository.json'), 'utf8'), 'new\n');
    assert.ok(!existsSync(join(directory, SNAP_DIRECTORY, 'repository.json.tmp')));
  });
});

/** Test-side decode for readable assertions; production never needs it. */
function decode(bytes: Uint8Array | undefined): string | undefined {
  return bytes === undefined ? undefined : Buffer.from(bytes).toString('utf8');
}
