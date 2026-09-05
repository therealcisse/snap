/**
 * `snap init [path]` (SPEC §7.1): create an empty repository at `path` and print its version.
 *
 * Both refusals precede any mutation: re-initializing a repository and initializing inside an
 * existing one must leave the filesystem untouched (tests/01, tests/02).
 */
import { mkdirSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { SnapError } from '../core/errors.ts';
import { SNAP_DIRECTORY, nearestRepository } from '../fs/locate.ts';
import { EMPTY_REPOSITORY_JSON } from '../repo/model.ts';

import type { CommandOutput } from './output.ts';

const REPOSITORY_FILE = 'repository.json';

/**
 * Creates an empty repository at `path` (resolved against `cwd`, created with any missing
 * parents when absent) and returns the `()` output.
 *
 * Throws `SnapError` — `repository already exists` or `cannot initialize inside repository` —
 * before writing anything.
 */
export function init(path: string, cwd: string): CommandOutput {
  const target = resolve(cwd, path);
  const snapDirectory = join(target, SNAP_DIRECTORY);
  if (isDirectory(snapDirectory)) {
    throw new SnapError('repository already exists');
  }
  // The walk starts at the target, but the check above already handled a `.snap` there, so any
  // hit is a proper ancestor: the inside-repository case (tests/02).
  if (nearestRepository(target) !== undefined) {
    throw new SnapError('cannot initialize inside repository');
  }
  // `recursive` creates the target and any missing parents together with `.snap` (SPEC §7.1).
  mkdirSync(snapDirectory, { recursive: true });
  writeFileSync(join(snapDirectory, REPOSITORY_FILE), EMPTY_REPOSITORY_JSON);
  return { stdout: '()\n', stderr: '' };
}

/** `true` when `path` exists and is a directory; anything else, including an I/O error, is `false`. */
function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}
