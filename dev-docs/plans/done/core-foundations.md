---
title: "Land the core primitives: byte order, versions, strict JSON with cursor, text detection, base64, and the repository and config decoders"
date: 2026-09-04
author: agent
id: core-foundations
issue: core-foundations
research:
  - snap-performance-and-data-structures
designs:
  - snap-ts-architecture
completed: 2026-09-04
closeout_notes: true
---

## Context

Issue `core-foundations`: `ts/src/core/` holds only `errors.ts`; every later stack section needs byte-order comparison, versions, a strict JSON reader, text detection, base64, and the two schema decoders, and the acceptance suites that pin their error texts cannot run. This plan lands all of them as pure, synchronous, dependency-free modules under `core/`, `repo/`, and `fs/`, with unit tests for every rejection the YAML harness cannot express, and settles the one spec gap (trailing content after a JSON value) before the reader depends on it. No command is wired; `./verify` remains all-failing.

## Current State

- `ts/src/`: `main.ts`, `cli/main.ts` (+test), `core/errors.ts` (+test; `SnapError`, `describeFailure`). No `core/bytes.ts`, `core/version.ts`, `core/json.ts`, `repo/`, or `fs/`.
- `ts/eslint.config.js` line 92: `src/core/json.ts` is the only file allowed `JSON.parse`; `localeCompare`, `toString('utf8')`, and non-fatal `TextDecoder` are banned in `src/**`.
- Design `snap-ts-architecture` decisions 1–4 fix representations: sorted `[id, revision][]` versions keyed by canonical string; one byte-order comparator; `Uint8Array` contents, text iff `isUtf8` and no NUL, `TextDecoder('utf-8', { fatal: true, ignoreBOM: true })`; single-pass strict JSON reader.
- Research `snap-performance-and-data-structures` "TypeScript and Node pitfalls" items 1–7 list the exact defaults being replaced and verifies `buffer.isUtf8`, `Buffer.compare`, and that `Uint8Array.fromBase64` is absent in Node 24.
- `SPEC.md` §4.1 lines 192–203 (JSON reading rules; no statement about trailing content), §8 lines 672–691 (config shape; "malformed file … is an error").
- `tests/03-configuration.yaml` line 70 spells `{"contributor":{"id":"global@example.com"}}}}`, but the harness interpolates `}}}}` as an escape for the literal `}}` (`TEST-HARNESS.md` line 82; `test-harness/src/interpolate.ts` line 16), so the candidate reads a well-formed value with no trailing bytes. No existing case exercises trailing content. Line 36 writes `not json` and expects `invalid JSON`; `tests/13-http-client.yaml` line 90 also expects `invalid JSON` for a bad body.
- Error texts pinned by the suite: `invalid version: .+` (25), `invalid contributor id: .+` (03, 25), `duplicate JSON key .+` (15, 25), `.+positive safe integer` (23 ×2, 30), `repository has unknown field: unknown` exact (23:24), `.+unknown field: extra` (23:162), `.*canonical.*` for non-canonical frontier order (23:40), `canonical base64` (15:96), `path is invalid` (15:72), `message is empty` / `changes is empty` / `must have one operation` / `insert is empty` (23), `invalid JSON` (03, 13).
- `test-harness/src/json.ts` is a reference for a key-tracking scanner shape; it must not be imported.

## Developer Feedback

- **One plan** (agent, uncontested): the six stack items plus two decoders share one reader and one comparator; splitting would leave the reader untested against a real schema.
- **Trailing content: strict** (user, revised during implementation): a JSON input is exactly one value; any non-whitespace byte after it is `invalid JSON`. The plan first chose lenient on the belief that `tests/03` line 70 wrote two extra braces and expected success; that fixture is the harness's `}}}}` → `}}` escape, so no public case bears on the question. Strict matches SPEC §8 ("a malformed file … is an error") and every mainstream JSON parser; SPEC §4.1 and §8 gain the sentence; `tests/32` pins the rule for `repository.json`. Rejected: lenient — its only justification was the misread fixture. Note for YAML fixtures: two literal extra braces must be spelled `}}}}}}}}`.
- **Reader shape: parser + cursor** (user): `parseJson` yields a tagged tree with lexeme-derived integer-ness; `JsonCursor` walks it with path tracking and owns all schema-error wording. Rejected: bare tree walked by hand (duplicated path strings and wording across three decoders); schema-driven single-pass parse (couples lexing to schemas, harder to unit-test duplicate-key and lexeme rules alone).
- **Tracked-path validity in `core/bytes.ts`** (user): a pure string rule alongside the comparator. Rejected: `core/path.ts` (one more file for two functions); `repo/model.ts` (forces `fs/worktree.ts` to import from `repo/`).
- **Error wording** (agent, confirmed): `invalid version: <input>`, `invalid contributor id: <input>`, `duplicate JSON key <key> at <path>`, `<path> must be a positive safe integer`, `path is invalid: <path>`, `invalid JSON: <reason>`, `repository has unknown field: <name>` at the root and `<path> has unknown field: <name>` nested, `content is not canonical base64`.
- **Integers as `number`** (agent): revisions and counts are ≤ 2^53 by spec; `BigInt` is unnecessary once the lexeme check runs before `Number()` and `Number.isSafeInteger` guards the magnitude (`Number.isSafeInteger(9007199254740992)` is false, so a lexeme of 2^53 or above is rejected even though `Number()` rounds it).

## Approach

### Step 1 — SPEC and regression case

`SPEC.md` §4.1 after "Readers accept ordinary JSON whitespace and object-key order." add: "A file or body is exactly one JSON value optionally surrounded by whitespace; a truncated value or any other byte after the value is malformed." §8 after the "A missing file means no value; a malformed file, …" sentence append: "Trailing bytes after the configuration value are malformed (§4.1)."

`tests/32-trailing-json-content.yaml` (format 1): init; write `repository.json` as a valid empty repository followed by two extra `}` (spelled `}}}}}}}}` in YAML because of the harness escape) and run `status` expecting exit 1, stdout empty, stderr matching `^snap: invalid JSON.*\n$`; write `repository.json` as `{"format":1,"frontier":[],"patches":[]` (truncated) and expect the same; write `not json` and expect the same; finally write a valid empty repository followed by `\n` and run `status` expecting exit 0, `version ()\n`, empty stderr (trailing whitespace is accepted). `description` states the alternative (lenient first-value reading) and why it was rejected.

### Step 2 — `src/core/bytes.ts`

```ts
/** Unsigned UTF-8 byte order (equals code-point order, RFC 3629). */
export function compareBytes(a: string, b: string): number  // codePointAt walk, no allocation
export function isText(bytes: Uint8Array): boolean           // buffer.isUtf8 && indexOf(0) === -1
export function decodeUtf8(bytes: Uint8Array): string        // TextDecoder('utf-8', { fatal: true, ignoreBOM: true })
export function encodeUtf8(text: string): Uint8Array         // TextEncoder
export function decodeBase64(text: string): Uint8Array       // throws SnapError('content is not canonical base64')
export function isValidTrackedPath(path: string): boolean    // §2 rules
```

`decodeBase64`: regex `^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$`, then `Buffer.from(text, 'base64')`, then `buf.toString('base64') === text` (round trip rejects `AR==`). Empty string decodes to zero bytes. `isValidTrackedPath`: nonempty; no code unit < 0x20, 0x7F, or `\\`; split on `/`, no segment empty, `.`, or `..`; first segment ≠ `.snap`.

### Step 3 — `src/core/version.ts`

```ts
export type ContributorId = string;                    // validated by isValidContributorId
export type Version = readonly (readonly [ContributorId, number])[];  // sorted by compareBytes, revisions ≥ 1
export const EMPTY_VERSION: Version = [];
export type Comparison = 'equal' | 'before' | 'after' | 'concurrent';
export function isValidContributorId(id: string): boolean  // §3.1
export function parseVersion(text: string): Version        // §3.2 CLI form; throws SnapError(`invalid version: ${text}`)
export function formatVersion(v: Version): string          // `()` or `(a@x->1,b@x->2)`
export function versionKey(v: Version): string             // alias of formatVersion for Map keys
export function compareVersions(a: Version, b: Version): Comparison
export function joinVersions(a: Version, b: Version): Version
export function snapOrder(a: Version, b: Version): number  // §3.4
export function componentOf(v: Version, id: ContributorId): number  // 0 when absent
export function versionFromPairs(pairs, at: (i) => string): Version // used by the JSON decoder; validates ids, revisions, strict ascending order, no duplicates
```

`parseVersion`: must start `(` and end `)`; empty inside → `EMPTY_VERSION`; split on `,`; each component split on the last `->`; id via `isValidContributorId`; revision text must match `^[1-9][0-9]*$` and, compared as text against `'9007199254740991'` by length then lexicographically, be ≤; ids must be strictly ascending under `compareBytes`. Any failure throws `invalid version: <original text>`. `isValidContributorId`: ≤254 bytes, all code units 0x21–0x7E (rules out control, whitespace, non-ASCII), exactly one `@` with nonempty sides, none of `,`, `(`, `)`, and no `->`. `compareVersions`/`joinVersions`/`snapOrder` are one merge-walk each.

### Step 4 — `src/core/json.ts`

```ts
export type JsonValue =
  | { kind: 'null' } | { kind: 'boolean'; value: boolean }
  | { kind: 'number'; value: number; isInteger: boolean }   // isInteger from lexeme -?(0|[1-9][0-9]*)
  | { kind: 'string'; value: string }
  | { kind: 'array'; items: JsonValue[] }
  | { kind: 'object'; entries: Map<string, JsonValue> };    // insertion order preserved
export function parseJson(text: string): JsonValue          // exactly one value plus surrounding whitespace; throws SnapError(`invalid JSON: ${reason}`) or `duplicate JSON key ${key} at ${path}`
```

Recursive descent over the string with an index: whitespace per RFC 8259; strings with all escapes incl. surrogate pairs via `\u`; numbers per RFC 8259 grammar with lexeme capture, `Number(lexeme)` for value; `-0` is an integer lexeme (value `-0`, later rejected as not positive). Depth guard not needed (inputs are shallow by schema). Duplicate keys detected on insertion into the `Map`.

```ts
export class JsonCursor {
  constructor(value: JsonValue, path: string)                // path: 'repository' | 'configuration' | 'body'
  object(): this                                             // asserts kind
  field(name: string): JsonCursor                            // required; path `${path}.${name}`
  optionalField(name: string): JsonCursor | undefined
  finishObject(): void                                       // throws `${path} has unknown field: ${name}` for the first unread key in file order
  string(): string; nonEmptyString(): string
  positiveSafeInteger(): number                              // isInteger && 1 ≤ v ≤ MAX_SAFE_INTEGER, else `${path} must be a positive safe integer`
  integerEqual(expected: number): void                       // for `format`
  array(): JsonCursor[]                                      // path `${path}[${i}]`
  literal(expected: string): string                          // for `type`
  readonly path: string
}
```

Error messages: `${path} must be an object|a string|an array|...`; the root path *is* `repository`, so the general unknown-field template already yields `repository has unknown field: unknown` exactly.

### Step 5 — `src/repo/model.ts`

```ts
export interface TextChange { readonly type: 'text'; readonly path: string; readonly edit: readonly EditOp[] }
export interface PutChange  { readonly type: 'put';  readonly path: string; readonly content: Uint8Array }
export interface DeleteChange { readonly type: 'delete'; readonly path: string }
export type Change = TextChange | PutChange | DeleteChange;
export type EditOp = { readonly retain: number } | { readonly delete: number } | { readonly insert: readonly string[] };
export interface Patch { readonly author: ContributorId; readonly revision: number; readonly base: Version; readonly message: string; readonly changes: readonly Change[] }
export interface Repository { readonly format: 1; readonly frontier: Version; readonly patches: readonly Patch[] }
export function decodeRepository(text: string): Repository
```

`decodeRepository` = `parseJson` → cursor walk with exact field sets: root `{format, frontier, patches}`; patch `{author, revision, base, message, changes}`; change by `type` literal: `text {path, edit}`, `put {path, content}`, `delete {path}`; op objects must have exactly one key (`must have one operation`), `retain`/`delete` positive safe integers, `insert` nonempty array of nonempty strings (`insert is empty`). Field-level rules applied here (§4.5 step 1 only): `format` equals 1; `frontier`/`base` via `versionFromPairs` (`.*canonical.*` on misorder: message `frontier is not in canonical order` / `patches[i].base is not in canonical order`); `author` valid id (`invalid contributor id: <id>`); `message` nonempty (`message is empty`), control chars other than tab/LF rejected (`message has an invalid control character`); `changes` nonempty (`changes is empty`), paths valid (`path is invalid: <path>`), strictly ascending by `compareBytes` with no duplicates (`changes are not sorted by path`); `content` via `decodeBase64`. Steps 2–6 of §4.5 are not here.

### Step 6 — `src/fs/locate.ts` (decoder only)

```ts
export interface Configuration { readonly contributorId: ContributorId | undefined }
export function decodeConfiguration(text: string): Configuration
```

Shape `{contributor: {id}}` with `contributor` and `id` both optional (an empty `{}` or `{"contributor":{}}` is a valid file with no ID — `snap config` writes the full shape, but §8 only says "if it provides an ID"); unknown fields rejected via `finishObject`; `id` validated (`invalid contributor id: <id>`). File reading, `$HOME`, and precedence are out of scope; this function takes text.

### Step 7 — Unit tests (colocated, `node:test` + `node:assert/strict` + fast-check)

- `core/bytes.test.ts`: `compareBytes('\uFF01', '\u{1F600}') < 0` while `'\uFF01' < '\u{1F600}'` is false in JS; property: `compareBytes(a,b)` sign equals `Buffer.compare(Buffer.from(a), Buffer.from(b))` over `fc.fullUnicodeString()`; `isText` on `[0x61,0x00]` false, on `EF BB BF 61` true, on `[0xFF]` false; `decodeUtf8` preserves BOM (`\uFEFFa`); `decodeBase64('AR==')` throws, `'AQ=='` → `[1]`, `''` → `[]`, `'abc'` throws, `'YQ=='` → `[0x61]`; property: `decodeBase64(Buffer.from(bytes).toString('base64'))` round-trips; `isValidTrackedPath` table (``, `a\\b`, `a\u0001`, `/a`, `a//b`, `./a`, `a/..`, `.snap`, `.snap/x` false; `sub/.snap/x`, `é`, `😀`, `a-x` true).
- `core/version.test.ts`: parse/format round trip on `()` and two-contributor; rejections for `(a@x->01)`, `(a@x->0)`, `(a@x->-1)`, `(a@x->9007199254740992)`, `(a@x->1,a@x->2)`, `(b@x->1,a@x->1)`, `(a@x->1, b@x->1)`, `a@x->1`, `(a@@x->1)`; accept `(a@x->9007199254740991)`; four comparison outcomes; join laws (idempotent, commutative, associative, `join(a,b) ≥ a`) as fast-check properties over a small version generator; `snapOrder` extends causal order (property: `before ⇒ snapOrder < 0`), total, and `(a@x->1) vs (b@x->1)` decided at `a@x`; `isValidContributorId` table from `tests/25` (`two@@x`, `space @x`, `a,b@x`, `a(b)@x`, `a->b@x`, 255-byte id false; `a@x` true).
- `core/json.test.ts`: duplicate key at root and nested (`duplicate JSON key id at configuration.contributor`); `1.0`, `1e0`, `1.5` → `isInteger false`; `9007199254740993` accepted by `parseJson` but rejected by `positiveSafeInteger`; surrounding whitespace accepted (` {} \n`); trailing content rejected (`{}}}`, `1 2`, `{} x`) with `invalid JSON`; `not json`, `{`, `{"a":}` → `invalid JSON`; string escapes incl. `\u00e9` and a surrogate pair; property: for `fc.jsonValue()` stringified, `parseJson` equals the structure of `JSON.parse` (types and values); cursor: `finishObject` message and ordering, `positiveSafeInteger` message, path rendering `repository.patches[0].changes[1]`.
- `repo/model.test.ts`: every `tests/15`/`23`/`27`/`30` schema-level fixture reproduced as a string → exact `SnapError.message`; a valid two-patch repository decodes to the expected structure; `put` content decoded to bytes.
- `fs/locate.test.ts`: valid shape; `{}`; unknown root and nested field; duplicate `id`; invalid id; trailing `}}` → `invalid JSON`; trailing `\n` accepted; `not json` → `invalid JSON`.

### Step 8 — Verify

`cd ts && npm run check` green; `./verify --lang ts` still runs (all cases fail on `not implemented`, harness intact); `./verify --list` shows 32 cases.

## Tasks

- [ ] Edit `SPEC.md` §4.1 and §8 with the trailing-content sentences per Step 1.
- [ ] Create `tests/32-trailing-json-content.yaml` per Step 1.
- [ ] Create `ts/src/core/bytes.ts` (`compareBytes`, `isText`, `decodeUtf8`, `encodeUtf8`, `decodeBase64`, `isValidTrackedPath`).
- [ ] Create `ts/src/core/version.ts` (`Version`, `Comparison`, `isValidContributorId`, `parseVersion`, `formatVersion`, `versionKey`, `compareVersions`, `joinVersions`, `snapOrder`, `componentOf`, `versionFromPairs`).
- [ ] Create `ts/src/core/json.ts` (`JsonValue`, `parseJson`, `JsonCursor`).
- [ ] Create `ts/src/repo/model.ts` (`Change`, `EditOp`, `Patch`, `Repository`, `decodeRepository`).
- [ ] Create `ts/src/fs/locate.ts` (`Configuration`, `decodeConfiguration`).
- [ ] Create `ts/src/core/bytes.test.ts`, `core/version.test.ts`, `core/json.test.ts`, `repo/model.test.ts`, `fs/locate.test.ts` per Step 7.
- [ ] Run `npm run format`, then `npm run check`; fix until green.
- [ ] Run `./verify --list` and `./verify --lang ts --filter 32-trailing` (expect the case to fail on `not implemented`, not a harness error).

## Documentation Impact

- `SPEC.md` §4.1, §8: trailing-content rule (Step 1).
- `tests/`: one new case (32).
- `ts/AGENTS.md`: none; the Layout paragraph already names `core/` (bytes, errors, version, strict JSON), `repo/` (model), `fs/` (locate).
- Design `snap-ts-architecture`: `core/json.ts` described as "producing a typed value" — the cursor is an addition, not a contradiction; recorded in the realized design.
- Stack `snap-1.0` Foundations: all six items become checkable at `/close-issue`.

## Acceptance Tests

- `cd ts && npm run check` exits 0; `npm test` lists `core/bytes`, `core/version`, `core/json`, `repo/model`, `fs/locate` test files all passing.
- Unit tests demonstrate: `compareBytes` orders U+FF01 before U+1F600; `isText` rejects NUL and invalid UTF-8 and preserves a BOM through `decodeUtf8`; `decodeBase64('AR==')` throws `content is not canonical base64`; `parseVersion` rejects each of the nine malformed inputs above with `invalid version: <input>` and accepts `9007199254740991`; all four comparison outcomes; join laws and Snap-order-extends-causal-order hold under fast-check; `parseJson` rejects duplicate keys with `duplicate JSON key <key> at <path>`, marks `1.0`/`1e0` non-integer, accepts surrounding whitespace, and reports `invalid JSON` on a truncated value or on trailing non-whitespace bytes.
- `decodeRepository` on the `tests/23` lines 9–17 fixture throws exactly `repository has unknown field: unknown`; on lines 138–155 throws a message ending `unknown field: extra`; on the `tests/30` fixtures throws messages ending `positive safe integer`; on `tests/15` line 85 throws `content is not canonical base64`; on line 61 throws `path is invalid: .snap/secret`.
- `decodeConfiguration('{"contributor":{"id":"global@example.com"}}\n')` returns the ID; `decodeConfiguration('{"contributor":{"id":"global@example.com"}}}}')` and `decodeConfiguration('not json')` throw starting `invalid JSON`.
- `./verify --list` prints 32 cases; `./verify --lang ts --filter 32-trailing` reports the case as failed (candidate `not implemented`), not a harness error.
- `git diff --quiet ts/AGENTS.md AGENTS.md README.md ts/eslint.config.js ts/package.json` exits 0.
