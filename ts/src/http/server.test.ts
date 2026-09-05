import assert from 'node:assert/strict';
import { type IncomingHttpHeaders, type Server, request } from 'node:http';
import { after, before, describe, it } from 'node:test';

import { encodeUtf8 } from '../core/bytes.ts';
import { EMPTY_REPOSITORY_JSON } from '../repo/model.ts';

import { createSnapshotServer } from './server.ts';

/** One full response: the parts the wire contract pins (SPEC §9). */
interface Reply {
  readonly status: number;
  readonly headers: IncomingHttpHeaders;
  readonly body: Buffer;
}

describe('createSnapshotServer', () => {
  const body = encodeUtf8(EMPTY_REPOSITORY_JSON);
  let server: Server;
  let port = 0;

  function ask(method: string, target: string): Promise<Reply> {
    return new Promise((resolve, reject) => {
      // A one-shot agent per request (`agent: false`): nothing pools sockets, so `after` can
      // close the server without lingering keep-alive connections holding the test process open.
      const call = request(
        { agent: false, host: '127.0.0.1', method, path: target, port },
        (incoming) => {
          const chunks: Buffer[] = [];
          incoming.on('data', (chunk: Buffer) => chunks.push(chunk));
          incoming.on('end', () => {
            resolve({
              status: incoming.statusCode ?? 0,
              headers: incoming.headers,
              body: Buffer.concat(chunks),
            });
          });
        },
      );
      call.on('error', reject);
      call.end();
    });
  }

  before(async () => {
    server = createSnapshotServer(body);
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
    port = address.port;
  });

  after(() => {
    server.close();
    server.closeAllConnections();
  });

  it('serves GET /repository.json with the snapshot bytes and exact headers', async () => {
    const reply = await ask('GET', '/repository.json');
    assert.equal(reply.status, 200);
    assert.equal(reply.headers['content-type'], 'application/json; charset=utf-8');
    assert.equal(reply.headers['content-length'], String(body.byteLength));
    assert.deepEqual(reply.body, Buffer.from(body));
  });

  it('answers HEAD with the same status and headers and no body', async () => {
    const reply = await ask('HEAD', '/repository.json');
    assert.equal(reply.status, 200);
    assert.equal(reply.headers['content-type'], 'application/json; charset=utf-8');
    assert.equal(reply.body.byteLength, 0);
  });

  it('rejects other methods on the exact target with 405 and Allow', async () => {
    const reply = await ask('POST', '/repository.json');
    assert.equal(reply.status, 405);
    assert.equal(reply.headers.allow, 'GET, HEAD');
  });

  it('returns 404 for any other path', async () => {
    const reply = await ask('GET', '/other');
    assert.equal(reply.status, 404);
  });

  it('returns 404 for the fixed path with a query string', async () => {
    const reply = await ask('GET', '/repository.json?x=1');
    assert.equal(reply.status, 404);
  });

  it('classifies by target before method: PUT to another path is 404, not 405', async () => {
    const reply = await ask('PUT', '/other');
    assert.equal(reply.status, 404);
  });
});
