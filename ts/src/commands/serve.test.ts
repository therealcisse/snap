import assert from 'node:assert/strict';
import { type ChildProcess, spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { type IncomingHttpHeaders, request } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import { SNAP_DIRECTORY } from '../fs/locate.ts';
import { EMPTY_REPOSITORY_JSON } from '../repo/model.ts';

/**
 * Process-level pins for §7.9 — the startup URL bytes, snapshot immutability, signal exit 0,
 * and startup validation failure — exercised through the real CLI because they are properties
 * of the process, not of any module. The repository fixture is a hand-written canonical
 * `repository.json` (tests/12's golden), so no `commit` exists yet on this strand.
 */
describe('snap --serve', () => {
  const SNAP = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'snap');
  const REPOSITORY_JSON = `{
  "format": 1,
  "frontier": [
    [
      "a@x",
      1
    ]
  ],
  "patches": [
    {
      "author": "a@x",
      "revision": 1,
      "base": [],
      "message": "one",
      "changes": [
        {
          "type": "text",
          "path": "file.txt",
          "edit": [
            {
              "insert": [
                "one\\n"
              ]
            }
          ]
        }
      ]
    }
  ]
}
`;
  const CORRUPT_REPOSITORY_JSON =
    '{\n  "format": 1,\n  "frontier": [],\n  "patches": [],\n  "bad": true\n}\n';

  interface Exit {
    readonly code: number;
    readonly stdout: string;
    readonly stderr: string;
  }

  interface Running {
    readonly child: ChildProcess;
    readonly url: Promise<string>;
    readonly exit: Promise<Exit>;
  }

  /** A fresh temporary repository whose `repository.json` is exactly `json`. */
  function repositoryDirectory(json: string): string {
    const dir = mkdtempSync(join(tmpdir(), 'snap-serve-'));
    mkdirSync(join(dir, SNAP_DIRECTORY));
    writeFileSync(join(dir, SNAP_DIRECTORY, 'repository.json'), json);
    return dir;
  }

  /** Spawns `snap --serve 0` in `cwd`; `url` resolves on the printed startup line. */
  function startServe(cwd: string): Running {
    // Through the `snap` launcher rather than tsx by hand: its `exec` makes the shell pid the
    // node pid, so a signal to `child` reaches the server itself.
    const child = spawn('sh', [SNAP, '--serve', '0'], { cwd });
    let stdout = '';
    let stderr = '';
    const url = new Promise<string>((resolve, reject) => {
      const giveUp = setTimeout(() => {
        reject(new Error(`server never printed its URL (stdout so far: ${stdout})`));
      }, 15000);
      child.stdout.on('data', (chunk: Buffer) => {
        stdout += chunk.toString();
        const match = /^(http:\/\/127\.0\.0\.1:[0-9]+\/repository\.json)\n$/.exec(stdout);
        if (match) {
          clearTimeout(giveUp);
          resolve(match[1]!);
        }
      });
    });
    const exit = new Promise<Exit>((resolve) => {
      child.stderr.on('data', (chunk: Buffer) => {
        stderr += chunk.toString();
      });
      child.once('close', (code) => {
        resolve({ code: code ?? -1, stdout, stderr });
      });
    });
    return { child, url, exit };
  }

  function get(
    url: string,
  ): Promise<{ status: number; headers: IncomingHttpHeaders; body: Buffer }> {
    return new Promise((resolve, reject) => {
      const call = request(url, { agent: false }, (incoming) => {
        const chunks: Buffer[] = [];
        incoming.on('data', (chunk: Buffer) => chunks.push(chunk));
        incoming.on('end', () => {
          resolve({
            status: incoming.statusCode ?? 0,
            headers: incoming.headers,
            body: Buffer.concat(chunks),
          });
        });
      });
      call.on('error', reject);
      call.end();
    });
  }

  it(
    'serves the startup snapshot immutably and exits 0 on SIGTERM',
    { timeout: 30000 },
    async () => {
      const dir = repositoryDirectory(REPOSITORY_JSON);
      const running = startServe(dir);
      const url = await running.url;
      const first = await get(url);
      assert.equal(first.status, 200);
      assert.equal(first.headers['content-type'], 'application/json; charset=utf-8');
      assert.deepEqual(first.body, Buffer.from(REPOSITORY_JSON, 'utf8'));
      // A later change on disk must be invisible: the snapshot was taken at startup (§7.9).
      writeFileSync(join(dir, SNAP_DIRECTORY, 'repository.json'), EMPTY_REPOSITORY_JSON);
      const second = await get(url);
      assert.deepEqual(second.body, Buffer.from(REPOSITORY_JSON, 'utf8'));
      running.child.kill('SIGTERM');
      const exit = await running.exit;
      assert.equal(exit.code, 0);
      assert.equal(exit.stdout, `${url}\n`);
      assert.equal(exit.stderr, '');
    },
  );

  it('exits 0 on SIGINT', { timeout: 30000 }, async () => {
    const running = startServe(repositoryDirectory(REPOSITORY_JSON));
    const url = await running.url;
    running.child.kill('SIGINT');
    const exit = await running.exit;
    assert.equal(exit.code, 0);
    assert.equal(exit.stdout, `${url}\n`);
    assert.equal(exit.stderr, '');
  });

  it('fails before serving when the repository is corrupt', { timeout: 30000 }, async () => {
    const child = spawn('sh', [SNAP, '--serve', '0'], {
      cwd: repositoryDirectory(CORRUPT_REPOSITORY_JSON),
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    const code = await new Promise<number>((resolve) => {
      child.once('close', (value) => {
        resolve(value ?? -1);
      });
    });
    assert.equal(code, 1);
    assert.equal(stdout, '');
    assert.match(stderr, /^snap: .+\n$/);
    assert.match(stderr, /repository has unknown field: bad/);
  });
});
