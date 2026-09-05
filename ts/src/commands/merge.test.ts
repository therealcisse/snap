import assert from 'node:assert/strict';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';

import { EMPTY_REPOSITORY_JSON, decodeRepository, encodeRepository } from '../repo/model.ts';

import { merge } from './merge.ts';

type RawPatch = Record<string, unknown>;

function patch(
  author: string,
  revision: number,
  base: readonly (readonly [string, number])[],
  changes: readonly unknown[],
): RawPatch {
  return { author, revision, base, message: 'm', changes };
}

function repositoryJson(
  frontier: readonly (readonly [string, number])[],
  patchesRaw: readonly RawPatch[],
): string {
  return JSON.stringify({ format: 1, frontier, patches: patchesRaw });
}

/** `a@x->1` creating text file `f`, the shared root of the forked fixtures below. */
const createF = { type: 'text', path: 'f', edit: [{ insert: ['one\n'] }] };

/** A fresh temporary directory that no test has made a repository. */
function directory(): string {
  return mkdtempSync(join(tmpdir(), 'snap-merge-'));
}

/** A repository root whose `repository.json` is `text` and whose working tree is empty. */
function repository(text: string): string {
  const root = directory();
  mkdirSync(join(root, '.snap'), { recursive: true });
  writeFileSync(join(root, '.snap', 'repository.json'), text);
  return root;
}

/** A fork of the shared history with the local side's `a@x->1` plus `delete f`. */
const LOCAL_FORK = repositoryJson(
  [
    ['a@x', 1],
    ['b@x', 1],
  ],
  [patch('a@x', 1, [], [createF]), patch('b@x', 1, [['a@x', 1]], [{ type: 'delete', path: 'f' }])],
);

/** The remote side of the same fork: `a@x->1` plus a concurrent `put f`. */
const REMOTE_FORK = repositoryJson(
  [
    ['a@x', 1],
    ['c@x', 1],
  ],
  [
    patch('a@x', 1, [], [createF]),
    patch('c@x', 1, [['a@x', 1]], [{ type: 'put', path: 'f', content: 'eA==' }]),
  ],
);

describe('merge (SPEC §7.8, §10)', () => {
  let server: Server;
  let origin = '';

  before(async () => {
    server = createServer((request, response) => {
      const target = request.url ?? '/';
      if (target === '/empty') {
        response.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
        response.end(EMPTY_REPOSITORY_JSON);
      } else {
        response.writeHead(200, { 'content-type': 'text/plain' });
        response.end('not json');
      }
    });
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => {
        resolve();
      });
    });
    const address = server.address();
    if (address === null || typeof address === 'string') {
      throw new Error('expected a TCP listener address');
    }
    origin = `http://127.0.0.1:${String(address.port)}`;
  });

  after(() => {
    server.close();
    server.closeAllConnections();
  });

  it('imports a fresh history: writes the files, the metadata, and the joined frontier', async () => {
    const local = repository(EMPTY_REPOSITORY_JSON);
    const remote = repository(repositoryJson([['a@x', 1]], [patch('a@x', 1, [], [createF])]));
    const output = await merge(remote, local);
    assert.equal(output.stdout, '(a@x->1)\n');
    assert.equal(output.stderr, '');
    assert.equal(readFileSync(join(local, 'f'), 'utf8'), 'one\n');
    const stored = decodeRepository(readFileSync(join(local, '.snap', 'repository.json'), 'utf8'));
    assert.equal(stored.patches.length, 1);
    assert.deepEqual(stored.frontier, [['a@x', 1]]);
  });

  it('reports exactly the auto-resolutions this merge added', async () => {
    // Local deleted `f` after the shared root; remote concurrently put `f`. The joined replay
    // orders the put first, so the delete lands as delete-wins — a pair the local replay,
    // whose delete was linear, never had.
    const local = repository(LOCAL_FORK);
    const remote = repository(REMOTE_FORK);
    const output = await merge(remote, local);
    assert.equal(output.stdout, '(a@x->1,b@x->1,c@x->1)\n');
    assert.equal(output.stderr, 'warning: auto-resolved f: delete-wins\n');
    // The delete won: the working tree stays empty, and the metadata holds all three patches.
    assert.equal(existsSync(join(local, 'f')), false);
    assert.equal(
      decodeRepository(readFileSync(join(local, '.snap', 'repository.json'), 'utf8')).patches
        .length,
      3,
    );
  });

  it('is silent on stderr when the operand adds nothing the local side lacks', async () => {
    const local = repository(LOCAL_FORK);
    const remote = repository(REMOTE_FORK);
    await merge(remote, local);
    // Re-merging the same operand: every dot is shared and equal, so the joined replay's
    // warnings are exactly the local replay's — the difference the command prints is empty.
    const again = await merge(remote, local);
    assert.equal(again.stdout, '(a@x->1,b@x->1,c@x->1)\n');
    assert.equal(again.stderr, '');
    const stored = decodeRepository(readFileSync(join(local, '.snap', 'repository.json'), 'utf8'));
    assert.equal(stored.patches.length, 3);
  });

  it('refuses a colliding dot before touching disk', async () => {
    const local = repository(repositoryJson([['a@x', 1]], [patch('a@x', 1, [], [createF])]));
    writeFileSync(join(local, 'f'), 'one\n');
    const remote = repository(
      repositoryJson(
        [['a@x', 1]],
        [patch('a@x', 1, [], [{ type: 'text', path: 'f', edit: [{ insert: ['two\n'] }] }])],
      ),
    );
    const before = readFileSync(join(local, '.snap', 'repository.json'), 'utf8');
    await assert.rejects(merge(remote, local), { message: 'patch collision: a@x revision 1' });
    assert.equal(readFileSync(join(local, '.snap', 'repository.json'), 'utf8'), before);
    assert.equal(readFileSync(join(local, 'f'), 'utf8'), 'one\n');
  });

  it('refuses a dirty working tree after the history checks, without writing', async () => {
    const local = repository(repositoryJson([['a@x', 1]], [patch('a@x', 1, [], [createF])]));
    writeFileSync(join(local, 'f'), 'changed\n');
    const remote = repository(EMPTY_REPOSITORY_JSON);
    const before = readFileSync(join(local, '.snap', 'repository.json'), 'utf8');
    await assert.rejects(merge(remote, local), { message: 'working tree is dirty' });
    assert.equal(readFileSync(join(local, '.snap', 'repository.json'), 'utf8'), before);
  });

  it('refuses an unsupported working-tree entry before the dirty check', async () => {
    const local = repository(EMPTY_REPOSITORY_JSON);
    symlinkSync('.', join(local, 'link'));
    const remote = repository(EMPTY_REPOSITORY_JSON);
    await assert.rejects(merge(remote, local), {
      message: 'unsupported working tree entry: link',
    });
  });

  it('refuses a local operand that is not a repository root', async () => {
    const local = repository(EMPTY_REPOSITORY_JSON);
    const outside = directory();
    await assert.rejects(merge(join(outside, 'missing'), local), {
      message: 'not a Snap repository',
    });
  });

  it('passes a malformed remote body and an HTTP failure through unchanged', async () => {
    const local = repository(EMPTY_REPOSITORY_JSON);
    await assert.rejects(merge(`${origin}/not-json`, local), /^SnapError: invalid JSON/);
    const refused = createServer((_request, response) => {
      response.writeHead(500);
      response.end();
    });
    await new Promise<void>((resolve) => {
      refused.listen(0, '127.0.0.1', () => {
        resolve();
      });
    });
    const address = refused.address();
    if (address === null || typeof address === 'string') {
      throw new Error('expected a TCP listener address');
    }
    try {
      await assert.rejects(
        merge(`http://127.0.0.1:${String(address.port)}/repository.json`, local),
        { message: 'HTTP 500' },
      );
    } finally {
      refused.close();
      refused.closeAllConnections();
    }
  });

  it('accepts an empty remote operand as a write-anyway no-op', async () => {
    const local = repository(repositoryJson([['a@x', 1]], [patch('a@x', 1, [], [createF])]));
    writeFileSync(join(local, 'f'), 'one\n');
    const before = readFileSync(join(local, '.snap', 'repository.json'), 'utf8');
    const remote = repository(EMPTY_REPOSITORY_JSON);
    const output = await merge(remote, local);
    // The union is the local repository itself; §7.8 still owes the write, so the metadata is
    // rewritten — the fixture's compact bytes give way to the canonical form of the same value.
    assert.equal(output.stdout, '(a@x->1)\n');
    assert.equal(output.stderr, '');
    assert.equal(
      readFileSync(join(local, '.snap', 'repository.json'), 'utf8'),
      encodeRepository(decodeRepository(before)),
    );
    assert.equal(readFileSync(join(local, 'f'), 'utf8'), 'one\n');
  });
});
