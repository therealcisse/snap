/**
 * Byte-level primitives that every observable ordering and content decision rests on.
 *
 * JavaScript's defaults are wrong for Snap in three places, and this module exists to replace them
 * once: string `<` compares UTF-16 code units rather than UTF-8 bytes (SPEC §2, §3.2), `Buffer`'s
 * base64 decoder silently accepts non-canonical input (SPEC §4.3), and the default `TextDecoder`
 * strips a leading BOM and replaces malformed sequences instead of failing (SPEC §4.4).
 */
import { isUtf8 } from 'node:buffer';

import { SnapError } from './errors.ts';

/**
 * Compares two strings by the unsigned lexicographic order of their UTF-8 encodings (SPEC §2).
 *
 * Returns a negative number, zero, or a positive number in the usual comparator convention.
 * Both arguments must be well-formed (no lone surrogates); every string Snap orders has already
 * been decoded from valid UTF-8 or validated as a contributor ID.
 */
export function compareBytes(a: string, b: string): number {
  // UTF-8 byte order equals code-point order (RFC 3629 §1), so walking code points avoids
  // encoding either string. UTF-16 code-unit order differs from it only across the surrogate
  // range: U+FF01 encodes as 0xFF01 but U+1F600 as 0xD83D 0xDE00, so `<` puts the emoji first.
  for (let i = 0; ;) {
    const ca = a.codePointAt(i);
    const cb = b.codePointAt(i);
    if (ca === undefined || cb === undefined) {
      // One string is a prefix of the other (or both ended); the shorter sorts first.
      return a.length - b.length;
    }
    if (ca !== cb) {
      return ca < cb ? -1 : 1;
    }
    i += ca > 0xffff ? 2 : 1;
  }
}

/** Whether `bytes` are a text file under SPEC §4.4: valid UTF-8 and no NUL byte. */
export function isText(bytes: Uint8Array): boolean {
  return isUtf8(bytes) && !bytes.includes(0);
}

const utf8Decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
const utf8Encoder = new TextEncoder();

/**
 * Decodes UTF-8 bytes to a string, preserving a leading BOM as U+FEFF.
 *
 * Throws a `TypeError` on malformed input; callers must have checked `isText` first, so a throw
 * here is a defect rather than an expected failure.
 */
export function decodeUtf8(bytes: Uint8Array): string {
  return utf8Decoder.decode(bytes);
}

/** Encodes a string as UTF-8 bytes. */
export function encodeUtf8(text: string): Uint8Array {
  return utf8Encoder.encode(text);
}

/** Standard padded base64 alphabet and padding shape (RFC 4648 §4). */
const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

/**
 * Decodes a `put` change's `content` (SPEC §4.3): standard padded RFC 4648 base64, canonical.
 *
 * Canonical means the text is exactly what encoding the bytes produces, so one byte sequence has
 * one spelling and structural patch equality (SPEC §4.2) can compare decoded bytes. Throws
 * `SnapError('content is not canonical base64')` for anything else; the empty string decodes to
 * zero bytes.
 */
export function decodeBase64(text: string): Uint8Array {
  if (!BASE64.test(text)) {
    throw new SnapError('content is not canonical base64');
  }
  const bytes = Buffer.from(text, 'base64');
  // The alphabet check cannot see non-zero padding bits: `AR==` decodes to the same byte as
  // `AQ==`, so only a re-encode distinguishes the canonical spelling.
  if (bytes.toString('base64') !== text) {
    throw new SnapError('content is not canonical base64');
  }
  return new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

/**
 * Encodes a `put` change's `content` (SPEC §4.3): the canonical padded RFC 4648 spelling of `bytes`.
 *
 * This is exactly the form `decodeBase64` accepts, so `decodeBase64(encodeBase64(b))` is `b` and
 * one byte sequence has one spelling. `toString('base64')` produces padded standard base64 by
 * construction, never the URL-safe alphabet or unpadded shapes the decoder rejects.
 */
export function encodeBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('base64');
}

/**
 * Whether `path` is a valid tracked path (SPEC §2): nonempty, `/`-separated, no ASCII control
 * character or backslash, no empty, `.`, or `..` segment, and a first segment other than `.snap`.
 *
 * Performs no Unicode or case normalization; `sub/.snap/x` is valid because only the first
 * segment is reserved.
 */
export function isValidTrackedPath(path: string): boolean {
  if (path.length === 0) {
    return false;
  }
  for (let i = 0; i < path.length; i += 1) {
    const unit = path.charCodeAt(i);
    if (unit < 0x20 || unit === 0x7f || unit === 0x5c) {
      return false;
    }
  }
  const segments = path.split('/');
  if (segments[0] === '.snap') {
    return false;
  }
  return segments.every((segment) => segment !== '' && segment !== '.' && segment !== '..');
}
