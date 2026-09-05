import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { encodeUtf8 } from '../core/bytes.ts';
import { SnapError } from '../core/errors.ts';

import {
  ancestorPaths,
  assertPrefixFree,
  namespaceConflicts,
  sortedPaths,
  type Tree,
} from './tree.ts';

/** A tree built from `[path, text]` pairs; insertion order is deliberately caller-chosen. */
function treeOf(...entries: readonly (readonly [string, string])[]): Tree {
  return new Map(entries.map(([path, text]) => [path, encodeUtf8(text)]));
}

describe('sortedPaths', () => {
  it('orders by UTF-8 bytes, not insertion order or UTF-16 code units', () => {
    // U+FF01 encodes after U+1F600 (UTF-8 byte order) even though it compares before it as
    // UTF-16 code units; `a` sorts before both and before its own extension `a/b`.
    const tree = treeOf(['\u{1F600}', 'grinning'], ['\uFF01', 'bang'], ['a/b', 'x'], ['a', 'y']);
    assert.deepEqual(sortedPaths(tree), ['a', 'a/b', '\uFF01', '\u{1F600}']);
  });

  it('returns an empty array for the empty tree', () => {
    assert.deepEqual(sortedPaths(treeOf()), []);
  });
});

describe('ancestorPaths', () => {
  const cases: readonly (readonly [string, readonly string[]])[] = [
    ['f', []],
    ['a', []],
    ['a/b', ['a']],
    ['a/b/c', ['a', 'a/b']],
    ['sub/.snap/x', ['sub', 'sub/.snap']],
  ];

  for (const [path, expected] of cases) {
    it(`yields ${JSON.stringify(expected)} for ${JSON.stringify(path)}`, () => {
      assert.deepEqual(ancestorPaths(path), expected);
    });
  }
});

describe('namespaceConflicts', () => {
  it('returns nothing for a path with no present ancestor or descendant', () => {
    // `c` sits beside `a/b`, not inside or above it, and `q` is absent entirely; neither has a
    // conflict in this tree, and `a/b`'s own presence does not conflict with itself.
    assert.deepEqual(namespaceConflicts(treeOf(['a/b', 'x'], ['c', 'y'], ['a/b/c', 'z']), 'a/b'), [
      'a/b/c',
    ]);
    assert.deepEqual(namespaceConflicts(treeOf(['a/b', 'x'], ['c', 'y']), 'q'), []);
  });

  it('finds a present ancestor', () => {
    assert.deepEqual(namespaceConflicts(treeOf(['a', 'x'], ['b', 'y']), 'a/b'), ['a']);
  });

  it('finds present descendants', () => {
    assert.deepEqual(
      namespaceConflicts(treeOf(['a/b/c', 'x'], ['a/b/d', 'y'], ['b', 'z']), 'a/b'),
      ['a/b/c', 'a/b/d'],
    );
  });

  it('combines ancestors and descendants in byte order', () => {
    assert.deepEqual(
      namespaceConflicts(
        treeOf(['a/b/c/d', 'w'], ['a', 'x'], ['a/b/c', 'y'], ['a/b/x', 'z'], ['b', 'q']),
        'a/b',
      ),
      ['a', 'a/b/c', 'a/b/c/d', 'a/b/x'],
    );
  });
});

describe('assertPrefixFree', () => {
  it('accepts siblings, unrelated paths, and the empty tree', () => {
    assert.doesNotThrow(() => {
      assertPrefixFree(treeOf(['a/b', 'x'], ['a/c', 'y'], ['d', 'z']));
      assertPrefixFree(treeOf());
    });
  });

  it('rejects a file tracked alongside its descendant with the suite-pinned message', () => {
    assert.throws(
      () => {
        assertPrefixFree(treeOf(['a', 'x'], ['a/b', 'y']));
      },
      { message: 'tree paths conflict: a and a/b' },
    );
  });

  it('reports the shortest ancestor of a deeper descendant', () => {
    assert.throws(
      () => {
        assertPrefixFree(treeOf(['a', 'x'], ['a/b/c', 'y']));
      },
      { message: 'tree paths conflict: a and a/b/c' },
    );
  });

  it('reports the same pair regardless of insertion order', () => {
    assert.throws(
      () => {
        assertPrefixFree(treeOf(['a/b', 'y'], ['a', 'x']));
      },
      { message: 'tree paths conflict: a and a/b' },
    );
  });

  it('throws SnapError, not a bare Error', () => {
    assert.throws(() => {
      assertPrefixFree(treeOf(['a', 'x'], ['a/b', 'y']));
    }, SnapError);
  });
});
