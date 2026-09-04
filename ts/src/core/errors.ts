/**
 * Failure model for the CLI (SPEC §10).
 *
 * Snap distinguishes exactly two kinds of failure:
 *
 * - An *expected* failure is a condition the spec names — an invalid repository, a bad argument,
 *   a working-tree scan problem. It is reported as one `snap: <detail>` line and exit status 1.
 *   Every module signals it by throwing `SnapError` with the spec's exact detail text.
 * - Anything else that escapes to the CLI boundary is a *defect* in this implementation. It is
 *   reported as `snap: internal error: <detail>` with exit status 2 so that the acceptance suite,
 *   which only ever expects status 0 or 1, can never mistake a crash for spec-conforming behavior.
 *
 * Only `describeFailure` turns a thrown value into bytes; no other module formats error output.
 */

/** An expected failure: reported as one `snap: <detail>` line and exit status 1 (SPEC §10). */
export class SnapError extends Error {
  constructor(detail: string) {
    super(detail);
    this.name = 'SnapError';
  }
}

/** What the CLI writes and returns for a failure that reached its boundary. */
export interface Failure {
  /** 1 for an expected `SnapError`; 2 for any other thrown value (a defect). */
  readonly exitCode: 1 | 2;
  /** Complete plain-mode stderr line including the trailing LF. */
  readonly line: string;
}

/** The single formatting point for every failure the CLI reports. */
export function describeFailure(failure: unknown): Failure {
  if (failure instanceof SnapError) {
    return { exitCode: 1, line: `snap: ${failure.message}\n` };
  }
  const detail = failure instanceof Error ? failure.message : String(failure);
  return { exitCode: 2, line: `snap: internal error: ${detail}\n` };
}
