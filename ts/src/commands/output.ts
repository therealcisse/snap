/**
 * What one command produced: text for the two standard streams and nothing else.
 *
 * Commands stay pure — parsed arguments in, this record out (design snap-ts-architecture) — so
 * the CLI boundary in `cli/main.ts` is the only place that writes.
 */
export interface CommandOutput {
  readonly stdout: string;
  readonly stderr: string;
}
