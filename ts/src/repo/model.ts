/**
 * The repository value (SPEC §4): patches, their changes, and the `repository.json` codec.
 *
 * `decodeRepository` performs step 1 of SPEC §4.5 — exact schema plus the field-level rules for
 * versions, IDs, paths, messages, and changes. Everything that needs more than one patch or a
 * materialized tree (sorting across patches, dot uniqueness, base closure, change applicability,
 * replay) belongs to `repo/validate.ts` and `repo/replay.ts`, so a decoded `Repository` is
 * well-formed but not yet known to be valid. `encodeRepository` and `encodePatch` are the exact
 * inverses: canonical text for storage, compact JSON for structural patch equality (SPEC §4.2).
 */
import { compareBytes, decodeBase64, encodeBase64, isValidTrackedPath } from '../core/bytes.ts';
import { SnapError } from '../core/errors.ts';
import { JsonCursor, parseJson } from '../core/json.ts';
import {
  type ContributorId,
  type Version,
  EMPTY_VERSION,
  isValidContributorId,
  versionFromPairs,
  versionKey,
} from '../core/version.ts';
import { type EditOp } from '../text/edit.ts';

/** Creates a text file or edits one in place (SPEC §4.3). An empty `edit` creates an empty file. */
export interface TextChange {
  readonly type: 'text';
  readonly path: string;
  readonly edit: readonly EditOp[];
}

/** Atomically creates or replaces a file with exact bytes (SPEC §4.3). */
export interface PutChange {
  readonly type: 'put';
  readonly path: string;
  readonly content: Uint8Array;
}

/** Removes a file that is present in the patch's base tree (SPEC §4.3). */
export interface DeleteChange {
  readonly type: 'delete';
  readonly path: string;
}

export type Change = TextChange | PutChange | DeleteChange;

/**
 * One authored change set (SPEC §4.2). Its dot is `(author, revision)`; its result version is
 * `base` with the author's component set to `revision`.
 */
export interface Patch {
  readonly author: ContributorId;
  readonly revision: number;
  readonly base: Version;
  readonly message: string;
  /** Sorted by path in byte order with at most one change per path. */
  readonly changes: readonly Change[];
}

/** The complete persisted repository value (SPEC §4.1). */
export interface Repository {
  readonly format: 1;
  readonly frontier: Version;
  readonly patches: readonly Patch[];
}

/**
 * The canonical text `init` writes (SPEC §4.1, §7.1): an empty repository, two-space indent,
 * trailing LF. Spelled as a literal rather than built by the encoder so the exact bytes are
 * auditable in one place; `model.test.ts` pins `encodeRepository` of the empty repository to
 * this literal so spec, encoder, and decoder can never drift apart.
 */
export const EMPTY_REPOSITORY_JSON = '{\n  "format": 1,\n  "frontier": [],\n  "patches": []\n}\n';

/**
 * Every version this repository locally knows, as `versionKey` strings: the empty tree's `()`
 * plus each patch's result version (SPEC §4.2, §7.6). Commands use it to reject operands naming
 * versions no patch ever produced.
 */
export function knownVersionKeys(repository: Repository): ReadonlySet<string> {
  const keys = new Set<string>([versionKey(EMPTY_VERSION)]);
  for (const patch of repository.patches) {
    keys.add(versionKey(resultVersion(patch)));
  }
  return keys;
}

const CHANGE_TYPES = ['text', 'put', 'delete'] as const;

/**
 * Decodes the text of `repository.json` (SPEC §4.1) with an exact schema.
 *
 * Throws `SnapError` naming the offending value by its dotted path (for example
 * `repository.patches[0].revision must be a positive safe integer`), except for the three
 * messages whose wording the acceptance suite fixes without a path: `invalid contributor id: <id>`,
 * `path is invalid: <path>`, and `content is not canonical base64`.
 */
export function decodeRepository(text: string): Repository {
  const root = new JsonCursor(parseJson(text, 'repository'), 'repository').object();
  root.field('format').integerEqual(1);
  const frontier = decodeVersion(root.field('frontier'));
  const patches = root.field('patches').array().map(decodePatch);
  root.finishObject();
  return { format: 1, frontier, patches };
}

function decodePatch(cursor: JsonCursor): Patch {
  cursor.object();
  const author = cursor.field('author').string();
  if (!isValidContributorId(author)) {
    throw new SnapError(`invalid contributor id: ${author}`);
  }
  const revision = cursor.field('revision').positiveSafeInteger();
  const base = decodeVersion(cursor.field('base'));
  const message = decodeMessage(cursor.field('message'));
  const changes = decodeChanges(cursor.field('changes'));
  cursor.finishObject();
  return { author, revision, base, message, changes };
}

/** SPEC §3.2 JSON form: an array of `[id, revision]` pairs in canonical order. */
function decodeVersion(cursor: JsonCursor): Version {
  const pairs = cursor.array().map((pair): readonly [string, number] => {
    const parts = pair.array();
    if (parts.length !== 2) {
      throw new SnapError(`${pair.path} must be an [id, revision] pair`);
    }
    // Both defined: length is exactly 2.
    const [id, revision] = parts as [JsonCursor, JsonCursor];
    return [id.string(), revision.positiveSafeInteger()];
  });
  return versionFromPairs(pairs, cursor.path);
}

/** SPEC §4.2: nonempty; tab and LF are the only ASCII control characters permitted. */
function decodeMessage(cursor: JsonCursor): string {
  const message = cursor.nonEmptyString();
  for (let i = 0; i < message.length; i += 1) {
    const unit = message.charCodeAt(i);
    if ((unit < 0x20 && unit !== 0x09 && unit !== 0x0a) || unit === 0x7f) {
      throw new SnapError(`${cursor.path} has an invalid control character`);
    }
  }
  return message;
}

/** SPEC §4.2: nonempty, strictly ascending by path in byte order. */
function decodeChanges(cursor: JsonCursor): readonly Change[] {
  const changes = cursor.array().map(decodeChange);
  if (changes.length === 0) {
    throw new SnapError(`${cursor.path} is empty`);
  }
  for (let i = 1; i < changes.length; i += 1) {
    // Both defined: `i` ranges over valid indices from 1.
    const [previous, current] = [changes[i - 1], changes[i]] as [Change, Change];
    if (compareBytes(previous.path, current.path) >= 0) {
      throw new SnapError(`${cursor.path} are not sorted by path`);
    }
  }
  return changes;
}

function decodeChange(cursor: JsonCursor): Change {
  cursor.object();
  const type = cursor.field('type').literal(CHANGE_TYPES);
  const path = cursor.field('path').string();
  if (!isValidTrackedPath(path)) {
    throw new SnapError(`path is invalid: ${path}`);
  }
  let change: Change;
  switch (type) {
    case 'text':
      change = { type, path, edit: cursor.field('edit').array().map(decodeEditOp) };
      break;
    case 'put':
      change = { type, path, content: decodeBase64(cursor.field('content').string()) };
      break;
    case 'delete':
      change = { type, path };
      break;
  }
  cursor.finishObject();
  return change;
}

/** SPEC §4.4: exactly one of `retain`, `delete`, or `insert`. */
function decodeEditOp(cursor: JsonCursor): EditOp {
  cursor.object();
  if (cursor.keyCount() !== 1) {
    throw new SnapError(`${cursor.path} must have one operation`);
  }
  const retain = cursor.optionalField('retain');
  if (retain !== undefined) {
    return { retain: retain.positiveSafeInteger() };
  }
  const del = cursor.optionalField('delete');
  if (del !== undefined) {
    return { delete: del.positiveSafeInteger() };
  }
  const insert = cursor.optionalField('insert');
  if (insert !== undefined) {
    const tokens = insert.array().map((token) => token.nonEmptyString());
    if (tokens.length === 0) {
      throw new SnapError(`${insert.path} is empty`);
    }
    return { insert: tokens };
  }
  cursor.finishObject();
  // Unreachable: the object has exactly one key and `finishObject` has just rejected it as
  // unknown. Stated for the type checker.
  throw new SnapError(`${cursor.path} must have one operation`);
}

// Canonical encoding (SPEC §4.1). A decoded `Repository` is already canonical — version pairs
// ascending in byte order, changes sorted and deduplicated by path, base64 canonical — so
// encoding is a faithful walk over the typed value with the spec's field order fixed by
// construction: `JSON.stringify` writes object properties in insertion order, so the shapes
// below are the bytes on disk.

/** The JSON forms the encoders build and `JSON.stringify` serializes. */
type JsonValue =
  string | number | boolean | null | readonly JsonValue[] | { readonly [key: string]: JsonValue };

/** SPEC §3.2 JSON form of a version: `[id, revision]` pairs in canonical order. */
function versionValue(version: Version): JsonValue {
  return version.map(([id, revision]): JsonValue => [id, revision]);
}

function changeValue(change: Change): JsonValue {
  switch (change.type) {
    case 'text':
      return { type: change.type, path: change.path, edit: change.edit.map((op): JsonValue => op) };
    case 'put':
      return { type: change.type, path: change.path, content: encodeBase64(change.content) };
    case 'delete':
      return { type: change.type, path: change.path };
  }
}

function patchValue(patch: Patch): JsonValue {
  return {
    author: patch.author,
    revision: patch.revision,
    base: versionValue(patch.base),
    message: patch.message,
    changes: patch.changes.map(changeValue),
  };
}

/**
 * Encodes one patch in its compact JSON form: the unit of structural patch equality (SPEC §4.2)
 * and the natural form for logs and diagnostics. Compare with `===` after `encodePatch` on both
 * sides; two structurally equal patches from different decode runs compare unequal as objects.
 */
export function encodePatch(patch: Patch): string {
  return JSON.stringify(patchValue(patch));
}

/**
 * Encodes the canonical text of `repository.json` (SPEC §4.1): two-space indent and a trailing
 * LF — exactly the text `decodeRepository` accepts, byte for byte, for any well-formed
 * repository. `init` writes this of the empty repository, matching `EMPTY_REPOSITORY_JSON`.
 */
export function encodeRepository(repository: Repository): string {
  return (
    JSON.stringify(
      {
        format: repository.format,
        frontier: versionValue(repository.frontier),
        patches: repository.patches.map(patchValue),
      },
      null,
      2,
    ) + '\n'
  );
}

/**
 * A patch's result version (SPEC §4.2): its base with the author's component set to `revision`,
 * in the sorted pair-array shape of a `Version`. The author's prior component, if present, is
 * replaced in place rather than duplicated.
 */
export function resultVersion(patch: Patch): Version {
  const pairs: (readonly [ContributorId, number])[] = [];
  let placed = false;
  for (const [id, revision] of patch.base) {
    if (!placed && compareBytes(id, patch.author) >= 0) {
      pairs.push([patch.author, patch.revision]);
      placed = true;
    }
    if (compareBytes(id, patch.author) !== 0) {
      pairs.push([id, revision]);
    }
  }
  if (!placed) {
    pairs.push([patch.author, patch.revision]);
  }
  return pairs;
}
