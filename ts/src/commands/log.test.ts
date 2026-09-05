import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { SNAP_DIRECTORY } from '../fs/locate.ts';

import { log } from './log.ts';

interface RawPatch {
  author: string;
  revision: number;
  base: readonly (readonly [string, number])[];
  message: string;
  changes: readonly unknown[];
}

/**
 * A repository root whose `repository.json` carries `patches`, written as canonical JSON so
 * the decoder accepts it; the working tree itself stays empty — `log` never scans it.
 */
function repository(...patches: readonly RawPatch[]): string {
  const root = mkdtempSync(join(tmpdir(), 'snap-log-'));
  mkdirSync(join(root, SNAP_DIRECTORY), { recursive: true });
  // A linear chain ends at its last patch's result version: its base already carries every
  // other contributor's reached revision.
  const top = patches.at(-1);
  const frontier = top === undefined ? [] : [[top.author, top.revision] as const];
  writeFileSync(
    join(root, SNAP_DIRECTORY, 'repository.json'),
    JSON.stringify({ format: 1, frontier, patches }, null, 2) + '\n',
  );
  return root;
}

/** `a@x->1` creating text file `f`, the base later patches edit. */
function createF(): RawPatch {
  return {
    author: 'a@x',
    revision: 1,
    base: [],
    message: 'first\tline\nsecond\\tail',
    changes: [{ type: 'text', path: 'f', edit: [{ insert: ['one\n', 'two\n'] }] }],
  };
}

describe('log', () => {
  it('prints patches newest first with result versions and escaped messages', () => {
    const root = repository(createF(), {
      author: 'a@x',
      revision: 2,
      base: [['a@x', 1]],
      message: 'second',
      changes: [{ type: 'text', path: 'f', edit: [{ retain: 1 }, { delete: 1 }] }],
    });
    assert.deepEqual(log(root), {
      stdout: '(a@x->2)\ta@x\tsecond\n' + '(a@x->1)\ta@x\tfirst\\tline\\nsecond\\\\tail\n',
      stderr: '',
    });
  });

  it('prints nothing for the empty repository', () => {
    assert.deepEqual(log(repository()), { stdout: '', stderr: '' });
  });
});
