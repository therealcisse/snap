/**
 * Versions (SPEC §3): vector clocks from contributor ID to that contributor's latest revision.
 *
 * A version is represented as a sorted array of `[id, revision]` pairs rather than a `Map` so that
 * comparison, join, and Snap order are each one merge-walk over two sorted arrays, and so that the
 * JSON form (SPEC §3.2) is the same shape. JavaScript collections compare arrays by reference, so
 * anything keyed by a version must use `versionKey`.
 */
import { compareBytes } from './bytes.ts';
import { SnapError } from './errors.ts';

/** An ASCII email-shaped contributor ID that has passed `isValidContributorId` (SPEC §3.1). */
export type ContributorId = string;

/**
 * A vector clock: `[id, revision]` pairs strictly ascending by `compareBytes` on the ID, every
 * revision a positive safe integer. A contributor with no revision is absent, never zero.
 */
export type Version = readonly (readonly [ContributorId, number])[];

/** The version of the empty tree, written `()` (SPEC §1). */
export const EMPTY_VERSION: Version = [];

/** The four causal outcomes of SPEC §3.3; `concurrent` is neither before nor after. */
export type Comparison = 'equal' | 'before' | 'after' | 'concurrent';

/** Largest revision, `Number.MAX_SAFE_INTEGER`, as decimal text for textual overflow checks. */
const MAX_REVISION_TEXT = String(Number.MAX_SAFE_INTEGER);

/**
 * Whether `id` is a valid contributor ID (SPEC §3.1): at most 254 bytes; exactly one `@` with
 * nonempty text on both sides; no control character, whitespace, `,`, `(`, `)`, or `->`.
 */
export function isValidContributorId(id: string): boolean {
  if (id.length === 0 || id.length > 254) {
    return false;
  }
  // The visible-ASCII range 0x21–0x7E excludes control characters, space, DEL, and every non-ASCII
  // code unit in one comparison; the spec's "ASCII email-shaped" wording admits nothing else.
  for (let i = 0; i < id.length; i += 1) {
    const unit = id.charCodeAt(i);
    if (unit < 0x21 || unit > 0x7e || unit === 0x2c || unit === 0x28 || unit === 0x29) {
      return false;
    }
  }
  const at = id.indexOf('@');
  return at > 0 && at < id.length - 1 && !id.includes('@', at + 1) && !id.includes('->');
}

/**
 * Parses the canonical CLI form (SPEC §3.2): `()` or `(id->n,id->n)` with IDs strictly ascending in
 * byte order, no whitespace, and revisions written without sign, leading zero, or overflow.
 *
 * Throws `SnapError('invalid version: <text>')` for any deviation, quoting the input verbatim.
 */
export function parseVersion(text: string): Version {
  const fail = (): never => {
    throw new SnapError(`invalid version: ${text}`);
  };
  if (text.length < 2 || !text.startsWith('(') || !text.endsWith(')')) {
    return fail();
  }
  const inner = text.slice(1, -1);
  if (inner.length === 0) {
    return EMPTY_VERSION;
  }
  const components: [ContributorId, number][] = [];
  for (const component of inner.split(',')) {
    // The ID cannot contain `->`, so the last arrow is the only possible separator.
    const arrow = component.lastIndexOf('->');
    if (arrow === -1) {
      return fail();
    }
    const id = component.slice(0, arrow);
    const revision = parseRevision(component.slice(arrow + 2));
    if (!isValidContributorId(id) || revision === undefined) {
      return fail();
    }
    const previous = components.at(-1);
    if (previous !== undefined && compareBytes(previous[0], id) >= 0) {
      return fail();
    }
    components.push([id, revision]);
  }
  return components;
}

/**
 * Parses a revision from its canonical decimal text, or returns `undefined` when the text is not
 * a positive safe integer written without sign or leading zero.
 */
function parseRevision(text: string): number | undefined {
  if (!/^[1-9][0-9]*$/.test(text)) {
    return undefined;
  }
  // Compare as text: `Number('9007199254740992')` rounds to a value `isSafeInteger` still rejects,
  // but longer lexemes round unpredictably, so the bound is applied before conversion.
  const tooLarge =
    text.length > MAX_REVISION_TEXT.length ||
    (text.length === MAX_REVISION_TEXT.length && text > MAX_REVISION_TEXT);
  return tooLarge ? undefined : Number(text);
}

/** Formats a version in the canonical CLI form (SPEC §3.2). */
export function formatVersion(version: Version): string {
  return `(${version.map(([id, revision]) => `${id}->${String(revision)}`).join(',')})`;
}

/** The canonical string of a version, for use as a `Map` or `Set` key. */
export function versionKey(version: Version): string {
  return formatVersion(version);
}

/** The revision of `id` in `version`, or 0 when absent (SPEC §3.3). */
export function componentOf(version: Version, id: ContributorId): number {
  for (const [candidate, revision] of version) {
    const order = compareBytes(candidate, id);
    if (order === 0) {
      return revision;
    }
    if (order > 0) {
      break;
    }
  }
  return 0;
}

/**
 * Walks the sorted union of both versions' contributors, yielding each ID with its revision on
 * each side; an absent contributor reads as 0 (SPEC §3.3). Every version operation is one pass
 * over this sequence.
 */
function* alignedComponents(
  a: Version,
  b: Version,
): Generator<readonly [ContributorId, number, number]> {
  let i = 0;
  let j = 0;
  while (i < a.length || j < b.length) {
    const left = a[i];
    const right = b[j];
    if (right === undefined || (left !== undefined && compareBytes(left[0], right[0]) < 0)) {
      // `left` is defined: the loop condition rules out both sides being exhausted.
      const [id, revision] = left as readonly [ContributorId, number];
      yield [id, revision, 0];
      i += 1;
    } else if (left === undefined || compareBytes(left[0], right[0]) > 0) {
      yield [right[0], 0, right[1]];
      j += 1;
    } else {
      yield [left[0], left[1], right[1]];
      i += 1;
      j += 1;
    }
  }
}

/** Causal comparison of two versions with all four outcomes preserved (SPEC §3.3). */
export function compareVersions(a: Version, b: Version): Comparison {
  let aExceeds = false;
  let bExceeds = false;
  for (const [, ra, rb] of alignedComponents(a, b)) {
    aExceeds ||= ra > rb;
    bExceeds ||= ra < rb;
    if (aExceeds && bExceeds) {
      return 'concurrent';
    }
  }
  if (aExceeds) {
    return 'after';
  }
  return bExceeds ? 'before' : 'equal';
}

/** The componentwise maximum of two versions (SPEC §3.3). */
export function joinVersions(a: Version, b: Version): Version {
  const joined: [ContributorId, number][] = [];
  for (const [id, ra, rb] of alignedComponents(a, b)) {
    joined.push([id, Math.max(ra, rb)]);
  }
  return joined;
}

/**
 * The Snap order (SPEC §3.4): a total order that extends causal order, used only to sequence
 * concurrent patches. Over the sorted union of contributor IDs, the first unequal counter decides.
 *
 * Returns a negative number, zero, or a positive number; zero means the versions are equal.
 */
export function snapOrder(a: Version, b: Version): number {
  for (const [, ra, rb] of alignedComponents(a, b)) {
    if (ra !== rb) {
      return ra < rb ? -1 : 1;
    }
  }
  return 0;
}

/**
 * Builds a version from the JSON pair form (SPEC §3.2), validating each ID and revision and the
 * strict ascending byte order that makes the encoding canonical.
 *
 * `path` names the value being decoded (for example `repository.frontier`) and prefixes every
 * error except the contributor-ID one, whose wording the acceptance suite pins.
 */
export function versionFromPairs(
  pairs: readonly (readonly [string, number])[],
  path: string,
): Version {
  const version: [ContributorId, number][] = [];
  for (const [index, [id, revision]] of pairs.entries()) {
    if (!isValidContributorId(id)) {
      throw new SnapError(`invalid contributor id: ${id}`);
    }
    if (!Number.isSafeInteger(revision) || revision < 1) {
      throw new SnapError(`${path}[${String(index)}][1] must be a positive safe integer`);
    }
    const previous = version.at(-1);
    if (previous !== undefined && compareBytes(previous[0], id) >= 0) {
      throw new SnapError(`${path} is not in canonical order`);
    }
    version.push([id, revision]);
  }
  return version;
}
