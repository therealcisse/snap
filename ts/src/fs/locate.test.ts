import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { EMPTY_REPOSITORY_JSON } from '../repo/model.ts';

import {
  SNAP_DIRECTORY,
  decodeConfiguration,
  encodeConfiguration,
  findRepositoryRoot,
  loadValidatedRepository,
  nearestRepository,
  resolveContributorId,
} from './locate.ts';

/** A fresh temporary directory that no test has made a repository. */
function directory(): string {
  return mkdtempSync(join(tmpdir(), 'snap-locate-'));
}

/** A repository root containing `.snap/repository.json` with the canonical empty bytes. */
function repository(): string {
  const root = directory();
  mkdirSync(join(root, SNAP_DIRECTORY), { recursive: true });
  writeFileSync(join(root, SNAP_DIRECTORY, 'repository.json'), EMPTY_REPOSITORY_JSON);
  return root;
}

/** Writes `text` as the repository-local configuration file of `root`. */
function localConfig(root: string, text: string): void {
  writeFileSync(join(root, SNAP_DIRECTORY, 'config.json'), text);
}

/** Writes `text` as the global configuration file under a fresh `HOME` and returns it. */
function homeWith(text: string | undefined): string {
  const home = directory();
  if (text !== undefined) {
    writeFileSync(join(home, '.snapconfig.json'), text);
  }
  return home;
}

describe('decodeConfiguration', () => {
  it('reads the contributor ID from the canonical shape', () => {
    assert.deepEqual(decodeConfiguration('{"contributor":{"id":"alice@example.com"}}'), {
      contributorId: 'alice@example.com',
    });
  });

  it('accepts surrounding whitespace such as a trailing LF', () => {
    assert.deepEqual(decodeConfiguration('{"contributor":{"id":"global@example.com"}}\n'), {
      contributorId: 'global@example.com',
    });
  });

  it('treats an empty object and an empty contributor as no ID', () => {
    assert.deepEqual(decodeConfiguration('{}'), { contributorId: undefined });
    assert.deepEqual(decodeConfiguration('{"contributor":{}}'), { contributorId: undefined });
  });

  it('rejects unknown fields at either level', () => {
    assert.throws(() => decodeConfiguration('{"contributor":{"id":"old@x"},"unknown":true}'), {
      message: 'configuration has unknown field: unknown',
    });
    assert.throws(() => decodeConfiguration('{"contributor":{"id":"a@x","name":"A"}}'), {
      message: 'configuration.contributor has unknown field: name',
    });
  });

  it('rejects a duplicate id key', () => {
    assert.throws(() => decodeConfiguration('{"contributor":{"id":"a@x","id":"b@x"}}'), {
      message: 'duplicate JSON key id at configuration.contributor',
    });
  });

  it('rejects an invalid ID', () => {
    assert.throws(() => decodeConfiguration('{"contributor":{"id":"not-an-id"}}'), {
      message: 'invalid contributor id: not-an-id',
    });
  });

  it('rejects a non-string id and a non-object contributor', () => {
    assert.throws(() => decodeConfiguration('{"contributor":{"id":1}}'), {
      message: 'configuration.contributor.id must be a string, not a number',
    });
    assert.throws(() => decodeConfiguration('{"contributor":"a@x"}'), {
      message: 'configuration.contributor must be an object, not a string',
    });
  });

  it('rejects trailing bytes and malformed text as invalid JSON', () => {
    assert.throws(() => decodeConfiguration('{"contributor":{"id":"global@example.com"}}}'), {
      message: /^invalid JSON: /,
    });
    assert.throws(() => decodeConfiguration('not json'), { message: /^invalid JSON: / });
    assert.throws(() => decodeConfiguration(''), { message: /^invalid JSON: / });
  });
});

describe('nearestRepository and findRepositoryRoot (SPEC §7)', () => {
  it('finds the root from a subdirectory, stopping at the nearest one', () => {
    const outer = repository();
    const inner = join(outer, 'inner');
    mkdirSync(join(inner, SNAP_DIRECTORY), { recursive: true });
    const nested = join(inner, 'a', 'b');
    mkdirSync(nested, { recursive: true });
    assert.equal(nearestRepository(nested), inner);
    assert.equal(nearestRepository(join(outer, 'a')), outer);
    assert.equal(findRepositoryRoot(nested), inner);
  });

  it('returns undefined, or throws, outside every repository', () => {
    const outside = directory();
    assert.equal(nearestRepository(outside), undefined);
    assert.throws(() => findRepositoryRoot(outside), { message: 'not a Snap repository' });
  });
});

describe('loadValidatedRepository', () => {
  it('locates, decodes, and replays the nearest repository from any depth', () => {
    const root = repository();
    const loaded = loadValidatedRepository(join(root, 'sub-not-created'));
    assert.deepEqual(loaded.repository, {
      format: 1,
      frontier: [],
      patches: [],
    });
    assert.equal(loaded.root, root);
    assert.deepEqual(loaded.replay.tree, new Map());
    assert.deepEqual(loaded.replay.sequence, []);
  });

  it('reports a .snap directory without a readable repository.json as not a repository', () => {
    const root = directory();
    mkdirSync(join(root, SNAP_DIRECTORY));
    assert.throws(() => loadValidatedRepository(root), { message: 'not a Snap repository' });
  });

  it('passes decoder and validator failures through unchanged', () => {
    const root = repository();
    writeFileSync(join(root, SNAP_DIRECTORY, 'repository.json'), 'not json');
    assert.throws(() => loadValidatedRepository(root), { message: /^invalid JSON: / });

    const cyclic = repository();
    writeFileSync(
      join(cyclic, SNAP_DIRECTORY, 'repository.json'),
      JSON.stringify({
        format: 1,
        frontier: [],
        patches: [
          {
            author: 'a@x',
            revision: 1,
            base: [['a@x', 1]],
            message: 'self',
            changes: [{ type: 'put', path: 'f', content: 'YQ==' }],
          },
        ],
      }),
    );
    assert.throws(() => loadValidatedRepository(cyclic), {
      message: 'revision does not follow base: a@x->1',
    });
  });
});

describe('resolveContributorId (SPEC §8)', () => {
  it('prefers a local ID over a global one', () => {
    const root = repository();
    localConfig(root, '{"contributor":{"id":"local@x"}}');
    const home = homeWith('{"contributor":{"id":"global@x"}}');
    assert.equal(resolveContributorId(root, { HOME: home }), 'local@x');
  });

  it('falls back to the global file when the local one provides no ID', () => {
    const root = repository();
    localConfig(root, '{}');
    const home = homeWith('{"contributor":{"id":"global@x"}}');
    assert.equal(resolveContributorId(root, { HOME: home }), 'global@x');
  });

  it('is undefined when neither level names an ID', () => {
    const root = repository();
    assert.equal(resolveContributorId(root, { HOME: homeWith(undefined) }), undefined);
  });

  it('does not need HOME when the local file provides the ID', () => {
    const root = repository();
    localConfig(root, '{"contributor":{"id":"local@x"}}');
    assert.equal(resolveContributorId(root, {}), 'local@x');
  });

  it('treats an absent or empty HOME as global-unavailable', () => {
    const root = repository();
    assert.equal(resolveContributorId(root, {}), undefined);
    assert.equal(resolveContributorId(root, { HOME: '' }), undefined);
  });

  it('throws on a malformed file at whichever level is read', () => {
    const root = repository();
    localConfig(root, 'not json');
    assert.throws(() => resolveContributorId(root, { HOME: homeWith(undefined) }), {
      message: /^invalid JSON: /,
    });

    const cleanRoot = repository();
    assert.throws(() => resolveContributorId(cleanRoot, { HOME: homeWith('not json') }), {
      message: /^invalid JSON: /,
    });
  });
});

describe('encodeConfiguration', () => {
  it('writes the canonical two-space shape with a trailing LF', () => {
    assert.equal(encodeConfiguration('a@x'), '{\n  "contributor": {\n    "id": "a@x"\n  }\n}\n');
  });

  it('round-trips through decodeConfiguration', () => {
    assert.deepEqual(decodeConfiguration(encodeConfiguration('local@x')), {
      contributorId: 'local@x',
    });
  });
});
