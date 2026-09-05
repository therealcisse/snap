import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { SNAP_DIRECTORY } from '../fs/locate.ts';
import { EMPTY_REPOSITORY_JSON } from '../repo/model.ts';

import { type Context, run } from './main.ts';

/** A `Context` with buffer sinks, a fresh temporary cwd, and no TTYs, plus what the sinks saw. */
function harness(overrides: { env?: Record<string, string | undefined>; cwd?: string } = {}) {
  const out: string[] = [];
  const err: string[] = [];
  const ctx: Context = {
    out: { stdout: (text) => out.push(text), stderr: (text) => err.push(text) },
    env: overrides.env ?? {},
    cwd: overrides.cwd ?? mkdtempSync(join(tmpdir(), 'snap-cli-')),
    isStdoutTty: false,
    isStderrTty: false,
  };
  return { ctx, stdout: () => out.join(''), stderr: () => err.join('') };
}

/** A minimal empty repository at `cwd`, as `init` would have written it. */
function emptyRepository(cwd: string): void {
  mkdirSync(join(cwd, SNAP_DIRECTORY), { recursive: true });
  writeFileSync(join(cwd, SNAP_DIRECTORY, 'repository.json'), EMPTY_REPOSITORY_JSON);
}

describe('run', () => {
  it('prints the version and succeeds', () => {
    const h = harness();
    assert.equal(run(['--version'], h.ctx), 0);
    assert.equal(h.stdout(), 'snap 1.0.0\n');
    assert.equal(h.stderr(), '');
  });

  it('rejects an unknown command with the uniform usage error', () => {
    const h = harness();
    assert.equal(run(['unknown'], h.ctx), 1);
    assert.equal(h.stdout(), '');
    assert.equal(h.stderr(), 'snap: invalid command or arguments\n');
  });

  it('rejects an invalid SNAP_COLOR before running any command', () => {
    const h = harness({ env: { SNAP_COLOR: 'bogus' } });
    assert.equal(run(['--version'], h.ctx), 1);
    assert.equal(h.stderr(), 'snap: SNAP_COLOR must be auto, always, or never\n');
  });

  it('accepts a valid SNAP_COLOR and still prints plain while rendering is deferred', () => {
    const h = harness({ env: { SNAP_COLOR: 'always' } });
    assert.equal(run(['--version'], h.ctx), 0);
    assert.equal(h.stdout(), 'snap 1.0.0\n');
  });

  it('reports status outside a repository as a location failure', () => {
    const h = harness();
    assert.equal(run(['status'], h.ctx), 1);
    assert.equal(h.stderr(), 'snap: not a Snap repository\n');
  });

  it('locates the repository before reporting status as not implemented', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'snap-cli-'));
    emptyRepository(cwd);
    const h = harness({ cwd });
    assert.equal(run(['status'], h.ctx), 1);
    assert.equal(h.stderr(), 'snap: not implemented: status\n');
  });

  it('rejects an unknown revert operand before reporting not implemented', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'snap-cli-'));
    emptyRepository(cwd);
    const h = harness({ cwd });
    assert.equal(run(['revert', '(unknown@x->1)'], h.ctx), 1);
    assert.equal(h.stderr(), 'snap: unknown version: (unknown@x->1)\n');
  });

  it('rejects a non-canonical diff operand before reporting not implemented', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'snap-cli-'));
    emptyRepository(cwd);
    const h = harness({ cwd });
    assert.equal(run(['diff', '(a@x->01)', '(a@x->1)'], h.ctx), 1);
    assert.equal(h.stderr(), 'snap: invalid version: (a@x->01)\n');
  });

  it('initializes a repository through the dispatch', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'snap-cli-'));
    const h = harness({ cwd });
    assert.equal(run(['init'], h.ctx), 0);
    assert.equal(h.stdout(), '()\n');
    assert.equal(
      readFileSync(join(cwd, SNAP_DIRECTORY, 'repository.json'), 'utf8'),
      EMPTY_REPOSITORY_JSON,
    );
  });

  it('writes the global configuration through the dispatch', () => {
    const home = mkdtempSync(join(tmpdir(), 'snap-home-'));
    const h = harness({ env: { HOME: home } });
    assert.equal(run(['config', '--global', 'contributor.id', 'a@x'], h.ctx), 0);
    assert.equal(h.stdout(), '');
    assert.equal(h.stderr(), '');
    assert.ok(existsSync(join(home, '.snapconfig.json')));
  });
});
