/**
 * What one command produced, in domain terms rather than bytes.
 *
 * Commands stay pure — parsed arguments in, a result record out (design snap-ts-architecture) —
 * and the record carries semantics, not layout: the §7.11 renderers in `cli/presentation.ts`
 * turn it into plain or terminal text per stream. Keeping layout out of commands is what lets
 * presentation selection change appearance without touching execution (SPEC §7.11).
 */

/** One working-tree difference a `status` row reports: added, modified, or deleted. */
export type ChangeCode = 'A' | 'M' | 'D';

/** One `status` row: the change code and the path it applies to, verbatim. */
export interface StatusRow {
  readonly code: ChangeCode;
  readonly path: string;
}

/** One `log` entry: result version, author, and the §7.4-escaped one-line message. */
export interface LogEntry {
  readonly version: string;
  readonly author: string;
  readonly message: string;
}

/** The word §7.11's terminal success line prints for each state-changing command. */
export type SuccessLabel = 'Initialized repository' | 'Committed' | 'Reverted' | 'Merged';

/** What a command did; `cli/presentation.ts` owns how it is printed in each mode. */
export type CommandResult =
  | { kind: 'version'; semver: string }
  | { kind: 'config' }
  | { kind: 'success'; label: SuccessLabel; version: string }
  | { kind: 'status'; version: string; rows: readonly StatusRow[] }
  | { kind: 'log'; entries: readonly LogEntry[] }
  | { kind: 'diff'; text: string };

/** Rendered stream text: the only shape the CLI boundary ever writes. */
export interface CommandOutput {
  readonly stdout: string;
  readonly stderr: string;
}
