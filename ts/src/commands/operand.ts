/**
 * The repository operand of the cross-repository commands (SPEC §7.8, §9).
 *
 * `merge` takes one operand — a local path to a repository root or an exact
 * `http(s)://…/repository.json` URL. This module is the single place that classifies and
 * resolves it, so every command that names another repository reads the same rule instead of
 * each growing its own.
 */
import { resolve } from 'node:path';

import { loadRepositoryAtRoot } from '../fs/locate.ts';
import { fetchRepository } from '../http/client.ts';
import { type Repository } from '../repo/model.ts';

/**
 * Resolves `operand` against `cwd` into a repository that has passed §4.5 validation.
 *
 * A `http://` or `https://` prefix takes the §9 client; every other operand is a local path,
 * resolved against `cwd` and required to be a repository root itself — no nearest-walk,
 * because the remote side is addressed, not discovered. Throws the loader's or client's
 * `SnapError` unchanged, so callers report one error family per cause.
 */
export async function loadRepositoryOperand(operand: string, cwd: string): Promise<Repository> {
  if (operand.startsWith('http://') || operand.startsWith('https://')) {
    return fetchRepository(operand);
  }
  // The `async` body turns the loader's synchronous throw into a rejected promise, so the
  // local and URL arms reject alike instead of one throwing before a caller's `await` exists.
  return loadRepositoryAtRoot(resolve(cwd, operand)).repository;
}
