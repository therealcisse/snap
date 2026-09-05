/**
 * The §7 command grammar.
 *
 * Every command Snap will ever have is parsed here from day one, so usage errors are final even
 * while command bodies are still `not implemented`. The grammar is positional and strict: options
 * occur exactly in the positions §7 shows, at most once, and anything unexpected — an unknown
 * command or option, an extra operand, a missing option value — is one uniform error. The diff
 * family is the single exception: it fails with its own usage line so the error can teach diff's
 * two-operand shape (tests/14).
 */
import { SnapError } from '../core/errors.ts';

/** One parsed invocation; the `kind` tag names the command word (or, for the flags, the flag). */
export type Command =
  | { readonly kind: 'init'; readonly path: string }
  | { readonly kind: 'config'; readonly global: boolean; readonly id: string }
  | { readonly kind: 'status' }
  | { readonly kind: 'log' }
  | { readonly kind: 'commit'; readonly message: string }
  | {
      readonly kind: 'diff';
      readonly oldVersion: string;
      readonly newVersion: string;
      readonly repo: string | undefined;
    }
  | { readonly kind: 'revert'; readonly version: string }
  | { readonly kind: 'merge'; readonly repository: string }
  | { readonly kind: 'serve'; readonly port: number }
  | { readonly kind: 'showVersion' };

const INVALID = 'invalid command or arguments';
const DIFF_USAGE = 'usage: snap diff <old> <new> [--repo <repository>]';
const DEFAULT_PORT = 8765;
const MAX_PORT = 65535;

/**
 * Parses one invocation per §7. Throws `SnapError` with the uniform usage error — or diff's usage
 * line for the diff family, `invalid port: <text>` for a bad port operand — on any mismatch.
 */
export function parseArgs(argv: readonly string[]): Command {
  const [first = '', ...rest] = argv;
  switch (first) {
    case '--version':
      // §7.10: `--version` is a complete invocation; it shares with no command or operand.
      return rest.length === 0 ? { kind: 'showVersion' } : invalid();
    case '--serve':
      return { kind: 'serve', port: rest.length === 0 ? DEFAULT_PORT : servePort(rest) };
    case 'init': {
      expectCount(rest, 0, 1, INVALID);
      const path = rest[0];
      // §7.1 shows `[path]` as a plain operand, so an option-shaped token is a usage error.
      if (path?.startsWith('-')) {
        invalid();
      }
      return { kind: 'init', path: path ?? '.' };
    }
    case 'config':
      return parseConfig(rest);
    case 'status':
    case 'log':
      return rest.length === 0 ? { kind: first } : invalid();
    case 'commit': {
      expectCount(rest, 1, 1, INVALID);
      // The message is data, not grammar: §7.5 shows no options, so the operand is taken verbatim.
      return { kind: 'commit', message: rest[0] ?? invalid() };
    }
    case 'diff':
      return parseDiff(rest);
    case 'revert': {
      expectCount(rest, 1, 1, INVALID);
      return { kind: 'revert', version: rest[0] ?? invalid() };
    }
    case 'merge': {
      expectCount(rest, 1, 1, INVALID);
      return { kind: 'merge', repository: rest[0] ?? invalid() };
    }
    default:
      return invalid();
  }
}

/** `config [--global] contributor.id <id>`: `--global`, when present, must lead (§7.2). */
function parseConfig(rest: readonly string[]): Command {
  let tokens = rest;
  let global = false;
  if (tokens[0] === '--global') {
    global = true;
    tokens = tokens.slice(1);
  }
  // §7.2 admits no other option position, so a repeated `--global` or any trailing option fails
  // the exact two-token shape below, as does a repeated subcommand such as `config config …`.
  if (tokens.length !== 2 || tokens[0] !== 'contributor.id') {
    invalid();
  }
  return { kind: 'config', global, id: tokens[1] ?? invalid() };
}

/** `diff <old> <new> [--repo <repository>]`: the one command with its own usage error (§7.6). */
function parseDiff(rest: readonly string[]): Command {
  const [oldVersion, newVersion, ...tail] = rest;
  if (oldVersion === undefined || newVersion === undefined) {
    throw new SnapError(DIFF_USAGE);
  }
  let repo: string | undefined;
  if (tail.length === 2 && tail[0] === '--repo') {
    repo = tail[1];
  } else if (tail.length !== 0) {
    // Extra operands, a missing `--repo` value, or a repeated `--repo`: all teach the shape.
    throw new SnapError(DIFF_USAGE);
  }
  return { kind: 'diff', oldVersion, newVersion, repo };
}

/** `--serve [port]`: one optional operand, all digits and at most 65535 (§7.9). */
function servePort(rest: readonly string[]): number {
  expectCount(rest, 1, 1, INVALID);
  const text = rest[0] ?? invalid();
  if (!/^[0-9]+$/.test(text) || Number(text) > MAX_PORT) {
    throw new SnapError(`invalid port: ${text}`);
  }
  return Number(text);
}

/** Throws `detail` unless `operands.length` lies in `[min, max]`. */
function expectCount(operands: readonly string[], min: number, max: number, detail: string): void {
  if (operands.length < min || operands.length > max) {
    throw new SnapError(detail);
  }
}

/** The uniform §7 usage failure. */
function invalid(): never {
  throw new SnapError(INVALID);
}
