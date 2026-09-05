/**
 * `snap config [--global] contributor.id <id>` (SPEC §7.2, §8): set the contributor ID in the
 * nearest repository's configuration, or globally under `$HOME`.
 *
 * The write is the full canonical shape, so unknown fields cannot survive it, and success is
 * silent (tests/03).
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { SnapError } from '../core/errors.ts';
import { isValidContributorId } from '../core/version.ts';
import {
  GLOBAL_CONFIG_FILE,
  LOCAL_CONFIG_FILE,
  SNAP_DIRECTORY,
  encodeConfiguration,
  findRepositoryRoot,
} from '../fs/locate.ts';

import type { CommandOutput } from './output.ts';

/** Where `config` writes: the nearest repository under `cwd`, or the global file under `home`. */
export interface ConfigScope {
  readonly global: boolean;
  readonly cwd: string;
  readonly home: string | undefined;
}

/**
 * Validates `id` and writes it as the contributor ID.
 *
 * Throws `SnapError`: `invalid contributor id: <id>` before anything is written; `not a Snap
 * repository` for a local write outside any repository; `HOME is not set` for a global write
 * without a usable `$HOME`.
 */
export function setContributorId(id: string, scope: ConfigScope): CommandOutput {
  if (!isValidContributorId(id)) {
    throw new SnapError(`invalid contributor id: ${id}`);
  }
  let file: string;
  if (scope.global) {
    // An empty `$HOME` is treated as absent: joining against `''` would write into the
    // process's working directory instead of the user's home.
    if (scope.home === undefined || scope.home === '') {
      throw new SnapError('HOME is not set');
    }
    file = join(scope.home, GLOBAL_CONFIG_FILE);
  } else {
    file = join(findRepositoryRoot(scope.cwd), SNAP_DIRECTORY, LOCAL_CONFIG_FILE);
  }
  writeFileSync(file, encodeConfiguration(id));
  return { stdout: '', stderr: '' };
}
