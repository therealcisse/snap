import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import fc from 'fast-check';

import { compareBytes } from './bytes.ts';
import {
  EMPTY_VERSION,
  type Version,
  compareVersions,
  componentOf,
  formatVersion,
  isValidContributorId,
  joinVersions,
  parseVersion,
  snapOrder,
  versionFromPairs,
  versionKey,
} from './version.ts';

/** Versions over a small contributor pool so that concurrency and equality both occur. */
const versionArb: fc.Arbitrary<Version> = fc
  .uniqueArray(
    fc.tuple(fc.constantFrom('a@x', 'b@x', 'c@x', 'z@x'), fc.integer({ min: 1, max: 4 })),
    { selector: ([id]) => id, maxLength: 4 },
  )
  .map((pairs) => pairs.toSorted(([a], [b]) => compareBytes(a, b)));

describe('isValidContributorId', () => {
  const cases: readonly (readonly [string, boolean])[] = [
    ['a@x', true],
    ['jdegoes@example.com', true],
    ['two@@x', false],
    ['space @x', false],
    ['a,b@x', false],
    ['a(b)@x', false],
    ['a->b@x', false],
    ['@x', false],
    ['a@', false],
    ['ax', false],
    ['a\tb@x', false],
    ['é@x', false],
    [`${'a'.repeat(252)}@x`, true],
    [`${'a'.repeat(253)}@x`, false],
  ];

  for (const [id, expected] of cases) {
    it(`${expected ? 'accepts' : 'rejects'} ${JSON.stringify(id)}`, () => {
      assert.equal(isValidContributorId(id), expected);
    });
  }
});

describe('parseVersion and formatVersion', () => {
  it('round-trips the empty version', () => {
    assert.deepEqual(parseVersion('()'), EMPTY_VERSION);
    assert.equal(formatVersion(EMPTY_VERSION), '()');
  });

  it('round-trips a two-contributor version', () => {
    const text = '(jdegoes@example.com->2323,vigoo@example.com->239)';
    const version = parseVersion(text);
    assert.deepEqual(version, [
      ['jdegoes@example.com', 2323],
      ['vigoo@example.com', 239],
    ]);
    assert.equal(formatVersion(version), text);
    assert.equal(versionKey(version), text);
  });

  it('accepts the largest safe revision', () => {
    assert.deepEqual(parseVersion('(a@x->9007199254740991)'), [['a@x', 9007199254740991]]);
  });

  const rejected = [
    '(a@x->01)',
    '(a@x->0)',
    '(a@x->-1)',
    '(a@x->9007199254740992)',
    '(a@x->99999999999999999999)',
    '(a@x->1,a@x->2)',
    '(b@x->1,a@x->1)',
    '(a@x->1, b@x->1)',
    'a@x->1',
    '(a@@x->1)',
    '(a@x->)',
    '(a@x)',
    '(,)',
    '',
    '(',
  ];

  for (const text of rejected) {
    it(`rejects ${JSON.stringify(text)} quoting the input`, () => {
      assert.throws(() => parseVersion(text), { message: `invalid version: ${text}` });
    });
  }

  it('formats what it parses for every generated version', () => {
    fc.assert(
      fc.property(versionArb, (version) => {
        assert.deepEqual(parseVersion(formatVersion(version)), version);
      }),
    );
  });
});

describe('componentOf', () => {
  it('reads a present component and zero for an absent one', () => {
    const version = parseVersion('(a@x->3,c@x->1)');
    assert.equal(componentOf(version, 'a@x'), 3);
    assert.equal(componentOf(version, 'b@x'), 0);
    assert.equal(componentOf(version, 'c@x'), 1);
    assert.equal(componentOf(version, 'z@x'), 0);
  });
});

describe('compareVersions', () => {
  it('distinguishes all four outcomes', () => {
    const a1 = parseVersion('(a@x->1)');
    const a1b1 = parseVersion('(a@x->1,b@x->1)');
    const b1 = parseVersion('(b@x->1)');
    assert.equal(compareVersions(a1, a1), 'equal');
    assert.equal(compareVersions(a1, a1b1), 'before');
    assert.equal(compareVersions(a1b1, a1), 'after');
    assert.equal(compareVersions(a1, b1), 'concurrent');
    assert.equal(compareVersions(EMPTY_VERSION, a1), 'before');
    assert.equal(compareVersions(a1, EMPTY_VERSION), 'after');
  });

  it('is antisymmetric', () => {
    const converse = { equal: 'equal', before: 'after', after: 'before', concurrent: 'concurrent' };
    fc.assert(
      fc.property(versionArb, versionArb, (a, b) => {
        assert.equal(compareVersions(b, a), converse[compareVersions(a, b)]);
      }),
    );
  });
});

describe('joinVersions', () => {
  it('takes the componentwise maximum', () => {
    assert.deepEqual(
      joinVersions(parseVersion('(a@x->2,b@x->1)'), parseVersion('(b@x->3,c@x->1)')),
      parseVersion('(a@x->2,b@x->3,c@x->1)'),
    );
  });

  it('is idempotent, commutative, and associative', () => {
    fc.assert(
      fc.property(versionArb, versionArb, versionArb, (a, b, c) => {
        assert.deepEqual(joinVersions(a, a), a);
        assert.deepEqual(joinVersions(a, b), joinVersions(b, a));
        assert.deepEqual(joinVersions(joinVersions(a, b), c), joinVersions(a, joinVersions(b, c)));
      }),
    );
  });

  it('is an upper bound of both arguments', () => {
    fc.assert(
      fc.property(versionArb, versionArb, (a, b) => {
        const joined = joinVersions(a, b);
        assert.ok(['equal', 'after'].includes(compareVersions(joined, a)));
        assert.ok(['equal', 'after'].includes(compareVersions(joined, b)));
      }),
    );
  });
});

describe('snapOrder', () => {
  it('decides concurrent versions at the first contributor in byte order', () => {
    assert.ok(snapOrder(parseVersion('(a@x->1)'), parseVersion('(b@x->1)')) > 0);
    assert.ok(snapOrder(parseVersion('(b@x->1)'), parseVersion('(a@x->1)')) < 0);
    assert.equal(snapOrder(parseVersion('(a@x->1)'), parseVersion('(a@x->1)')), 0);
  });

  it('extends causal order', () => {
    fc.assert(
      fc.property(versionArb, versionArb, (a, b) => {
        const causal = compareVersions(a, b);
        const order = snapOrder(a, b);
        if (causal === 'before') assert.ok(order < 0);
        if (causal === 'after') assert.ok(order > 0);
        if (causal === 'equal') assert.equal(order, 0);
        if (causal === 'concurrent') assert.notEqual(order, 0);
      }),
    );
  });

  it('is antisymmetric and transitive', () => {
    fc.assert(
      fc.property(versionArb, versionArb, versionArb, (a, b, c) => {
        assert.equal(Math.sign(snapOrder(a, b)) + Math.sign(snapOrder(b, a)), 0);
        if (snapOrder(a, b) <= 0 && snapOrder(b, c) <= 0) {
          assert.ok(snapOrder(a, c) <= 0);
        }
      }),
    );
  });
});

describe('versionFromPairs', () => {
  it('builds a version from canonical pairs', () => {
    assert.deepEqual(
      versionFromPairs(
        [
          ['a@x', 1],
          ['b@x', 2],
        ],
        'repository.frontier',
      ),
      parseVersion('(a@x->1,b@x->2)'),
    );
  });

  it('reports misordered and duplicate contributors as non-canonical', () => {
    assert.throws(
      () =>
        versionFromPairs(
          [
            ['b@x', 1],
            ['a@x', 1],
          ],
          'repository.frontier',
        ),
      { message: 'repository.frontier is not in canonical order' },
    );
    assert.throws(
      () =>
        versionFromPairs(
          [
            ['a@x', 1],
            ['a@x', 2],
          ],
          'repository.patches[0].base',
        ),
      { message: 'repository.patches[0].base is not in canonical order' },
    );
  });

  it('rejects an invalid contributor ID and a non-positive revision', () => {
    assert.throws(() => versionFromPairs([['bad', 1]], 'repository.frontier'), {
      message: 'invalid contributor id: bad',
    });
    assert.throws(() => versionFromPairs([['a@x', 0]], 'repository.frontier'), {
      message: 'repository.frontier[0][1] must be a positive safe integer',
    });
  });
});
