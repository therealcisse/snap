/**
 * Repository location and configuration (SPEC §7 preamble, §8).
 *
 * Everything that knows where Snap's files live is here: the layout constants, the
 * nearest-repository walk, loading `repository.json`, reading and writing configuration files,
 * and the §8 local-over-global contributor resolution. Callers pass directories and the
 * environment in, so the module needs no process and stays directly testable.
 */
import { readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import { SnapError } from '../core/errors.ts';
import { JsonCursor, parseJson } from '../core/json.ts';
import { type ContributorId, isValidContributorId } from '../core/version.ts';
import { type Repository, decodeRepository } from '../repo/model.ts';

/** The directory that marks a repository root and holds its metadata (SPEC §2). */
export const SNAP_DIRECTORY = '.snap';
const REPOSITORY_FILE = 'repository.json';
export const LOCAL_CONFIG_FILE = 'config.json';
export const GLOBAL_CONFIG_FILE = '.snapconfig.json';

/** The value of one configuration file. `contributorId` is `undefined` when the file names none. */
export interface Configuration {
  readonly contributorId: ContributorId | undefined;
}

/**
 * The nearest enclosing repository root, or `undefined` when `startDir` lies outside every
 * repository. A directory is a repository root when it contains a `.snap` directory (SPEC §7).
 */
export function nearestRepository(startDir: string): string | undefined {
  let directory = resolve(startDir);
  for (;;) {
    if (isDirectory(join(directory, SNAP_DIRECTORY))) {
      return directory;
    }
    const parent = dirname(directory);
    // `dirname` of a filesystem root is itself; that self-loop is the walk's stop condition.
    if (parent === directory) {
      return undefined;
    }
    directory = parent;
  }
}

/**
 * The nearest enclosing repository root; throws `SnapError` with `not a Snap repository` when
 * `startDir` lies outside every repository (SPEC §7).
 */
export function findRepositoryRoot(startDir: string): string {
  const root = nearestRepository(startDir);
  if (root === undefined) {
    throw new SnapError('not a Snap repository');
  }
  return root;
}

/**
 * Loads and validates the `repository.json` of the nearest repository.
 *
 * Throws `not a Snap repository` when there is no enclosing repository or the found root's
 * `repository.json` cannot be read, and the decoder's `SnapError` when the file is malformed.
 */
export function loadRepository(startDir: string): Repository {
  const root = findRepositoryRoot(startDir);
  let text: string;
  try {
    text = readFileSync(join(root, SNAP_DIRECTORY, REPOSITORY_FILE), 'utf8');
  } catch {
    // A `.snap` directory without a readable repository file is not a usable repository. Reported
    // as a location failure, keeping the vocabulary at two cases: outside one, or unreadable.
    throw new SnapError('not a Snap repository');
  }
  return decodeRepository(text);
}

/**
 * Resolves the effective contributor ID (SPEC §8): the `.snap/config.json` of `repositoryRoot`
 * first — a file that provides an ID stops the fallback — then `$HOME/.snapconfig.json`.
 *
 * A file that is missing means no value on its level; a file that is read and malformed, or
 * names an invalid ID, throws its decoder's `SnapError` on either level. An absent or empty
 * `$HOME` leaves global configuration unavailable rather than an error.
 */
export function resolveContributorId(
  repositoryRoot: string,
  env: Readonly<Record<string, string | undefined>>,
): ContributorId | undefined {
  const local = readConfigurationIfPresent(join(repositoryRoot, SNAP_DIRECTORY, LOCAL_CONFIG_FILE));
  if (local?.contributorId !== undefined) {
    return local.contributorId;
  }
  // An empty `$HOME` is treated as absent: joining against `''` would silently read a file in
  // the process's working directory instead of the user's home.
  const home = env['HOME'];
  if (home === undefined || home === '') {
    return undefined;
  }
  return readConfigurationIfPresent(join(home, GLOBAL_CONFIG_FILE))?.contributorId;
}

/**
 * The canonical text of a configuration file naming `id`: two-space indent, trailing LF.
 * `JSON.stringify` is the sanctioned string writer for output; a valid ID is visible ASCII, so
 * no escape sequence can appear.
 */
export function encodeConfiguration(id: ContributorId): string {
  return `{\n  "contributor": {\n    "id": ${JSON.stringify(id)}\n  }\n}\n`;
}

/** Reads and decodes a configuration file, or `undefined` when the file does not exist. */
function readConfigurationIfPresent(path: string): Configuration | undefined {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    return undefined;
  }
  return decodeConfiguration(text);
}

/**
 * Decodes the text of a configuration file (SPEC §8): `{"contributor":{"id":"<id>"}}`.
 *
 * Both `contributor` and `id` may be absent — SPEC §8 only says a file that "provides an ID" stops
 * the fallback to global configuration — but no other field may be present, and a present `id`
 * must be a valid contributor ID. Throws `SnapError` with `invalid JSON: …`,
 * `duplicate JSON key …`, `configuration… has unknown field: …`, or `invalid contributor id: <id>`.
 */
export function decodeConfiguration(text: string): Configuration {
  const root = new JsonCursor(parseJson(text, 'configuration'), 'configuration').object();
  const contributor = root.optionalField('contributor');
  root.finishObject();
  if (contributor === undefined) {
    return { contributorId: undefined };
  }
  contributor.object();
  const id = contributor.optionalField('id')?.string();
  contributor.finishObject();
  if (id !== undefined && !isValidContributorId(id)) {
    throw new SnapError(`invalid contributor id: ${id}`);
  }
  return { contributorId: id };
}

/** `true` when `path` exists and is a directory; anything else, including an I/O error, is `false`. */
function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}
