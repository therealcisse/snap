import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';

import { SNAP_DIRECTORY } from '../fs/locate.ts';

import { commit } from './commit.ts';
import { diffCrossRepository, diffVersions, diffWorktree } from './diff.ts';

/**
 * A repository root with `a@x` configured and, optionally, `repository.json` seeded with
 * patches as `[author, revision, base, message, [path, text]]` tuples — text content only,
 * since the fixtures under test are text diffs.
 */
function repository(
  patches: readonly {
    author: string;
    revision: number;
    base: readonly (readonly [string, number])[];
    message: string;
    files: readonly (readonly [string, string])[];
  }[] = [],
): string {
  const root = mkdtempSync(join(tmpdir(), 'snap-diff-'));
  mkdirSync(join(root, SNAP_DIRECTORY), { recursive: true });
  writeFileSync(join(root, SNAP_DIRECTORY, 'config.json'), '{"contributor":{"id":"a@x"}}');
  const top = patches.at(-1);
  const frontier = top === undefined ? [] : [[top.author, top.revision] as const];
  writeFileSync(
    join(root, SNAP_DIRECTORY, 'repository.json'),
    JSON.stringify(
      {
        format: 1,
        frontier,
        patches: patches.map((patch) => ({
          author: patch.author,
          revision: patch.revision,
          base: patch.base,
          message: patch.message,
          changes: patch.files.map(([path, text]) => ({
            type: 'text',
            path,
            edit:
              text === ''
                ? []
                : [
                    {
                      insert: text
                        .split('\n')
                        .map((line, i, all) => (i === all.length - 1 ? line : `${line}\n`))
                        .filter((token) => token !== ''),
                    },
                  ],
          })),
        })),
      },
      null,
      2,
    ) + '\n',
  );
  return root;
}

describe('diffWorktree', () => {
  it('renders the tests/05 golden: adds, repeated-line edits, missing final newlines', () => {
    const root = repository([
      {
        author: 'a@x',
        revision: 1,
        base: [],
        message: 'old',
        files: [['repeated.txt', 'a\nb\na\n']],
      },
    ]);
    writeFileSync(join(root, 'repeated.txt'), 'b\na\na');
    writeFileSync(join(root, 'added.txt'), 'new');
    assert.deepEqual(diffWorktree(root), {
      stdout:
        '--- /dev/null\n' +
        '+++ b/added.txt\n' +
        '@@ -1,0 +1,1 @@\n' +
        '+new\n' +
        '\\ No newline at end of file\n' +
        '--- a/repeated.txt\n' +
        '+++ b/repeated.txt\n' +
        '@@ -1,3 +1,3 @@\n' +
        '-a\n' +
        ' b\n' +
        ' a\n' +
        '+a\n' +
        '\\ No newline at end of file\n',
      stderr: '',
    });
  });

  it('renders the tests/06 golden: binary lines and the empty-file block', () => {
    const root = repository();
    writeFileSync(join(root, 'empty'), '');
    writeFileSync(join(root, 'data.bin'), Buffer.from([0x00, 0xff, 0x80, 0x01, 0x04, 0x12]));
    assert.deepEqual(diffWorktree(root), {
      stdout:
        'Binary files /dev/null and b/data.bin differ\n' +
        '--- /dev/null\n' +
        '+++ b/empty\n' +
        '@@ -1,0 +1,0 @@\n',
      stderr: '',
    });
    // A binary file already current, then deleted from the working tree, is the other
    // binary side: present bytes against /dev/null.
    const deleted = repository();
    writeFileSync(join(deleted, 'data.bin'), Buffer.from([0x00, 0xff]));
    commit('bin', deleted, {});
    rmSync(join(deleted, 'data.bin'));
    assert.deepEqual(diffWorktree(deleted), {
      stdout: 'Binary files a/data.bin and /dev/null differ\n',
      stderr: '',
    });
  });
});

describe('diffVersions', () => {
  it('compares two known versions through a real committed history', () => {
    const root = repository();
    writeFileSync(join(root, 'repeated.txt'), 'a\nb\na\n');
    commit('old', root, {});
    writeFileSync(join(root, 'repeated.txt'), 'b\na\na');
    writeFileSync(join(root, 'added.txt'), 'new');
    // The dirty working tree before the commit is exactly what the two committed
    // versions' diff must reproduce afterwards.
    const dirty = diffWorktree(root);
    commit('new', root, {});
    assert.deepEqual(diffVersions('(a@x->1)', '(a@x->2)', root), dirty);
    // Equal versions are the empty success.
    assert.deepEqual(diffVersions('(a@x->2)', '(a@x->2)', root), { stdout: '', stderr: '' });
  });

  it('resolves old before new, refusing unknown and non-canonical operands', () => {
    const root = repository([
      { author: 'a@x', revision: 1, base: [], message: 'one', files: [['f', 'one\n']] },
    ]);
    assert.throws(() => diffVersions('(a@x->2)', '(a@x->1)', root), {
      message: 'unknown version: (a@x->2)',
    });
    assert.throws(() => diffVersions('(a@x->01)', '()', root), {
      message: 'invalid version: (a@x->01)',
    });
  });
});

/** The expected rendering whenever `old` is a@x's `f` and `new` is b@x's `g`. */
const fVersusG =
  '--- a/f\n' +
  '+++ /dev/null\n' +
  '@@ -1,1 +1,0 @@\n' +
  '-one\n' +
  '--- /dev/null\n' +
  '+++ b/g\n' +
  '@@ -1,0 +1,1 @@\n' +
  '+two\n';

describe('diffCrossRepository', () => {
  function localAndOperand(): { local: string; operand: string } {
    const local = repository([
      { author: 'a@x', revision: 1, base: [], message: 'mine', files: [['f', 'one\n']] },
    ]);
    const operand = repository([
      { author: 'b@x', revision: 1, base: [], message: 'theirs', files: [['g', 'two\n']] },
    ]);
    return { local, operand };
  }

  it('resolves `old` locally even when the operand lacks it (§7.6)', async () => {
    // a@x->1 exists only in the local repository — under operand-side resolution this would be
    // an unknown version — pinning the decision that `old` never resolves in the operand.
    const { local, operand } = localAndOperand();
    assert.deepEqual(await diffCrossRepository('(a@x->1)', '(b@x->1)', local, operand), {
      stdout: fVersusG,
      stderr: '',
    });
  });

  it('resolves `old` against the local repository first', async () => {
    const { local, operand } = localAndOperand();
    await assert.rejects(diffCrossRepository('(a@x->2)', '(b@x->1)', local, operand), {
      message: 'unknown version: (a@x->2)',
    });
  });

  it('resolves `new` against the operand repository', async () => {
    const { local, operand } = localAndOperand();
    await assert.rejects(diffCrossRepository('(a@x->1)', '(c@x->1)', local, operand), {
      message: 'unknown version: (c@x->1)',
    });
  });

  it('fails a shared dot that parses differently (§7.6 dot check)', async () => {
    const local = repository([
      { author: 'a@x', revision: 1, base: [], message: 'mine', files: [['f', 'one\n']] },
    ]);
    const operand = repository([
      { author: 'a@x', revision: 1, base: [], message: 'theirs', files: [['f', 'uno\n']] },
    ]);
    await assert.rejects(diffCrossRepository('(a@x->1)', '(a@x->1)', local, operand), {
      message: 'patch collision: a@x revision 1',
    });
  });
});

describe('diffCrossRepository: HTTP operand', () => {
  const remoteJson =
    JSON.stringify(
      {
        format: 1,
        frontier: [['b@x', 1]],
        patches: [
          {
            author: 'b@x',
            revision: 1,
            base: [],
            message: 'theirs',
            changes: [{ type: 'text', path: 'g', edit: [{ insert: ['two\n'] }] }],
          },
        ],
      },
      null,
      2,
    ) + '\n';

  let server: Server;
  let origin = '';

  before(async () => {
    server = createServer((request, response) => {
      if (request.url === '/repository.json') {
        response.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
        response.end(remoteJson);
        return;
      }
      response.writeHead(200, { 'content-type': 'text/plain' });
      response.end('not-json');
    });
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => {
        resolve();
      });
    });
    const address = server.address();
    if (address === null || typeof address === 'string') {
      throw new Error('expected a TCP listener address');
    }
    origin = `http://127.0.0.1:${String(address.port)}`;
  });

  after(() => {
    server.close();
    server.closeAllConnections();
  });

  it('diffs against the fetched repository exactly like a local operand', async () => {
    const local = repository([
      { author: 'a@x', revision: 1, base: [], message: 'mine', files: [['f', 'one\n']] },
    ]);
    assert.deepEqual(
      await diffCrossRepository('(a@x->1)', '(b@x->1)', local, `${origin}/repository.json`),
      { stdout: fVersusG, stderr: '' },
    );
  });

  it('surfaces the client’s strict-parse failure for a non-JSON body', async () => {
    // The exact strict-reader message is client.test.ts’s to pin; here it only matters that
    // the fetch boundary rejects instead of reaching version resolution.
    await assert.rejects(diffCrossRepository('()', '()', repository(), `${origin}/bad`), {
      name: 'SnapError',
      message: /invalid JSON/,
    });
  });
});
