/**
 * §7.11 presentation selection and both renderers.
 *
 * Commands produce `CommandResult`s — semantics, never bytes — and this module decides what an
 * invocation looks like: `resolveModes` picks each stream's presentation from the environment,
 * then `render` and `renderErrorLine` turn one result into plain or terminal text. Plain is the
 * byte-stable contract the suites pin; terminal adds the §7.11 symbols and SGR color over the
 * same semantics, so selection changes appearance only — never execution, stream routing,
 * warning order, or exit status.
 */
import { SnapError } from '../core/errors.ts';

import type {
  ChangeCode,
  CommandOutput,
  CommandResult,
  LogEntry,
  StatusRow,
} from '../commands/output.ts';

/** One of the two §7.11 presentations. */
export type Presentation = 'plain' | 'terminal';

/** The presentation each standard stream uses for this invocation. */
export interface StreamModes {
  readonly stdout: Presentation;
  readonly stderr: Presentation;
}

/**
 * Resolves per-stream presentation (SPEC §7.11).
 *
 * `SNAP_COLOR=always` selects terminal mode on both streams even when they are redirected and
 * overrides `NO_COLOR`; `never` selects plain on both. Unset or `auto` follows each stream's own
 * TTY status unless `NO_COLOR` is present — with any value, empty included. Any other value
 * throws `SnapError` with `SNAP_COLOR must be auto, always, or never`.
 */
export function resolveModes(
  env: Readonly<Record<string, string | undefined>>,
  isStdoutTty: boolean,
  isStderrTty: boolean,
): StreamModes {
  const snapColor = env['SNAP_COLOR'];
  if (snapColor === 'always') {
    return { stdout: 'terminal', stderr: 'terminal' };
  }
  if (snapColor === 'never') {
    return { stdout: 'plain', stderr: 'plain' };
  }
  if (snapColor !== undefined && snapColor !== 'auto') {
    throw new SnapError('SNAP_COLOR must be auto, always, or never');
  }
  if (env['NO_COLOR'] !== undefined) {
    return { stdout: 'plain', stderr: 'plain' };
  }
  return {
    stdout: isStdoutTty ? 'terminal' : 'plain',
    stderr: isStderrTty ? 'terminal' : 'plain',
  };
}

/**
 * Renders one result into stream text, each stream by its own mode; warning details go to
 * stderr (merge is their only future producer, §7.8). Empty warnings render to empty stderr
 * in both modes.
 */
export function render(
  result: CommandResult,
  modes: StreamModes,
  warnings: readonly string[] = [],
): CommandOutput {
  return {
    stdout: modes.stdout === 'terminal' ? terminalStdout(result) : plainStdout(result),
    stderr: warnings.map((detail) => renderWarning(detail, modes.stderr)).join(''),
  };
}

/**
 * Renders the one-line failure from `describeFailure` for `mode`. Plain is the line unchanged;
 * terminal wraps `✗ ` plus the complete plain line — `snap:` prefix included, because §7.11
 * styles "a plain error line `<error>`" and the prefix is part of the line — in red.
 */
export function renderErrorLine(line: string, mode: Presentation): string {
  if (mode === 'plain') {
    return line;
  }
  const text = line.endsWith('\n') ? line.slice(0, -1) : line;
  return `${sgr(31, `✗ ${text}`)}\n`;
}

/** ANSI SGR: `ESC[<n>m`, text, `ESC[0m` — the S(n, text) of SPEC §7.11. */
function sgr(code: number, text: string): string {
  return `\u001b[${String(code)}m${text}\u001b[0m`;
}

/** The byte-stable plain layouts: exactly the bytes §§6.4, 7.1–7.10, and 10 pin. */
function plainStdout(result: CommandResult): string {
  switch (result.kind) {
    case 'version':
      return `snap ${result.semver}\n`;
    case 'config':
      return '';
    case 'success':
      return `${result.version}\n`;
    case 'status':
      return `version ${result.version}\n${result.rows
        .map((row) => `${row.code} ${row.path}\n`)
        .join('')}`;
    case 'log':
      return result.entries
        .map((entry) => `${entry.version}\t${entry.author}\t${entry.message}\n`)
        .join('');
    case 'diff':
      return result.text;
  }
}

/** §7.11's terminal layouts: symbols, labels, and SGR color over the same semantics. */
function terminalStdout(result: CommandResult): string {
  switch (result.kind) {
    case 'version':
      return `${sgr(1, `snap ${result.semver}`)}\n`;
    case 'config':
      return '';
    case 'success':
      return `${sgr(32, '✓')} ${sgr(1, result.label)} ${sgr(36, result.version)}\n`;
    case 'status':
      return renderStatusTerminal(result.version, result.rows);
    case 'log':
      return result.entries.map(renderEntryTerminal).join('\n');
    case 'diff':
      return colorizeDiff(result.text);
  }
}

/** §7.11's per-code row styling. The deleted symbol is U+2212 minus, not hyphen-minus. */
const ROW_STYLES: Record<ChangeCode, { code: number; symbol: string; label: string }> = {
  A: { code: 32, symbol: '+', label: 'added' },
  D: { code: 31, symbol: '−', label: 'deleted' },
  M: { code: 33, symbol: '~', label: 'modified' },
};

function renderStatusTerminal(version: string, rows: readonly StatusRow[]): string {
  const header = `${sgr(1, 'Snap status')}  ${sgr(36, version)}\n\n`;
  if (rows.length === 0) {
    return `${header}  ${sgr(32, '✓')} Working tree clean\n`;
  }
  return `${header}${rows
    .map((row) => {
      const style = ROW_STYLES[row.code];
      return `  ${sgr(style.code, style.symbol)} ${row.path} ${sgr(2, `(${style.label})`)}\n`;
    })
    .join('')}`;
}

function renderEntryTerminal(entry: LogEntry): string {
  return (
    `${sgr(36, '●')} ${sgr(1, entry.message)}\n` +
    `  ${sgr(36, entry.version)} ${sgr(2, 'by')} ${sgr(35, entry.author)}\n`
  );
}

/** §7.11's first-applicable diff prefix classes, in the spec's order. */
const DIFF_LINE_STYLES: readonly (readonly [string, number])[] = [
  ['--- ', 1],
  ['+++ ', 1],
  ['@@ ', 36],
  ['-', 31],
  ['+', 32],
  ['\\ ', 2],
  ['Binary files ', 33],
];

/**
 * §7.11's diff coloring: every plain byte survives; a line's text (LF excluded) is wrapped by
 * the first prefix it matches. Context lines start with a space and match nothing, so they —
 * and any unrecognized line — pass through unchanged. An empty diff stays empty, and a final
 * line without LF keeps its missing LF.
 */
function colorizeDiff(text: string): string {
  return text
    .split('\n')
    .map((line) => colorizeLine(line))
    .join('\n');
}

function colorizeLine(line: string): string {
  for (const [prefix, code] of DIFF_LINE_STYLES) {
    if (line.startsWith(prefix)) {
      return sgr(code, line);
    }
  }
  return line;
}

/** §7.11's warning line: `warning: <detail>` in plain, yellow ⚠ plus detail in terminal. */
function renderWarning(detail: string, mode: Presentation): string {
  return mode === 'terminal' ? `${sgr(33, '⚠')} ${sgr(33, detail)}\n` : `warning: ${detail}\n`;
}
