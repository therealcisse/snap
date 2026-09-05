/**
 * `snap --serve [port]` (SPEC §7.9): validate and snapshot once, then serve until signaled.
 *
 * The one impure command — long-running, async, printing mid-flight — which design
 * `snap-ts-architecture` decisions 9–10 sanction. Instead of a `CommandOutput` it takes the
 * CLI's stdout sink, prints the startup URL the moment the OS confirms the port, and resolves
 * with the exit status when SIGINT or SIGTERM arrives. Everything before `listen` (walking to
 * the repository, decoding, §4.5 validation) runs synchronously, so a corrupt repository fails
 * before the process ever becomes a server (tests/12's final case).
 */
import { type Server } from 'node:http';

import { encodeUtf8 } from '../core/bytes.ts';
import { SnapError } from '../core/errors.ts';
import { loadValidatedRepository } from '../fs/locate.ts';
import { createSnapshotServer } from '../http/server.ts';
import { encodeRepository } from '../repo/model.ts';

/** SPEC §7.9: the server binds the loopback only; nothing else is reachable. */
const HOST = '127.0.0.1';

/** The one fixed resource (SPEC §9); the URL is the address plus exactly this path. */
const RESOURCE = '/repository.json';

/**
 * Serves the repository at `cwd`'s startup snapshot on `HOST:port` until SIGINT/SIGTERM.
 *
 * `print` receives the one-line startup URL — plain bytes through the CLI's flushed write point
 * (SPEC §7.9, §7.11) — with the actual port when `port` was `0`. Resolves 0 on a signal; rejects
 * `SnapError` (`not a Snap repository`, decode/§4.5 failures, `cannot listen on port <port>:
 * <code>`) before or at listen time.
 */
export function serve(port: number, cwd: string, print: (line: string) => void): Promise<number> {
  // Startup order is the spec's: validate, then snapshot. The served bytes are the canonical
  // encoding of the validated value, computed once and never re-read (SPEC §7.9), which is what
  // makes later commits invisible to a running server. `loadValidatedRepository` walks, decodes,
  // and §4.5-validates synchronously, before the process ever becomes a server.
  const { repository } = loadValidatedRepository(cwd);
  const snapshot = encodeUtf8(encodeRepository(repository));
  const server = createSnapshotServer(snapshot);
  return new Promise<number>((resolve, reject) => {
    server.once('error', (error: NodeJS.ErrnoException) => {
      reject(
        new SnapError(`cannot listen on port ${String(port)}: ${error.code ?? error.message}`),
      );
    });
    server.listen(port, HOST, () => {
      const address = server.address();
      if (address === null || typeof address === 'string') {
        // Unreachable for a TCP listener that just emitted 'listening'; stated for the checker.
        reject(new SnapError(`cannot listen on port ${String(port)}`));
        return;
      }
      print(`http://${HOST}:${String(address.port)}${RESOURCE}\n`);
      stopOnSignal(server, resolve);
    });
  });
}

/**
 * Resolves 0 on the first SIGINT/SIGTERM and tears the server down (SPEC §7.9: serve until a
 * signal, then exit 0).
 *
 * `close()` alone would wait out keep-alive sockets — the harness's client keeps them — so the
 * teardown also drops idle and open connections; every response worth inspecting has already
 * been written and flushed by then. Resolving (rather than awaiting `close`'s callback) lets
 * `run` return, and the process exits 0 when the emptied event loop ends it.
 */
function stopOnSignal(server: Server, done: (code: number) => void): void {
  let stopping = false;
  const stop = (): void => {
    if (stopping) {
      return;
    }
    stopping = true;
    server.close();
    server.closeIdleConnections();
    server.closeAllConnections();
    done(0);
  };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
}
