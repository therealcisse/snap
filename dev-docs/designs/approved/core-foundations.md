---
title: "Realized: byte-order primitives, vector-clock versions, strict JSON reader with typed cursor, and the repository and configuration decoders"
date: 2026-09-04
author: agent
id: core-foundations
issue: core-foundations
plan: core-foundations
---

## Summary

`ts/src` now holds the five pure foundation modules every later command depends on: `core/bytes.ts` (code-point ordering, UTF-8 text detection, canonical base64, tracked-path validity), `core/version.ts` (the vector-clock `Version` type with parse, format, compare, join, and `snapOrder`), `core/json.ts` (the single sanctioned strict JSON decoder plus a `JsonCursor` that turns a parsed value into typed fields with SPEC-worded errors), `repo/model.ts` (`Repository`/`Patch`/`Change`/`EditOp` types and `decodeRepository`), and `fs/locate.ts` (`Configuration` and `decodeConfiguration`). `SPEC.md` gained the rule that a file or body is exactly one JSON value surrounded only by whitespace (§4.1, §8), and `tests/32-trailing-json-content.yaml` pins it publicly. Nothing is wired into `cli/main.ts` yet; every command still exits 1 with `snap: not implemented: <args>`.

## Plan Realized

### core-foundations

All ten tasks executed. Deviations:

1. **Trailing content is strict, not lenient.** The plan's lenient reading rested on `tests/03` line 70's `}}}}`, which the harness interpolates as an escape for the literal `}}` (`TEST-HARNESS.md` line 82, `test-harness/src/interpolate.ts` line 16), so no public case bore on the question. Per explicit user instruction the approved plan was edited in place (Context, Current State, Developer Feedback, Steps 1/4/7, Acceptance Tests) rather than replanned; this is a knowing exception to plan immutability.
2. `parseJson(text, root)` takes the root name as a second argument so duplicate-key paths read `repository.frontier`, not `.frontier`.
3. `versionFromPairs(pairs, path)` takes a path prefix instead of the plan's `at` callback; errors are `<path>[<i>][1] must be a positive safe integer` and `<path> is not in canonical order`.
4. `JsonCursor.literal(allowed)` returns the matched literal (typed as a member of `allowed`), and `keyCount()` was added so `decodeEditOp` can enforce exactly one operation key without enumerating the absent ones.
5. Invalid-JSON reasons carry `at offset N`, so the message is `invalid JSON: <reason> at offset <n>`.
6. The `tests/32` fixture is spelled `}}}}}}}}` in YAML, which reaches the candidate as four braces (the closing brace plus three extra); the case description says so.

## Implementation

`SPEC.md`: §4.1 (lines 192–200 after re-wrap) adds "A file or body is exactly one JSON value optionally surrounded by whitespace; a truncated value or any other byte after the value is malformed." §8 (lines 686–687) adds "Trailing bytes after the configuration value are malformed (§4.1)."

`tests/32-trailing-json-content.yaml`: init; write `repository.json` with trailing braces → `status` exits 1, empty stdout, stderr `^snap: invalid JSON.*\n$` (anchor `&invalid_json`); truncated `{"format":1,"frontier":[],"patches":[]` → same; `not json` → same; valid empty repository followed by `\n` → exit 0, stdout `version ()\n`, empty stderr.

`ts/src/core/bytes.ts` (107 lines): `compareBytes(a, b)` walks `codePointAt` pairs and returns `a.length - b.length` when one string is a prefix of the other, which equals UTF-8 byte order; `isText(bytes)` is `Buffer.isUtf8 && !bytes.includes(0)`; `decodeUtf8`/`encodeUtf8` share one module-level `TextDecoder('utf-8', { fatal: true, ignoreBOM: true })` and `TextEncoder`; `decodeBase64(text)` checks the alphabet/padding regex, decodes with `Buffer.from`, re-encodes, and requires the round trip to match (`content is not canonical base64`), returning a `Uint8Array` view; `isValidTrackedPath(path)` implements the SPEC path rules.

`ts/src/core/version.ts` (225 lines): `ContributorId = string`; `Version = readonly (readonly [ContributorId, number])[]`; `EMPTY_VERSION`; `Comparison = 'equal' | 'before' | 'after' | 'concurrent'`; `isValidContributorId` (1–254 code units in 0x21–0x7E, none of `,` `(` `)`, exactly one `@` with nonempty sides, no `->`); `parseVersion(text)` (throws `invalid version: <text>`, with a private `parseRevision` that bounds the digit string textually against `'9007199254740991'` before converting); `formatVersion`; `versionKey` (canonical string for `Map`/`Set` keys); `componentOf`; private generator `alignedComponents(a, b)` yielding `[id, ra, rb]` over the sorted union of contributor ids with 0 for absent ones; `compareVersions`, `joinVersions`, `snapOrder` (comparison first, then `compareBytes` on `formatVersion`) all built on the generator; `versionFromPairs(pairs, path)` validates ids, positive safe integer revisions, and canonical order for decoded input.

`ts/src/core/json.ts` (383 lines): `JsonValue` readonly tagged union (`null`, `boolean`, `number` with `isInteger` derived from the lexeme `-?(0|[1-9][0-9]*)`, `string`, `array`, `object` with `entries: ReadonlyMap`); `parseJson(text, root)` runs a private hand-written `Parser` class (no parameter properties under `erasableSyntaxOnly`; `charAt` instead of indexing so switches stay exhaustive) that rejects duplicate keys, non-safe or non-integer-lexeme numbers where later demanded, and any non-whitespace after the value; `describeKind`; `JsonCursor` with public `path`, private `value` and `readKeys`, and methods `object()`, `field(name)`, `optionalField(name)`, `finishObject()` (rejects the first unread key in file order), `keyCount()`, `string()`, `nonEmptyString()`, `positiveSafeInteger()`, `integerEqual(n)`, `array()` (children at `<path>[<i>]`), `literal(allowed)`.

`ts/src/repo/model.ts` (192 lines): `EditOp` (`retain` | `insert` | `delete` single-key union), `TextChange`, `PutChange`, `DeleteChange`, `Change`, `Patch`, `Repository`; `decodeRepository(text)` with private `decodePatch`, `decodeVersion` (requires `[id, revision]` pairs, delegates to `versionFromPairs`), `decodeMessage` (rejects control characters below 0x20 except tab and LF, and 0x7F), `decodeChanges` (nonempty, sorted by `compareBytes` on path), `decodeChange` (`CHANGE_TYPES = ['text', 'put', 'delete']` via `literal`; `isValidTrackedPath`; base64 via `decodeBase64`), `decodeEditOp` (`keyCount() !== 1` → one operation; empty insert rejected).

`ts/src/fs/locate.ts` (38 lines): `Configuration { contributorId: ContributorId | undefined }`; `decodeConfiguration(text)` parses with root `configuration`, treats `contributor` and `contributor.id` as optional, rejects unknown fields at both levels, validates the id. Repository walk and configuration-file resolution are not in this module yet.

## Behavior

- Roots: repository files decode under the path `repository`, configuration under `configuration`; HTTP bodies will use `body`. Nested paths render as `repository.patches[0].changes[1].content`.
- Strict trailing rule: `{"format":1,…}` followed by `\n` is valid; followed by any other byte, or cut short, fails with `invalid JSON: <reason> at offset <n>`.
- Error wording produced by these modules (each becomes `snap: <message>` via `describeFailure`):
  - `invalid JSON: <reason> at offset <n>`; `duplicate JSON key <key> at <path>`
  - `<path> is missing field: <name>`; `<path> has unknown field: <name>`
  - `<path> must be <kind>, not <actual kind>` (e.g. `must be an object, not an array`)
  - `<path> is empty`; `<path> must be a positive safe integer`; `<path> must be <n>`; `<path> must be one of: text, put, delete`
  - `invalid version: <text>`; `invalid contributor id: <id>`; `<path>[<i>] must be an [id, revision] pair`; `<path>[<i>][1] must be a positive safe integer`; `<path> is not in canonical order`
  - `<path> has an invalid control character`; `<path> are not sorted by path`; `path is invalid: <path>`; `<path> must have one operation`; `<path>.insert is empty`
  - `content is not canonical base64`
- `compareBytes` orders by code point so a string that is a proper prefix sorts first; `snapOrder` is a total order: `compareVersions` result first, ties (concurrent) broken by byte order of the formatted version.
- `isInteger` is a property of the lexeme, so `1.0` and `1e0` are not integers even though they equal 1.
- Public suite: `./verify --list` shows 32 cases; `./verify --lang ts --filter 32-trailing` fails at step 1 (`init` exits 1, not implemented) rather than as a harness error.

## Tests

`npm run check` is green: 141 tests, 21 suites (including the 7 from `toolchain-scaffolding`).

- `core/bytes.test.ts` (15): `compareBytes` agrees with `Buffer.compare` on UTF-8 encodings under a fast-check property over `fc.string({ unit: 'binary' })` (fast-check 4 has no `fullUnicodeString`); prefix ordering; `isText` on valid UTF-8, invalid bytes, NUL; UTF-8 round trip and fatal decode; base64 canonical/non-canonical/empty; tracked-path accept and reject tables.
- `core/version.test.ts` (18): `versionArb` via `fc.uniqueArray` over `a@x, b@x, c@x, z@x`; parse/format round trip and rejections; `compareVersions` reflexivity, antisymmetry (asserted as `sign(ab) + sign(ba) === 0` to sidestep `-0`), concurrency; `joinVersions` idempotence, commutativity, upper bound; `snapOrder` totality; `versionFromPairs` error wording; textual revision bound at `2^53 - 1` and `2^53`.
- `core/json.test.ts` (21): every value kind; duplicate key with root-qualified path; trailing whitespace accepted, trailing byte rejected, truncation rejected; offsets in reasons; `JsonCursor` field/unknown/missing/type-mismatch/literal/keyCount behaviors.
- `repo/model.test.ts` (11): `withPatch`/`withChange` fixture helpers; valid repository decode; the exact messages the public cases `tests/15`, `23`, `27`, `30` expect; unsorted changes; control character in message; two-key edit op; empty insert.
- `fs/locate.test.ts` (8): empty object, missing `contributor`, missing `id`, valid id, invalid id, unknown field at each level, trailing content.

Not tested: interaction with the CLI (no command reads a file yet).

## Decisions

- Strict trailing content: the SPEC was silent and the only apparent evidence was a harness escape artifact; closing the gap in `SPEC.md` plus a public case keeps the spec authoritative rather than the implementation. Strict is the choice that rejects more inputs now and can be loosened later without breaking stored repositories.
- Parser + cursor in one module: `parseJson` is the only `JSON.parse`-equivalent (the ESLint override for `src/core/json.ts` is now live), and `JsonCursor` keeps every decoder's error path rendering and unknown-field rejection in one place so `repo/model.ts` and `fs/locate.ts` read as schemas, not string plumbing.
- `alignedComponents` generator: one aligned walk over the sorted union underlies compare, join, and order, so the three cannot disagree on how absent contributors are treated.
- `versionFromPairs(pairs, path)` with a path string instead of a callback: every caller already has the cursor path; a callback would only recompute it.
- `keyCount()` and typed `literal()`: the smallest additions that let `decodeEditOp` and `decodeChange` express "exactly one of" and "one of these" without weakening types or duplicating the error format.
- Offsets in `invalid JSON` reasons: the public suite matches `^snap: invalid JSON.*\n$`, so the extra detail costs nothing and makes hand-edited repository failures diagnosable.
- Textual revision bound before numeric conversion: `Number('9007199254740993')` rounds silently, so comparing the digit string against `'9007199254740991'` is the only way to reject unsafe revisions exactly.
- `charAt` over indexing in the parser and `Uint8Array` view over copying in `decodeBase64`: the first keeps switch exhaustiveness under `noUncheckedIndexedAccess` without non-null assertions; the second avoids an allocation the caller does not need.

## Follow-Up

- No command consumes these modules yet; the next issues wire `decodeRepository`/`decodeConfiguration` into `init`/`status` and the rest of the CLI.
- `fs/locate.ts` still needs the repository-root walk and configuration-file resolution its name promises.
- `repo/model.ts` needs the canonical encoder (writing `repository.json`) and structural equality for versions/patches.
- Design `snap-ts-architecture` describes `core/json.ts` as "producing a typed value"; `JsonCursor` is the concrete form of that idea. The design is immutable; this record is the correction.
- The approved plan `core-foundations` was edited after approval by explicit user instruction (deviation 1); the plan's `completed`/`realized_design` fields are filled at `/close-plan`.
- `TEST-HARNESS.md` lines 371–373, 389, 402 still reference `capstones/snap/` (carried over; still uncaptured).
