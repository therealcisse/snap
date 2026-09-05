/**
 * The strict JSON reader for repository, configuration, and HTTP input (SPEC §4.1, §8, §9).
 *
 * `JSON.parse` cannot serve here: it accepts duplicate keys (last wins), has already rounded an
 * unsafe integer before any reviver runs, and cannot report whether `1.0` was spelled with a
 * fraction — and SPEC §4.1 makes that spelling the difference between an integer and an error.
 * `parseJson` produces a tagged tree that keeps the facts the schema layer needs; `JsonCursor`
 * walks that tree while tracking a dotted path so every schema error names the offending value
 * the same way.
 */
import { SnapError } from './errors.ts';

/** A parsed JSON value. Objects keep file order; numbers keep whether their lexeme was integral. */
export type JsonValue =
  | { readonly kind: 'null' }
  | { readonly kind: 'boolean'; readonly value: boolean }
  | { readonly kind: 'number'; readonly value: number; readonly isInteger: boolean }
  | { readonly kind: 'string'; readonly value: string }
  | { readonly kind: 'array'; readonly items: readonly JsonValue[] }
  | { readonly kind: 'object'; readonly entries: ReadonlyMap<string, JsonValue> };

/** SPEC §4.1: a number is an integer only when its lexeme has no fraction and no exponent. */
const INTEGER_LEXEME = /^-?(?:0|[1-9][0-9]*)$/;

/**
 * Parses `text` as exactly one JSON value (RFC 8259) optionally surrounded by whitespace.
 *
 * `root` names the document (`repository`, `configuration`, `body`) and heads the dotted path in
 * `SnapError('duplicate JSON key <key> at <path>')` for a repeated object key. Any syntax error,
 * truncated value, or non-whitespace byte after the value throws
 * `SnapError('invalid JSON: <reason>')`.
 */
export function parseJson(text: string, root: string): JsonValue {
  const parser = new Parser(text);
  const value = parser.value(root);
  parser.skipWhitespace();
  if (!parser.atEnd()) {
    throw parser.invalid('unexpected content after the value');
  }
  return value;
}

class Parser {
  private readonly text: string;
  private index = 0;

  constructor(text: string) {
    this.text = text;
  }

  atEnd(): boolean {
    return this.index >= this.text.length;
  }

  invalid(reason: string): SnapError {
    return new SnapError(`invalid JSON: ${reason} at offset ${String(this.index)}`);
  }

  skipWhitespace(): void {
    // RFC 8259 §2 whitespace is exactly these four bytes; JavaScript's `\s` admits far more.
    while (this.index < this.text.length) {
      const unit = this.text.charCodeAt(this.index);
      if (unit !== 0x20 && unit !== 0x09 && unit !== 0x0a && unit !== 0x0d) {
        break;
      }
      this.index += 1;
    }
  }

  /** Parses one value; `path` locates it for duplicate-key errors. */
  value(path: string): JsonValue {
    this.skipWhitespace();
    if (this.atEnd()) {
      throw this.invalid('unexpected end of input');
    }
    switch (this.text.charAt(this.index)) {
      case '{':
        return this.object(path);
      case '[':
        return this.array(path);
      case '"':
        return { kind: 'string', value: this.string() };
      case 't':
        this.literal('true');
        return { kind: 'boolean', value: true };
      case 'f':
        this.literal('false');
        return { kind: 'boolean', value: false };
      case 'n':
        this.literal('null');
        return { kind: 'null' };
      default:
        return this.number();
    }
  }

  private literal(expected: string): void {
    if (!this.text.startsWith(expected, this.index)) {
      throw this.invalid('unexpected token');
    }
    this.index += expected.length;
  }

  private object(path: string): JsonValue {
    this.index += 1;
    const entries = new Map<string, JsonValue>();
    this.skipWhitespace();
    if (this.text[this.index] === '}') {
      this.index += 1;
      return { kind: 'object', entries };
    }
    for (;;) {
      this.skipWhitespace();
      if (this.text[this.index] !== '"') {
        throw this.invalid('expected a string key');
      }
      const key = this.string();
      if (entries.has(key)) {
        throw new SnapError(`duplicate JSON key ${key} at ${path}`);
      }
      this.skipWhitespace();
      if (this.text[this.index] !== ':') {
        throw this.invalid("expected ':'");
      }
      this.index += 1;
      entries.set(key, this.value(`${path}.${key}`));
      this.skipWhitespace();
      const next = this.text[this.index];
      this.index += 1;
      if (next === '}') {
        return { kind: 'object', entries };
      }
      if (next !== ',') {
        throw this.invalid("expected ',' or '}'");
      }
    }
  }

  private array(path: string): JsonValue {
    this.index += 1;
    const items: JsonValue[] = [];
    this.skipWhitespace();
    if (this.text[this.index] === ']') {
      this.index += 1;
      return { kind: 'array', items };
    }
    for (;;) {
      items.push(this.value(`${path}[${String(items.length)}]`));
      this.skipWhitespace();
      const next = this.text[this.index];
      this.index += 1;
      if (next === ']') {
        return { kind: 'array', items };
      }
      if (next !== ',') {
        throw this.invalid("expected ',' or ']'");
      }
    }
  }

  private string(): string {
    this.index += 1;
    let result = '';
    let runStart = this.index;
    for (;;) {
      if (this.atEnd()) {
        throw this.invalid('unterminated string');
      }
      const unit = this.text.charCodeAt(this.index);
      if (unit === 0x22) {
        result += this.text.slice(runStart, this.index);
        this.index += 1;
        return result;
      }
      if (unit < 0x20) {
        throw this.invalid('control character in string');
      }
      if (unit !== 0x5c) {
        this.index += 1;
        continue;
      }
      result += this.text.slice(runStart, this.index);
      result += this.escape();
      runStart = this.index;
    }
  }

  /** Decodes one escape sequence starting at the backslash and advances past it. */
  private escape(): string {
    const code = this.text.charAt(this.index + 1);
    this.index += 2;
    switch (code) {
      case '"':
        return '"';
      case '\\':
        return '\\';
      case '/':
        return '/';
      case 'b':
        return '\b';
      case 'f':
        return '\f';
      case 'n':
        return '\n';
      case 'r':
        return '\r';
      case 't':
        return '\t';
      case 'u': {
        const hex = this.text.slice(this.index, this.index + 4);
        if (!/^[0-9A-Fa-f]{4}$/.test(hex)) {
          throw this.invalid('invalid unicode escape');
        }
        this.index += 4;
        // A `\u` escape is one UTF-16 code unit; a surrogate pair arrives as two escapes and
        // `String.fromCharCode` joins them exactly as the source text intends.
        return String.fromCharCode(Number.parseInt(hex, 16));
      }
      default:
        throw this.invalid('invalid escape');
    }
  }

  private number(): JsonValue {
    const match = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/.exec(
      this.text.slice(this.index),
    );
    if (match === null) {
      throw this.invalid('unexpected token');
    }
    const lexeme = match[0];
    this.index += lexeme.length;
    return { kind: 'number', value: Number(lexeme), isInteger: INTEGER_LEXEME.test(lexeme) };
  }
}

/** The name of a `JsonValue`'s kind as it reads in an error message. */
function describeKind(value: JsonValue): string {
  switch (value.kind) {
    case 'null':
      return 'null';
    case 'boolean':
      return 'a boolean';
    case 'number':
      return 'a number';
    case 'string':
      return 'a string';
    case 'array':
      return 'an array';
    case 'object':
      return 'an object';
  }
}

/**
 * A position in a parsed JSON tree together with its dotted path, such as
 * `repository.patches[0].changes[1]`.
 *
 * Decoders read a value through exactly one typed accessor, which either returns the value or
 * throws a `SnapError` whose message starts with the path. Object fields are read through
 * `field`/`optionalField`, after which `finishObject` rejects any key not read, so a decoder
 * cannot forget to reject unknown fields. The root path is the document's name (`repository`,
 * `configuration`, `body`); it appears verbatim in errors, so the acceptance suite's exact
 * `repository has unknown field: unknown` falls out of the general template.
 */
export class JsonCursor {
  readonly path: string;
  private readonly value: JsonValue;
  private readonly readKeys = new Set<string>();

  constructor(value: JsonValue, path: string) {
    this.value = value;
    this.path = path;
  }

  /** Asserts the value is an object and returns this cursor for chaining field reads. */
  object(): this {
    if (this.value.kind !== 'object') {
      throw this.expected('an object');
    }
    return this;
  }

  /** A required field of an object value. */
  field(name: string): JsonCursor {
    const cursor = this.optionalField(name);
    if (cursor === undefined) {
      throw new SnapError(`${this.path} is missing field: ${name}`);
    }
    return cursor;
  }

  /** An optional field of an object value, or `undefined` when absent. */
  optionalField(name: string): JsonCursor | undefined {
    if (this.value.kind !== 'object') {
      throw this.expected('an object');
    }
    this.readKeys.add(name);
    const child = this.value.entries.get(name);
    return child === undefined ? undefined : new JsonCursor(child, `${this.path}.${name}`);
  }

  /** Rejects the first key, in file order, that no `field`/`optionalField` call has read. */
  finishObject(): void {
    if (this.value.kind !== 'object') {
      throw this.expected('an object');
    }
    for (const key of this.value.entries.keys()) {
      if (!this.readKeys.has(key)) {
        throw new SnapError(`${this.path} has unknown field: ${key}`);
      }
    }
  }

  /** The number of keys in an object value, for schemas with "exactly one key" rules. */
  keyCount(): number {
    if (this.value.kind !== 'object') {
      throw this.expected('an object');
    }
    return this.value.entries.size;
  }

  string(): string {
    if (this.value.kind !== 'string') {
      throw this.expected('a string');
    }
    return this.value.value;
  }

  nonEmptyString(): string {
    const text = this.string();
    if (text.length === 0) {
      throw new SnapError(`${this.path} is empty`);
    }
    return text;
  }

  /** An integer lexeme whose value is in `1..Number.MAX_SAFE_INTEGER` (SPEC §3.1, §4.4). */
  positiveSafeInteger(): number {
    const { value } = this;
    if (
      value.kind !== 'number' ||
      !value.isInteger ||
      !Number.isSafeInteger(value.value) ||
      value.value < 1
    ) {
      throw new SnapError(`${this.path} must be a positive safe integer`);
    }
    return value.value;
  }

  /** Requires an integer lexeme equal to `expected`, for fixed fields such as `format`. */
  integerEqual(expected: number): void {
    const { value } = this;
    if (value.kind !== 'number' || !value.isInteger || value.value !== expected) {
      throw new SnapError(`${this.path} must be ${String(expected)}`);
    }
  }

  /** The elements of an array value, each addressed as `${path}[${index}]`. */
  array(): JsonCursor[] {
    if (this.value.kind !== 'array') {
      throw this.expected('an array');
    }
    return this.value.items.map(
      (item, index) => new JsonCursor(item, `${this.path}[${String(index)}]`),
    );
  }

  /** A string equal to one of `allowed`, for discriminators such as `type`. */
  literal<T extends string>(allowed: readonly T[]): T {
    const text = this.string();
    const found = allowed.find((candidate) => candidate === text);
    if (found === undefined) {
      throw new SnapError(`${this.path} must be one of: ${allowed.join(', ')}`);
    }
    return found;
  }

  private expected(kind: string): SnapError {
    return new SnapError(`${this.path} must be ${kind}, not ${describeKind(this.value)}`);
  }
}
