/**
 * Property tests for replay convergence (SPEC §11, §6.5): random valid causal patch graphs
 * must produce the same joined frontier, patch set, warning set, and tree bytes under any
 * import permutation.
 *
 * The generator interprets a tape of small integers as an incremental history — each patch
 * picks a base among the reached versions that carry its author's whole prior chain (the
 * §4.2 revision rule), then authors one change against that base's materialized tree — so
 * every §4.5 rule holds by construction and samples exercise concurrent shapes instead of
 * dying in validation. Permutation invariance is asserted below `validateRepository`: the
 * stored array must be sorted (§4.5 step 2), so a permuted array models the order patches
 * arrive by import, which §6.5 says must not matter.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import fc from 'fast-check';

import { compareBytes, decodeUtf8, encodeUtf8, isText } from '../core/bytes.ts';
import {
  EMPTY_VERSION,
  type Version,
  componentOf,
  joinVersions,
  versionKey,
} from '../core/version.ts';
import { diffTokens } from '../text/diff.ts';
import { tokenize } from '../text/tokens.ts';

import {
  type Change,
  type Patch,
  type Repository,
  encodePatch,
  resultVersion,
  withPatch,
} from './model.ts';
import { materializeVersion, replayRepository } from './replay.ts';
import { equalBytes, namespaceConflicts, sortedPaths } from './tree.ts';
import { validateRepository } from './validate.ts';

/** A generated history: patches in §4.5 step-2 canonical order, plus the frontier they join to. */
interface CausalGraph {
  readonly patches: readonly Patch[];
  readonly frontier: Version;
}

const AUTHORS = ['a@x', 'b@x', 'c@x'];
/**
 * Flat and nested paths share one pool so concurrent creates collide on the same path — the
 * collisions are the point: they drive §6.2's rules and §6.4's warnings.
 */
const CREATION_POOL = ['f0.txt', 'f1.txt', 'f2.txt', 'f3.txt', 'n/a', 'n/b', 'n/c'];
const TOKEN_POOL = ['x\n', 'y\n', 'z\n'];
const BYTE_POOL = [encodeUtf8('b0'), encodeUtf8('b1')];
const MAX_PATCHES = 8;

const arbTape = fc.array(fc.integer({ min: 0, max: 63 }), { maxLength: 64 });
const arbKeys = fc.array(fc.integer({ min: 0, max: 63 }), { maxLength: MAX_PATCHES });

/**
 * Builds one valid causal graph by interpreting `tape` as a sequence of choices. Past the
 * tape's end every choice reads as 0, so the function stays a pure function of the tape —
 * fast-check shrinks tapes, and the same tape must always build the same graph.
 */
function buildGraph(tape: readonly number[]): CausalGraph {
  let cursor = 0;
  const next = (): number => {
    const value = tape[cursor];
    cursor += 1;
    return value ?? 0;
  };

  let repository: Repository = { format: 1, frontier: EMPTY_VERSION, patches: [] };
  const reached: Version[] = [EMPTY_VERSION];

  while (cursor < tape.length && repository.patches.length < MAX_PATCHES) {
    const author = AUTHORS[next() % AUTHORS.length]!;
    const maxRevision = repository.patches.filter((p) => p.author === author).length;
    // §4.2's revision rule pins revision = base's author component + 1, so eligible bases
    // are exactly the reached versions carrying the author's whole prior chain; picking
    // among them (not just the newest) is what creates concurrent branches.
    const eligible = reached.filter((v) => componentOf(v, author) === maxRevision);
    const base = eligible[next() % eligible.length]!;
    const baseTree = materializeVersion(repository, base);
    const change = authorChange(next, baseTree);
    if (change === undefined) {
      break;
    }
    const patch: Patch = {
      author,
      revision: maxRevision + 1,
      base,
      message: 'm',
      changes: [change],
    };
    repository = withPatch(repository, patch);
    reached.push(resultVersion(patch));
  }

  let frontier = EMPTY_VERSION;
  for (const patch of repository.patches) {
    frontier = joinVersions(frontier, resultVersion(patch));
  }
  return { patches: repository.patches, frontier };
}

/**
 * Authors one change that is valid against `baseTree`, or `undefined` when no change kind
 * has a legal target. §4.5 step 5 holds by construction: deletes only name present paths,
 * text edits only name text content and never reproduce it, creates only name absent paths
 * with no ancestor or descendant in the base, and overwrites only write differing bytes.
 */
function authorChange(
  next: () => number,
  baseTree: ReadonlyMap<string, Uint8Array>,
): Change | undefined {
  const present = sortedPaths(baseTree);
  const editable = present.filter((path) => isText(baseTree.get(path)!));
  const creatable = CREATION_POOL.filter(
    (path) => !baseTree.has(path) && namespaceConflicts(baseTree, path).length === 0,
  );
  const buckets: readonly (() => Change | undefined)[] = [
    (): Change | undefined => {
      if (creatable.length === 0) {
        return undefined;
      }
      const path = creatable[next() % creatable.length]!;
      if (next() % 2 === 0) {
        return {
          type: 'text',
          path,
          edit: [{ insert: [TOKEN_POOL[next() % TOKEN_POOL.length]!] }],
        };
      }
      return { type: 'put', path, content: BYTE_POOL[next() % BYTE_POOL.length]! };
    },
    (): Change | undefined => {
      if (editable.length === 0) {
        return undefined;
      }
      const path = editable[next() % editable.length]!;
      const tokens = tokenize(decodeUtf8(baseTree.get(path)!));
      const mutated = mutateTokens(next, tokens);
      // diffTokens authors the §5 canonical script, which consumes the base exactly — the
      // precondition applyEdit enforces — and never reproduces its input.
      return { type: 'text', path, edit: diffTokens(tokens, mutated) };
    },
    (): Change | undefined => {
      if (present.length === 0) {
        return undefined;
      }
      const path = present[next() % present.length]!;
      const candidate = BYTE_POOL[next() % BYTE_POOL.length]!;
      const current = baseTree.get(path)!;
      // §4.3 rejects a put that rewrites identical bytes; pick the other pool entry.
      const content = equalBytes(candidate, current)
        ? BYTE_POOL[(BYTE_POOL.indexOf(candidate) + 1) % BYTE_POOL.length]!
        : candidate;
      return { type: 'put', path, content };
    },
    (): Change | undefined => {
      if (present.length === 0) {
        return undefined;
      }
      return { type: 'delete', path: present[next() % present.length]! };
    },
  ];
  const start = next() % buckets.length;
  for (let offset = 0; offset < buckets.length; offset += 1) {
    const change = buckets[(start + offset) % buckets.length]!();
    if (change !== undefined) {
      return change;
    }
  }
  return undefined;
}

/** Mutates `tokens` into a strictly different token list, driven purely by `next`. */
function mutateTokens(next: () => number, tokens: readonly string[]): string[] {
  const token = TOKEN_POOL[next() % TOKEN_POOL.length]!;
  const kind = tokens.length === 0 ? 0 : next() % 3;
  if (kind === 0) {
    const at = next() % (tokens.length + 1);
    return [...tokens.slice(0, at), token, ...tokens.slice(at)];
  }
  if (kind === 1) {
    const at = next() % tokens.length;
    return [...tokens.slice(0, at), ...tokens.slice(at + 1)];
  }
  const at = next() % tokens.length;
  const replacement =
    token === tokens[at] ? TOKEN_POOL[(TOKEN_POOL.indexOf(token) + 1) % TOKEN_POOL.length]! : token;
  return [...tokens.slice(0, at), replacement, ...tokens.slice(at + 1)];
}

/** §4.1's storage order: author bytes ascending, then revision. */
function sortPatches(patches: readonly Patch[]): Patch[] {
  return [...patches].sort((a, b) => compareBytes(a.author, b.author) || a.revision - b.revision);
}

/**
 * A permutation of `0..n-1`: each position gets a generated priority, and sorting by it
 * (original index breaking ties) is a pure function of the keys.
 */
function permutationOf(n: number, keys: readonly number[]): number[] {
  return Array.from({ length: n }, (_, i) => i).sort(
    (a, b) => (keys[a] ?? 0) - (keys[b] ?? 0) || a - b,
  );
}

describe('replay properties (SPEC §11, §6.5)', () => {
  it('accepts every generated graph as a valid repository (§4.5)', () => {
    fc.assert(
      fc.property(arbTape, (tape) => {
        const graph = buildGraph(tape);
        // The generator's validity oracle: if construction ever lets a §4.5 rule slip, this
        // throws and the sample is a counterexample against the generator, not the core.
        validateRepository({ format: 1, frontier: graph.frontier, patches: graph.patches });
      }),
    );
  });

  it('joins the same frontier regardless of import order', () => {
    fc.assert(
      fc.property(arbTape, arbKeys, (tape, keys) => {
        const graph = buildGraph(tape);
        let joined = EMPTY_VERSION;
        for (const index of permutationOf(graph.patches.length, keys)) {
          joined = joinVersions(joined, resultVersion(graph.patches[index]!));
        }
        assert.equal(versionKey(joined), versionKey(graph.frontier));
      }),
    );
  });

  it('restores the same canonical patch set regardless of import order', () => {
    fc.assert(
      fc.property(arbTape, arbKeys, (tape, keys) => {
        const graph = buildGraph(tape);
        const permuted = permutationOf(graph.patches.length, keys).map(
          (index) => graph.patches[index]!,
        );
        assert.deepEqual(
          sortPatches(permuted).map(encodePatch),
          sortPatches(graph.patches).map(encodePatch),
        );
      }),
    );
  });

  it('replays import permutations to identical trees, warnings, and sequences', () => {
    fc.assert(
      fc.property(arbTape, arbKeys, (tape, keys) => {
        const graph = buildGraph(tape);
        const canonical = { format: 1 as const, frontier: graph.frontier, patches: graph.patches };
        const expected = replayRepository(canonical);
        const permuted = permutationOf(graph.patches.length, keys).map(
          (index) => graph.patches[index]!,
        );
        const actual = replayRepository({ format: 1, frontier: graph.frontier, patches: permuted });

        assert.deepEqual(sortedPaths(actual.tree), sortedPaths(expected.tree));
        for (const path of sortedPaths(expected.tree)) {
          assert.ok(equalBytes(actual.tree.get(path)!, expected.tree.get(path)!));
        }
        assert.deepEqual(actual.warnings, expected.warnings);
        assert.deepEqual(actual.sequence.map(encodePatch), expected.sequence.map(encodePatch));
      }),
    );
  });
});
