/**
 * `snap --version` (SPEC §7.10): report the version without locating a repository.
 */
import type { CommandOutput } from './output.ts';

/** The version this build reports. SPEC §12 fixes the product as Snap v1, so this is `1.0.0`. */
export const SEMVER = '1.0.0';

/** Returns the one-line version output. */
export function showVersion(): CommandOutput {
  return { stdout: `snap ${SEMVER}\n`, stderr: '' };
}
