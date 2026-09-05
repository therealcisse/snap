/**
 * The `snap --serve` HTTP surface (SPEC §7.9, §9): one fixed resource over a captured snapshot.
 *
 * The handler is stateless over the snapshot bytes it closes over — nothing re-reads disk or
 * re-encodes — so §7.9's immutability ("serves the startup snapshot") holds by construction:
 * later repository changes cannot reach a response. Classification is by exact target (SPEC §9):
 * `GET`/`HEAD` of exactly `/repository.json` is the resource; any other target — another path,
 * or the fixed path with a query string — is `404` regardless of method, and other methods on
 * the exact target are `405` with the required `Allow`.
 */
import { type Server, createServer } from 'node:http';

/** The one fixed resource this server exposes (SPEC §9). */
const TARGET = '/repository.json';

const CONTENT_TYPE = 'application/json; charset=utf-8';

/**
 * A server that answers `GET`/`HEAD /repository.json` with `body` and nothing else.
 *
 * The caller owns listening, the startup URL, and shutdown; this module owns only the wire
 * behavior, so tests exercise it in-process with no process or signal machinery.
 */
export function createSnapshotServer(body: Uint8Array): Server {
  return createServer((request, response) => {
    if (request.url !== TARGET) {
      response.statusCode = 404;
      response.end();
      return;
    }
    // `method` is `string | undefined` on the wire; `undefined` can only be a malformed
    // request line, which this server answers with the method-classified 405 like any other
    // non-GET/HEAD token rather than crash on it.
    const method = request.method ?? '';
    if (method !== 'GET' && method !== 'HEAD') {
      response.statusCode = 405;
      response.setHeader('Allow', 'GET, HEAD');
      response.end();
      return;
    }
    response.setHeader('Content-Type', CONTENT_TYPE);
    // Fixed bytes, so `Content-Length` framing (not chunked); HEAD reports the size of the
    // body it omits, which is what "the same headers without a body" asks of it (SPEC §9).
    response.setHeader('Content-Length', body.byteLength);
    response.end(method === 'GET' ? body : undefined);
  });
}
