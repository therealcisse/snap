import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { type StreamModes, render, renderErrorLine, resolveModes } from './presentation.ts';

const PLAIN = 'plain';
const TERMINAL = 'terminal';

/** The §7.11 selections the render tests run under. */
const ALL_PLAIN: StreamModes = { stdout: PLAIN, stderr: PLAIN };
const ALL_TERMINAL: StreamModes = { stdout: TERMINAL, stderr: TERMINAL };
const STDOUT_TERMINAL: StreamModes = { stdout: TERMINAL, stderr: PLAIN };

describe('resolveModes (SPEC §7.11)', () => {
  it('follows each stream’s own TTY status when SNAP_COLOR is unset or auto', () => {
    assert.deepEqual(resolveModes({}, true, true), { stdout: TERMINAL, stderr: TERMINAL });
    assert.deepEqual(resolveModes({}, false, false), { stdout: PLAIN, stderr: PLAIN });
    // §11's mixed case: a terminal stdout piped past a redirected stderr stays terminal on stdout.
    assert.deepEqual(resolveModes({}, true, false), { stdout: TERMINAL, stderr: PLAIN });
    assert.deepEqual(resolveModes({}, false, true), { stdout: PLAIN, stderr: TERMINAL });
    assert.deepEqual(resolveModes({ SNAP_COLOR: 'auto' }, true, false), {
      stdout: TERMINAL,
      stderr: PLAIN,
    });
  });

  it('selects plain everywhere when NO_COLOR is present, whatever its value', () => {
    assert.deepEqual(resolveModes({ NO_COLOR: '' }, true, true), {
      stdout: PLAIN,
      stderr: PLAIN,
    });
    assert.deepEqual(resolveModes({ NO_COLOR: '0' }, true, true), {
      stdout: PLAIN,
      stderr: PLAIN,
    });
  });

  it('lets SNAP_COLOR=always override NO_COLOR and redirection', () => {
    assert.deepEqual(resolveModes({ SNAP_COLOR: 'always', NO_COLOR: '1' }, false, false), {
      stdout: TERMINAL,
      stderr: TERMINAL,
    });
  });

  it('selects plain everywhere on SNAP_COLOR=never', () => {
    assert.deepEqual(resolveModes({ SNAP_COLOR: 'never' }, true, true), {
      stdout: PLAIN,
      stderr: PLAIN,
    });
  });

  it('rejects any other SNAP_COLOR value, empty included', () => {
    assert.throws(() => resolveModes({ SNAP_COLOR: 'bogus' }, false, false), {
      message: 'SNAP_COLOR must be auto, always, or never',
    });
    assert.throws(() => resolveModes({ SNAP_COLOR: '' }, false, false), {
      message: 'SNAP_COLOR must be auto, always, or never',
    });
  });
});

describe('render plain (SPEC §7.11)', () => {
  it('lays out every command kind with the byte-stable plain forms', () => {
    assert.deepEqual(render({ kind: 'version', semver: '1.0.0' }, ALL_PLAIN), {
      stdout: 'snap 1.0.0\n',
      stderr: '',
    });
    assert.deepEqual(render({ kind: 'config' }, ALL_PLAIN), { stdout: '', stderr: '' });
    assert.deepEqual(
      render({ kind: 'success', label: 'Committed', version: '(a@x->1)' }, ALL_PLAIN),
      { stdout: '(a@x->1)\n', stderr: '' },
    );
    assert.deepEqual(
      render(
        {
          kind: 'status',
          version: '(alice@x->1)',
          rows: [
            { code: 'M', path: 'added.txt' },
            { code: 'A', path: 'new.txt' },
          ],
        },
        ALL_PLAIN,
      ),
      { stdout: 'version (alice@x->1)\nM added.txt\nA new.txt\n', stderr: '' },
    );
    assert.deepEqual(
      render(
        {
          kind: 'log',
          entries: [
            { version: '(a@x->2)', author: 'a@x', message: 'second' },
            { version: '(a@x->1)', author: 'a@x', message: 'first' },
          ],
        },
        ALL_PLAIN,
      ),
      { stdout: '(a@x->2)\ta@x\tsecond\n(a@x->1)\ta@x\tfirst\n', stderr: '' },
    );
    assert.deepEqual(render({ kind: 'diff', text: '-old\n' }, ALL_PLAIN), {
      stdout: '-old\n',
      stderr: '',
    });
  });

  it('renders warnings as warning lines on stderr in order', () => {
    assert.deepEqual(
      render({ kind: 'success', label: 'Merged', version: '(a@x->1,b@x->1)' }, ALL_PLAIN, [
        'auto-resolved same: later-create-wins',
      ]),
      {
        stdout: '(a@x->1,b@x->1)\n',
        stderr: 'warning: auto-resolved same: later-create-wins\n',
      },
    );
    assert.deepEqual(render({ kind: 'config' }, ALL_PLAIN, ['one', 'two']), {
      stdout: '',
      stderr: 'warning: one\nwarning: two\n',
    });
  });
});

describe('render terminal (SPEC §7.11)', () => {
  it('bolds the version line', () => {
    assert.deepEqual(render({ kind: 'version', semver: '1.0.0' }, ALL_TERMINAL), {
      stdout: '\u001b[1msnap 1.0.0\u001b[0m\n',
      stderr: '',
    });
  });

  it('styles each success line with ✓, its own label, and the version', () => {
    assert.deepEqual(
      render({ kind: 'success', label: 'Initialized repository', version: '()' }, ALL_TERMINAL),
      {
        stdout:
          '\u001b[32m✓\u001b[0m \u001b[1mInitialized repository\u001b[0m \u001b[36m()\u001b[0m\n',
        stderr: '',
      },
    );
    assert.deepEqual(
      render({ kind: 'success', label: 'Reverted', version: '(alice@x->3)' }, ALL_TERMINAL),
      {
        stdout: '\u001b[32m✓\u001b[0m \u001b[1mReverted\u001b[0m \u001b[36m(alice@x->3)\u001b[0m\n',
        stderr: '',
      },
    );
  });

  it('renders status with the two-space header gap and per-code symbol, color, and label', () => {
    assert.deepEqual(
      render(
        {
          kind: 'status',
          version: '(alice@x->1)',
          rows: [
            { code: 'M', path: 'added.txt' },
            { code: 'D', path: 'gone.txt' },
            { code: 'M', path: 'modified.txt' },
            { code: 'A', path: 'new.txt' },
          ],
        },
        ALL_TERMINAL,
      ),
      {
        stdout:
          '\u001b[1mSnap status\u001b[0m  \u001b[36m(alice@x->1)\u001b[0m\n\n' +
          '  \u001b[33m~\u001b[0m added.txt \u001b[2m(modified)\u001b[0m\n' +
          '  \u001b[31m−\u001b[0m gone.txt \u001b[2m(deleted)\u001b[0m\n' +
          '  \u001b[33m~\u001b[0m modified.txt \u001b[2m(modified)\u001b[0m\n' +
          '  \u001b[32m+\u001b[0m new.txt \u001b[2m(added)\u001b[0m\n',
        stderr: '',
      },
    );
  });

  it('renders the clean working tree line', () => {
    assert.deepEqual(render({ kind: 'status', version: '(alice@x->1)', rows: [] }, ALL_TERMINAL), {
      stdout:
        '\u001b[1mSnap status\u001b[0m  \u001b[36m(alice@x->1)\u001b[0m\n\n' +
        '  \u001b[32m✓\u001b[0m Working tree clean\n',
      stderr: '',
    });
  });

  it('keeps a row path’s trailing space before the label', () => {
    assert.deepEqual(
      render(
        { kind: 'status', version: '()', rows: [{ code: 'A', path: 'trailing ' }] },
        ALL_TERMINAL,
      ),
      {
        stdout:
          '\u001b[1mSnap status\u001b[0m  \u001b[36m()\u001b[0m\n\n' +
          '  \u001b[32m+\u001b[0m trailing  \u001b[2m(added)\u001b[0m\n',
        stderr: '',
      },
    );
  });

  it('renders a log entry with the bullet, bold message, version, by, and author', () => {
    assert.deepEqual(
      render(
        {
          kind: 'log',
          entries: [{ version: '(alice@x->1)', author: 'alice@x', message: 'first' }],
        },
        ALL_TERMINAL,
      ),
      {
        stdout:
          '\u001b[36m●\u001b[0m \u001b[1mfirst\u001b[0m\n' +
          '  \u001b[36m(alice@x->1)\u001b[0m \u001b[2mby\u001b[0m \u001b[35malice@x\u001b[0m\n',
        stderr: '',
      },
    );
  });

  it('separates log entries with a blank line and keeps a message’s trailing space inside the bold', () => {
    assert.deepEqual(
      render(
        {
          kind: 'log',
          entries: [
            { version: '(spaces@x->1)', author: 'spaces@x', message: 'message ' },
            { version: '(a@x->1)', author: 'a@x', message: 'first' },
          ],
        },
        ALL_TERMINAL,
      ),
      {
        stdout:
          '\u001b[36m●\u001b[0m \u001b[1mmessage \u001b[0m\n' +
          '  \u001b[36m(spaces@x->1)\u001b[0m \u001b[2mby\u001b[0m \u001b[35mspaces@x\u001b[0m\n' +
          '\n' +
          '\u001b[36m●\u001b[0m \u001b[1mfirst\u001b[0m\n' +
          '  \u001b[36m(a@x->1)\u001b[0m \u001b[2mby\u001b[0m \u001b[35ma@x\u001b[0m\n',
        stderr: '',
      },
    );
  });

  it('colors diff lines by first-matching prefix and passes context lines through', () => {
    const text =
      '--- a/added.txt\n' +
      '+++ b/added.txt\n' +
      '@@ -1,2 +1,2 @@\n' +
      ' context\n' +
      '-old\n' +
      '+new\n';
    assert.deepEqual(render({ kind: 'diff', text }, ALL_TERMINAL), {
      stdout:
        '\u001b[1m--- a/added.txt\u001b[0m\n' +
        '\u001b[1m+++ b/added.txt\u001b[0m\n' +
        '\u001b[36m@@ -1,2 +1,2 @@\u001b[0m\n' +
        ' context\n' +
        '\u001b[31m-old\u001b[0m\n' +
        '\u001b[32m+new\u001b[0m\n',
      stderr: '',
    });
  });

  it('colors binary and no-newline diff lines and keeps a missing final newline', () => {
    const text =
      'Binary files /dev/null and b/binary.bin differ\n' +
      '--- /dev/null\n' +
      '+++ b/no-newline.txt\n' +
      '@@ -1,0 +1,1 @@\n' +
      '+tail\n' +
      '\\ No newline at end of file\n';
    assert.deepEqual(render({ kind: 'diff', text }, ALL_TERMINAL), {
      stdout:
        '\u001b[33mBinary files /dev/null and b/binary.bin differ\u001b[0m\n' +
        '\u001b[1m--- /dev/null\u001b[0m\n' +
        '\u001b[1m+++ b/no-newline.txt\u001b[0m\n' +
        '\u001b[36m@@ -1,0 +1,1 @@\u001b[0m\n' +
        '\u001b[32m+tail\u001b[0m\n' +
        '\u001b[2m\\ No newline at end of file\u001b[0m\n',
      stderr: '',
    });
    assert.equal(
      render({ kind: 'diff', text: '+tail' }, ALL_TERMINAL).stdout,
      '\u001b[32m+tail\u001b[0m',
    );
  });

  it('keeps config silent and an empty diff empty', () => {
    assert.deepEqual(render({ kind: 'config' }, ALL_TERMINAL), { stdout: '', stderr: '' });
    assert.deepEqual(render({ kind: 'diff', text: '' }, ALL_TERMINAL), { stdout: '', stderr: '' });
  });

  it('renders warnings as yellow ⚠ lines on stderr beside the merged success', () => {
    assert.deepEqual(
      render({ kind: 'success', label: 'Merged', version: '(a@x->1,b@x->1)' }, ALL_TERMINAL, [
        'auto-resolved same: later-create-wins',
      ]),
      {
        stdout:
          '\u001b[32m✓\u001b[0m \u001b[1mMerged\u001b[0m \u001b[36m(a@x->1,b@x->1)\u001b[0m\n',
        stderr: '\u001b[33m⚠\u001b[0m \u001b[33mauto-resolved same: later-create-wins\u001b[0m\n',
      },
    );
  });
});

describe('render with mixed stream modes (SPEC §7.11)', () => {
  it('colors stdout while stderr warnings stay plain', () => {
    assert.deepEqual(
      render({ kind: 'version', semver: '1.0.0' }, STDOUT_TERMINAL, ['left dirty']),
      {
        stdout: '\u001b[1msnap 1.0.0\u001b[0m\n',
        stderr: 'warning: left dirty\n',
      },
    );
  });
});

describe('renderErrorLine (SPEC §7.11)', () => {
  it('returns the plain line unchanged', () => {
    assert.equal(
      renderErrorLine('snap: not a Snap repository\n', PLAIN),
      'snap: not a Snap repository\n',
    );
  });

  it('wraps ✗ plus the complete line, snap: prefix included, in red', () => {
    assert.equal(
      renderErrorLine('snap: invalid command or arguments\n', TERMINAL),
      '\u001b[31m✗ snap: invalid command or arguments\u001b[0m\n',
    );
  });

  it('carries exactly one trailing newline in terminal mode', () => {
    assert.equal(renderErrorLine('snap: boom', TERMINAL), '\u001b[31m✗ snap: boom\u001b[0m\n');
  });
});
