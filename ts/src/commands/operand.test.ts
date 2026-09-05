import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';

import { EMPTY_REPOSITORY_JSON } from '../repo/model.ts';

import { loadRepositoryOperand } from './operand.ts';

/** A fresh temporary directory that no test has made a repository. */
function directory(): string {
  return mkdtempSync(join(tmpdir(), 'snap-operand-'));
}

/** A repository root containing `.snap/repository.json` with the canonical empty bytes. */
function repository(): string {
  const root = directory();
  mkdirSync(join(root, '.snap'), { recursive: true });
  writeFileSync(join(root, '.snap', 'repository.json'), EMPTY_REPOSITORY_JSON);
  return root;
}

describe('loadRepositoryOperand (SPEC §7.8, §9)', () => {
  let server: Server;
  let origin = '';

  before(async () => {
    server = createServer((request, response) => {
      if (request.url === '/repository.json') {
        response.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
        response.end(EMPTY_REPOSITORY_JSON);
      } else {
        response.writeHead(500);
        response.end();
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

  it('resolves a relative local path against cwd to that repository root', async () => {
    // The repository lives at cwd/remote; the operand names it relative to cwd, and resolution
    // is pure path arithmetic — the operand target, not cwd, is what must exist.
    const cwd = directory();
    mkdirSync(join(cwd, 'remote', '.snap'), { recursive: true });
    writeFileSync(join(cwd, 'remote', '.snap', 'repository.json'), EMPTY_REPOSITORY_JSON);
    const repositoryValue = await loadRepositoryOperand('remote', cwd);
    assert.deepEqual(repositoryValue, { format: 1, frontier: [], patches: [] });
  });

  it('requires a local operand to be a root: a subtree of a repository is not one', async () => {
    const root = repository();
    mkdirSync(join(root, 'sub'));
    await assert.rejects(loadRepositoryOperand('sub', root), {
      message: 'not a Snap repository',
    });
  });

  it('passes a malformed local repository through the strict reader', async () => {
    const root = repository();
    writeFileSync(join(root, '.snap', 'repository.json'), 'not json');
    await assert.rejects(loadRepositoryOperand('.', root), /^SnapError: invalid JSON/);
  });

  it('fetches an http:// operand through the §9 client', async () => {
    const repositoryValue = await loadRepositoryOperand(`${origin}/repository.json`, directory());
    assert.deepEqual(repositoryValue, { format: 1, frontier: [], patches: [] });
  });

  it('passes an HTTP failure through unchanged', async () => {
    await assert.rejects(loadRepositoryOperand(`${origin}/missing`, directory()), {
      message: 'HTTP 500',
    });
  });
});
