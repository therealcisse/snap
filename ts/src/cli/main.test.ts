import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { SNAP_DIRECTORY } from '../fs/locate.ts';
import { EMPTY_REPOSITORY_JSON } from '../repo/model.ts';

import { type Context, run } from './main.ts';

/** A `Context` with buffer sinks and a fresh temporary cwd, plus what the sinks saw. */
function harness(
  overrides: { env?: Record<string, string | undefined>; cwd?: string; tty?: boolean } = {},
) {
  const out: string[] = [];
  const err: string[] = [];
  const ctx: Context = {
    out: { stdout: (text) => out.push(text), stderr: (text) => err.push(text) },
    env: overrides.env ?? {},
    cwd: overrides.cwd ?? mkdtempSync(join(tmpdir(), 'snap-cli-')),
    isStdoutTty: overrides.tty ?? false,
    isStderrTty: overrides.tty ?? false,
  };
  return { ctx, stdout: () => out.join(''), stderr: () => err.join('') };
}

/** A minimal empty repository at `cwd`, as `init` would have written it. */
function emptyRepository(cwd: string): void {
  mkdirSync(join(cwd, SNAP_DIRECTORY), { recursive: true });
  writeFileSync(join(cwd, SNAP_DIRECTORY, 'repository.json'), EMPTY_REPOSITORY_JSON);
}

describe('run', () => {
  it('prints the version and succeeds', async () => {
    const h = harness();
    assert.equal(await run(['--version'], h.ctx), 0);
    assert.equal(h.stdout(), 'snap 1.0.0\n');
    assert.equal(h.stderr(), '');
  });

  it('rejects an unknown command with the uniform usage error', async () => {
    const h = harness();
    assert.equal(await run(['unknown'], h.ctx), 1);
    assert.equal(h.stdout(), '');
    assert.equal(h.stderr(), 'snap: invalid command or arguments\n');
  });

  it('rejects an invalid SNAP_COLOR before running any command', async () => {
    const h = harness({ env: { SNAP_COLOR: 'bogus' } });
    assert.equal(await run(['--version'], h.ctx), 1);
    assert.equal(h.stderr(), 'snap: SNAP_COLOR must be auto, always, or never\n');
  });

  it('renders the §7.11 terminal bytes on SNAP_COLOR=always', async () => {
    const h = harness({ env: { SNAP_COLOR: 'always' } });
    assert.equal(await run(['--version'], h.ctx), 0);
    assert.equal(h.stdout(), '\u001b[1msnap 1.0.0\u001b[0m\n');
  });

  it('stays plain on SNAP_COLOR=never even when both streams are TTYs', async () => {
    const h = harness({ env: { SNAP_COLOR: 'never' }, tty: true });
    assert.equal(await run(['--version'], h.ctx), 0);
    assert.equal(h.stdout(), 'snap 1.0.0\n');
  });

  it('renders the usage error in terminal red under SNAP_COLOR=always', async () => {
    const h = harness({ env: { SNAP_COLOR: 'always' } });
    assert.equal(await run(['unknown'], h.ctx), 1);
    assert.equal(h.stderr(), '\u001b[31m✗ snap: invalid command or arguments\u001b[0m\n');
  });

  it('renders the init success line in terminal mode under SNAP_COLOR=always', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'snap-cli-'));
    const h = harness({ cwd, env: { SNAP_COLOR: 'always' } });
    assert.equal(await run(['init'], h.ctx), 0);
    assert.equal(
      h.stdout(),
      '\u001b[32m✓\u001b[0m \u001b[1mInitialized repository\u001b[0m \u001b[36m()\u001b[0m\n',
    );
  });

  it('reports status outside a repository as a location failure', async () => {
    const h = harness();
    assert.equal(await run(['status'], h.ctx), 1);
    assert.equal(h.stderr(), 'snap: not a Snap repository\n');
  });

  it('reports a clean empty repository status through the dispatch', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'snap-cli-'));
    emptyRepository(cwd);
    const h = harness({ cwd });
    assert.equal(await run(['status'], h.ctx), 0);
    assert.equal(h.stdout(), 'version ()\n');
    assert.equal(h.stderr(), '');
  });

  it('runs the working-tree diff with no operands and prints nothing when clean', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'snap-cli-'));
    emptyRepository(cwd);
    const h = harness({ cwd });
    assert.equal(await run(['diff'], h.ctx), 0);
    assert.equal(h.stdout(), '');
    assert.equal(h.stderr(), '');
  });

  it('rejects an unknown revert operand even without contributor configuration', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'snap-cli-'));
    emptyRepository(cwd);
    const h = harness({ cwd });
    assert.equal(await run(['revert', '(unknown@x->1)'], h.ctx), 1);
    assert.equal(h.stderr(), 'snap: unknown version: (unknown@x->1)\n');
  });

  it('rejects a non-canonical diff operand', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'snap-cli-'));
    emptyRepository(cwd);
    const h = harness({ cwd });
    assert.equal(await run(['diff', '(a@x->01)', '(a@x->1)'], h.ctx), 1);
    assert.equal(h.stderr(), 'snap: invalid version: (a@x->01)\n');
  });

  it('keeps the cross-repository diff and merge not implemented', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'snap-cli-'));
    emptyRepository(cwd);
    const h = harness({ cwd });
    assert.equal(await run(['diff', '()', '()', '--repo', 'other'], h.ctx), 1);
    assert.equal(await run(['merge', 'other'], h.ctx), 1);
    // The harness accumulates, so one assertion carries both refusals in order.
    assert.equal(
      h.stderr(),
      'snap: not implemented: diff () () --repo other\n' + 'snap: not implemented: merge other\n',
    );
  });

  it('initializes a repository through the dispatch', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'snap-cli-'));
    const h = harness({ cwd });
    assert.equal(await run(['init'], h.ctx), 0);
    assert.equal(h.stdout(), '()\n');
    assert.equal(
      readFileSync(join(cwd, SNAP_DIRECTORY, 'repository.json'), 'utf8'),
      EMPTY_REPOSITORY_JSON,
    );
  });

  it('writes the global configuration through the dispatch', async () => {
    const home = mkdtempSync(join(tmpdir(), 'snap-home-'));
    const h = harness({ env: { HOME: home } });
    assert.equal(await run(['config', '--global', 'contributor.id', 'a@x'], h.ctx), 0);
    assert.equal(h.stdout(), '');
    assert.equal(h.stderr(), '');
    assert.ok(existsSync(join(home, '.snapconfig.json')));
  });

  it('routes serve through the same failure boundary', async () => {
    // A serve startup failure must land in the one catch in `run` like every other command's,
    // not bypass it because the arm is async (SPEC §10: one error path, one exit code).
    const h = harness();
    assert.equal(await run(['--serve', '0'], h.ctx), 1);
    assert.equal(h.stderr(), 'snap: not a Snap repository\n');
  });
});
