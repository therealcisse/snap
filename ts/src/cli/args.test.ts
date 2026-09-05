import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { type Command, parseArgs } from './args.ts';

/** Asserts `argv` parses to exactly `command`. */
function expectCommand(argv: readonly string[], command: Command): void {
  assert.deepEqual(parseArgs([...argv]), command);
}

/** Asserts `parseArgs` rejects `argv` with the exact `message`. */
function expectError(argv: readonly string[], message: string): void {
  assert.throws(() => parseArgs([...argv]), { message });
}

const INVALID = 'invalid command or arguments';
const DIFF_USAGE = 'usage: snap diff <old> <new> [--repo <repository>]';

describe('parseArgs: accepted invocations', () => {
  it('parses the flag commands', () => {
    expectCommand(['--version'], { kind: 'showVersion' });
    expectCommand(['--serve'], { kind: 'serve', port: 8765 });
    expectCommand(['--serve', '0'], { kind: 'serve', port: 0 });
    expectCommand(['--serve', '8765'], { kind: 'serve', port: 8765 });
    expectCommand(['--serve', '65535'], { kind: 'serve', port: 65535 });
  });

  it('parses the repository commands with their operands', () => {
    expectCommand(['init'], { kind: 'init', path: '.' });
    expectCommand(['init', 'repo'], { kind: 'init', path: 'repo' });
    expectCommand(['status'], { kind: 'status' });
    expectCommand(['log'], { kind: 'log' });
    expectCommand(['commit', 'message'], { kind: 'commit', message: 'message' });
    expectCommand(['revert', '(a@x->1)'], { kind: 'revert', version: '(a@x->1)' });
    expectCommand(['merge', '../other'], { kind: 'merge', repository: '../other' });
  });

  it('parses config with --global only in its leading position', () => {
    expectCommand(['config', 'contributor.id', 'a@x'], {
      kind: 'config',
      global: false,
      id: 'a@x',
    });
    expectCommand(['config', '--global', 'contributor.id', 'a@x'], {
      kind: 'config',
      global: true,
      id: 'a@x',
    });
  });

  it('parses diff with and without --repo, and the zero-operand working-tree form', () => {
    expectCommand(['diff'], { kind: 'diffWorktree' });
    expectCommand(['diff', '(a@x->1)', '(a@x->2)'], {
      kind: 'diff',
      oldVersion: '(a@x->1)',
      newVersion: '(a@x->2)',
      repo: undefined,
    });
    expectCommand(['diff', '()', '(a@x->1)', '--repo', '../other'], {
      kind: 'diff',
      oldVersion: '()',
      newVersion: '(a@x->1)',
      repo: '../other',
    });
  });

  it('takes option-shaped operands verbatim where §7 shows none', () => {
    // The message, like the version and repository operands, is data; only the option positions
    // §7 actually defines are grammar-checked.
    expectCommand(['commit', '--message'], { kind: 'commit', message: '--message' });
  });
});

describe('parseArgs: the uniform usage error (tests/24)', () => {
  const rejected: readonly (readonly string[])[] = [
    [],
    ['unknown'],
    ['--unknown'],
    ['--version', 'extra'],
    ['init', 'a', 'b'],
    ['init', '--unknown'],
    ['status', 'extra'],
    ['log', '--unknown'],
    ['commit'],
    ['commit', 'message', 'extra'],
    ['config', 'contributor.id', 'a@x', '--global'],
    ['config', '--global', '--global', 'contributor.id', 'a@x'],
    ['config', '--global', 'contributor.id'],
    ['config', '--global', 'unknown.key', 'a@x'],
    ['revert'],
    ['revert', '(a@x->1)', 'extra'],
    ['merge'],
    ['merge', 'repo', 'extra'],
    ['--serve', '0', 'extra'],
  ];

  for (const argv of rejected) {
    it(`rejects ${JSON.stringify(argv)}`, () => {
      expectError(argv, INVALID);
    });
  }
});

describe('parseArgs: the diff usage error (tests/14)', () => {
  const rejected: readonly (readonly string[])[] = [
    ['diff', '()'],
    ['diff', '()', '()', '--repo'],
    ['diff', '()', '()', '--repo', 'r', '--repo', 'r'],
    ['diff', '()', '()', '--unknown', 'repo'],
    ['diff', '()', '()', '../repo', '--repo'],
  ];

  for (const argv of rejected) {
    it(`rejects ${JSON.stringify(argv)}`, () => {
      expectError(argv, DIFF_USAGE);
    });
  }
});

describe('parseArgs: port operands (tests/14)', () => {
  it('rejects a port above 65535', () => {
    expectError(['--serve', '65536'], 'invalid port: 65536');
  });

  it('rejects a non-decimal port', () => {
    expectError(['--serve', 'abc'], 'invalid port: abc');
    expectError(['--serve', '-1'], 'invalid port: -1');
  });
});
