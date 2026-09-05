import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { resolveModes } from './presentation.ts';

const PLAIN = 'plain';
const TERMINAL = 'terminal';

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
