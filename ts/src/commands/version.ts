/**
 * `snap --version` (SPEC §7.10): report the version without locating a repository.
 */
import type { CommandResult } from './output.ts';

/** The version this build reports. SPEC §12 fixes the product as Snap v1, so this is `1.0.0`. */
export const SEMVER = '1.0.0';

/** Returns the version result; the presentation layer formats each mode's one line. */
export function showVersion(): CommandResult {
  return { kind: 'version', semver: SEMVER };
}
