/**
 * The HTTP repository operand (SPEC §9): one exact GET, no redirects, full validation.
 *
 * `fetch` is banned here by design — it follows redirects, while §9 requires the exact URL's
 * status to decide everything — and `node:http`/`node:https` never redirect, so a 302 surfaces
 * as the plain `HTTP <status>` failure and the single-request guarantee holds structurally
 * (tests/13 counts the requests). The client is the complete trust boundary: what it resolves
 * has passed the same §4.5 validation as a local `loadValidatedRepository`, so future consumers
 * (`diff --repo`, `merge`) receive a repository they can trust without re-validating.
 */
import { get as httpGet } from 'node:http';
import { get as httpsGet } from 'node:https';

import { decodeUtf8, isText } from '../core/bytes.ts';
import { SnapError } from '../core/errors.ts';
import { type Repository, decodeRepository } from '../repo/model.ts';
import { validateRepository } from '../repo/validate.ts';

/**
 * Fetches and validates the repository at `url` with a single GET (SPEC §9).
 *
 * Throws `SnapError` — `HTTP <status>` for any non-200 response (a redirect included),
 * `HTTP request failed: <reason>` for a transport error, or the strict reader's and §4.5's
 * own messages for a body that is not a valid repository. `url` must name the exact resource:
 * `http://…/repository.json` as the startup URL prints it.
 */
export function fetchRepository(url: string): Promise<Repository> {
  return new Promise((resolve, reject) => {
    const get = url.startsWith('https://') ? httpsGet : httpGet;
    const call = get(url, (incoming) => {
      const status = incoming.statusCode ?? 0;
      if (status !== 200) {
        // Drain and discard: the response is already decided, but consuming it releases the
        // socket instead of leaving a half-read connection for the process to outlive.
        incoming.resume();
        reject(new SnapError(`HTTP ${String(status)}`));
        return;
      }
      const chunks: Buffer[] = [];
      incoming.on('data', (chunk: Buffer) => {
        chunks.push(chunk);
      });
      incoming.on('error', (error: Error) => {
        reject(transport(error));
      });
      incoming.on('end', () => {
        try {
          resolve(toRepository(Buffer.concat(chunks)));
        } catch (failure: unknown) {
          // toRepository fails only through SnapError; the narrowing keeps the rejection an
          // Error while passing the strict-reader and §4.5 messages through unchanged.
          reject(failure instanceof SnapError ? failure : transport(failure));
        }
      });
    });
    call.on('error', (error: Error) => {
      reject(transport(error));
    });
  });
}

/** The expected failure for anything that never produced a response: unreachable, reset, timed out. */
function transport(failure: unknown): SnapError {
  if (!(failure instanceof Error)) {
    return new SnapError(`HTTP request failed: ${String(failure)}`);
  }
  const reason = (failure as NodeJS.ErrnoException).code ?? failure.message;
  return new SnapError(`HTTP request failed: ${reason}`);
}

/**
 * The buffered body through the same pipeline a local repository takes: text check, strict
 * decode, §4.5 validation.
 *
 * RFC 8259 JSON is UTF-8, so a body that is not text is not JSON either — reported in the
 * reader's vocabulary so one error family covers every malformed-body case.
 */
function toRepository(body: Buffer): Repository {
  const bytes = new Uint8Array(body.buffer, body.byteOffset, body.byteLength);
  if (!isText(bytes)) {
    throw new SnapError('invalid JSON: body is not valid UTF-8 text');
  }
  const repository = decodeRepository(decodeUtf8(bytes));
  // Run for its §4.5 guarantee; the replay result it returns is the caller's to derive later,
  // not part of this boundary's contract.
  validateRepository(repository);
  return repository;
}
