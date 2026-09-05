import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { after, before, describe, it } from 'node:test';

import { EMPTY_REPOSITORY_JSON } from '../repo/model.ts';

import { fetchRepository } from './client.ts';

/**
 * A canned origin standing in for a remote Snap: fixed routes, and a per-target hit count so
 * the tests can pin the single-request guarantee §9 and tests/13 care about.
 */
describe('fetchRepository', () => {
  const hits = new Map<string, number>();
  let server: Server;
  let origin = '';

  before(async () => {
    server = createServer((request, response) => {
      const target = request.url ?? '/';
      hits.set(target, (hits.get(target) ?? 0) + 1);
      switch (target) {
        case '/good':
          response.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
          response.end(EMPTY_REPOSITORY_JSON);
          break;
        case '/redirect':
          // The bait: a correct repository one hop away, reachable only if the client follows.
          response.writeHead(302, { location: '/good' });
          response.end();
          break;
        case '/not-json':
          response.writeHead(200, { 'content-type': 'text/plain' });
          response.end('not-json');
          break;
        case '/binary':
          response.writeHead(200, { 'content-type': 'application/octet-stream' });
          response.end(Buffer.from([0xff]));
          break;
        default:
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

  it('returns the validated repository for a 200 response', async () => {
    const repository = await fetchRepository(`${origin}/good`);
    assert.equal(repository.format, 1);
    assert.equal(repository.patches.length, 0);
    assert.equal(hits.get('/good'), 1);
  });

  it('fails any non-200 status with HTTP <status>', async () => {
    await assert.rejects(fetchRepository(`${origin}/error`), /^SnapError: HTTP 500$/);
    assert.equal(hits.get('/error'), 1);
  });

  it('fails a redirect with HTTP 302 and never follows it', async () => {
    const goodHitsBefore = hits.get('/good') ?? 0;
    await assert.rejects(fetchRepository(`${origin}/redirect`), /^SnapError: HTTP 302$/);
    assert.equal(hits.get('/redirect'), 1);
    assert.equal(hits.get('/good') ?? 0, goodHitsBefore);
  });

  it('fails a non-JSON body with the strict reader invalid JSON message', async () => {
    await assert.rejects(fetchRepository(`${origin}/not-json`), /invalid JSON/);
    assert.equal(hits.get('/not-json'), 1);
  });

  it('fails a non-UTF-8 body as invalid JSON', async () => {
    await assert.rejects(
      fetchRepository(`${origin}/binary`),
      /invalid JSON: body is not valid UTF-8 text/,
    );
    assert.equal(hits.get('/binary'), 1);
  });

  it('fails a refused connection as an expected transport failure', async () => {
    // Reserve a port, then free it: nothing listens there anymore.
    const closed = createServer();
    await new Promise<void>((resolve) => {
      closed.listen(0, '127.0.0.1', () => {
        resolve();
      });
    });
    const address = closed.address();
    if (address === null || typeof address === 'string') {
      throw new Error('expected a TCP listener address');
    }
    const { port } = address;
    await new Promise<void>((resolve) => {
      closed.close(() => {
        resolve();
      });
    });
    await assert.rejects(
      fetchRepository(`http://127.0.0.1:${String(port)}/`),
      /HTTP request failed/,
    );
  });
});
