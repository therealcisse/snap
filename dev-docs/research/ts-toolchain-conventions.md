---
title: "TypeScript toolchain conventions for Snap"
date: 2026-09-04
author: agent
id: ts-toolchain-conventions
---
# TypeScript toolchain conventions for Snap

## Motivation

`ts/` is a Node 24, ESM (`"type": "module"`), strict-TypeScript project that runs directly via `tsx` with no build step (`npm run build` is `tsc --noEmit`). Production code may use only Node built-ins; dev dependencies are permitted but should stay few. Nothing is implemented yet, so this is the moment to fix linting, formatting, testing, type-checking, and pre-commit conventions before code accumulates.

This document surveys the 2026 landscape for each concern, presents trade-offs, and proposes a small default stack. It also gives concrete rule configurations for the project's required bans: `JSON.parse` on untrusted input, `process.exit`, global `fetch`, `String#localeCompare`, comparator-less `Array#sort`, `console.log`/`console.error` in `src/`, `Buffer#toString('utf8')` for text detection, the `any` type, and non-null assertions outside tests.

Research informs; it does not decide. Every recommendation below is a default with a stated alternative.

## Landscape summary (September 2026)

Two ecosystem shifts dominate the picture and constrain every other choice:

1. **TypeScript 7.0 (native Go compiler, "tsgo") went GA on 2026-07-08.** `npm view typescript version` now returns `7.0.2`, so an unpinned `typescript` install resolves to 7.x. TS 7.0 does not ship a stable programmatic compiler API (deferred to 7.1), so every tool that embeds the compiler — notably typescript-eslint — cannot run on it. `typescript-eslint@8.69.0` declares `peerDependencies.typescript: ">=4.8.4 <6.1.0"`. TS 6.0 is the transition release that turned the 7.0 removals into deprecations and changed defaults (`strict: true`, `module: esnext`, `types: []`, `target` floating to the current ES year). See TS 6.0 release notes and TS 7 coverage in References.
2. **Rust/Go-native tooling is now production-grade for linting.** Oxlint's type-aware engine `tsgolint` reached stable on 2026-07-22, covering 59 of 61 typescript-eslint type-aware rules and tracking TS 7 (`oxlint-tsgolint@7.0.2001`). Oxfmt is Prettier-compatible with built-in import sorting but is still marketed as beta by its authors. Biome 2.5 has its own type-inference engine but its `noFloatingPromises` / `useExhaustiveSwitchCases` remain in the `nursery` group.

Consequence for Snap: **you must choose a lane.** Either (a) ESLint + typescript-eslint on TypeScript 6.0.x, or (b) Oxlint + tsgolint on TypeScript 7.0.x. Mixing requires the `@typescript/typescript6` shim or two TypeScript installs. Section 7 recommends (a) for now and explains when to switch.

Versions observed via `npm view` on 2026-09-04: `typescript@7.0.2` (latest 6.x is `6.0.3`), `@typescript/typescript6@6.0.2`, `eslint@10.10.0`, `@eslint/js@10.0.1`, `typescript-eslint@8.69.0`, `eslint-plugin-import-x@4.17.1`, `eslint-plugin-n@18.3.0`, `eslint-plugin-perfectionist@5.11.0`, `eslint-config-prettier@10.1.8`, `prettier@3.9.6`, `oxlint@1.81.0`, `oxlint-tsgolint@7.0.2001`, `oxfmt@0.66.0`, `@biomejs/biome@2.5.12`, `vitest@5.0.0`, `fast-check@4.9.0`, `tsx@4.23.13`, `lefthook@2.1.12`, `simple-git-hooks@2.14.0`, `husky@9.1.7`, `lint-staged@17.4.1`, `@types/node@24.13.3` (latest 24.x; 26.x also exists). Local Node is v24.9.0; docs cited are for the 24.x line (latest 24.20.0).

## 1. Linting

### 1.1 ESLint 10 flat config + typescript-eslint

ESLint 10 (released 2026-02-06) removed eslintrc entirely; `eslint.config.*` is the only format, and config lookup now starts from each linted file's directory. typescript-eslint ships a `typescript-eslint` meta-package exporting `config()` helpers and shareable configs. The relevant configs for a strict, greenfield project are `strictTypeChecked` and `stylisticTypeChecked`; both require type information.

Type information should be provided with `parserOptions.projectService: true` rather than `project: './tsconfig.json'`. `projectService` reuses the same TypeScript "project service" that editors use, automatically picks the right tsconfig per file, and gives clear errors for files not covered by any tsconfig. It replaces the old `EXPERIMENTAL_useProjectService` name and is the documented default since v8.

**Cost of type-aware linting.** typescript-eslint must build a full TypeScript `Program`; lint time is roughly `tsc --noEmit` time plus rule time. For a project of Snap's size (a few thousand lines) this is seconds, not minutes. Oxc's benchmarks show tsgolint 12–18× faster than ESLint+typescript-eslint on large repos (VS Code 83.2s → 6.96s), which matters for monorepos but is not decisive here. The costs that do matter for Snap: typescript-eslint pins you to TS 6.0.x until typescript-eslint supports the TS 7.1 API, and type-aware rules cannot run on files outside the tsconfig `include` (so test files must be included; see §3).

Recommended rule additions beyond `strictTypeChecked`:

- `@typescript-eslint/switch-exhaustiveness-check` with `requireDefaultForNonUnion: true` and `considerDefaultExhaustiveForUnions: false` — forces every union member to be handled explicitly; a `default` cannot mask a missing case. Pairs well with a `satisfies never` helper for the impossible branch. Snap's tagged-union-heavy domain (operations, diff hunks, commands) benefits directly.
- `@typescript-eslint/no-floating-promises` and `no-misused-promises` (both in `strictTypeChecked` already; confirm they stay `error`).
- `@typescript-eslint/consistent-type-imports` with `fixStyle: 'inline-type-imports'` — redundant with `verbatimModuleSyntax` for correctness, but produces the fix automatically.
- `@typescript-eslint/explicit-module-boundary-types` — exported functions must have explicit parameter and return types. Improves `.d.ts`-free readability and prevents inference drift across module boundaries. Not in `strict`; enable explicitly.
- `@typescript-eslint/require-array-sort-compare` with `ignoreStringArrays: false` — covers the comparator-less `sort` / `toSorted` ban, including string arrays (Snap needs deterministic byte-order sorting, not UTF-16 default order, and must not use `localeCompare`).
- `@typescript-eslint/no-non-null-assertion` (in `strict`) — keep as `error` in `src/`, override to `off` for test files.
- `@typescript-eslint/no-explicit-any` (in `recommended`) — keep as `error`; also `no-unsafe-*` rules from `strictTypeChecked` catch `any` leaking from untyped sources.

### 1.2 Project-wide API bans

ESLint core provides four ban rules; together they cover the required list without any plugin. `no-restricted-properties` supports omitting `object` to ban a property name on any receiver, and `no-restricted-syntax` accepts esquery selectors with attribute regexes. All accept a `message`.

```js
// eslint.config.js (excerpt) — bans applied to src/**
{
  files: ['src/**/*.ts'],
  rules: {
    'no-restricted-globals': [
      'error',
      { name: 'fetch', message: 'Snap must not perform network I/O via global fetch; use node:http(s) in the HTTP module only.' },
    ],
    'no-restricted-properties': [
      'error',
      { object: 'JSON', property: 'parse', message: 'Parse through the validated decoder in repository/ (schema-checked); raw JSON.parse on untrusted input is forbidden.' },
      { object: 'process', property: 'exit', message: 'Return an exit code from main() and let the CLI dispatcher exit; never call process.exit inside library code.' },
      { property: 'localeCompare', message: 'Locale-dependent ordering is nondeterministic; compare code units or bytes explicitly.' },
      { object: 'console', property: 'log', message: 'Write to the injected output stream, not console.' },
      { object: 'console', property: 'error', message: 'Write to the injected error stream, not console.' },
    ],
    'no-restricted-syntax': [
      'error',
      {
        // Buffer#toString('utf8' | 'utf-8') used as a "is this text?" probe silently replaces invalid bytes.
        selector: "CallExpression[callee.property.name='toString'][arguments.0.value=/^utf-?8$/i]",
        message: 'Do not use Buffer#toString(\'utf8\') for text detection; use the explicit binary/text classifier (TextDecoder with fatal: true or a byte scan).',
      },
      {
        selector: "NewExpression[callee.name='TextDecoder']:not([arguments.1.properties.0.key.name='fatal'])",
        message: 'Construct TextDecoder with { fatal: true } so invalid UTF-8 throws instead of producing U+FFFD.',
      },
      {
        selector: 'TSEnumDeclaration',
        message: 'Use a string-literal union or `as const` object; enums are not erasable syntax (see erasableSyntaxOnly).',
      },
    ],
  },
},
```

Notes and limits:

- `no-restricted-globals` on `fetch` only catches bare identifier use; `globalThis.fetch` needs an additional `no-restricted-properties` entry `{ object: 'globalThis', property: 'fetch' }`.
- The `Buffer#toString` selector cannot distinguish `Buffer` receivers from other objects with a `toString(arg)` method without type information. False positives are unlikely in Snap's domain. A precise alternative is a type-aware custom rule, which is not worth the maintenance for a project this size.
- `JSON.parse` is banned in `src/**` wholesale; whitelist the single decoder module via an `ignores`/`files` override rather than an inline disable, so the exception is visible in config.
- `no-explicit-any` and `no-non-null-assertion` are TypeScript-syntax rules and belong in the shared block, with a test-file override.

### 1.3 Alternatives

**Oxlint 1.81 + oxlint-tsgolint 7.** Rust core with a Go type-aware sidecar; single binary each, no Node dependency tree. Type-aware rules "support the same options as their typescript-eslint equivalents". Has `no-restricted-globals`, `no-restricted-imports`, `no-restricted-properties` (since v1.63), `require-array-sort-compare` (type-aware), `switch-exhaustiveness-check`, `no-floating-promises`, `no-explicit-any`, `no-non-null-assertion`, `no-console`, `unicorn/no-process-exit`, `unicorn/prefer-node-protocol`, `import/extensions`. **Missing:** `no-restricted-syntax` does not appear in the 870-rule reference, so the `Buffer#toString('utf8')` and `TextDecoder` bans cannot be expressed declaratively; JS plugins (ESLint-compatible rule API) are documented but marked alpha. `oxlint --type-aware --type-check` can replace a separate `tsc --noEmit` step. **Requires TypeScript 7.0+**; incompatible with typescript-eslint on the same install without the `@typescript/typescript6` shim.

**Biome 2.5.** Zero-dependency binary with linter + formatter + import organizer. Has `noExplicitAny`, `noNonNullAssertion`, `noConsole`, `useNodejsImportProtocol`, `useImportExtensions`, `noRestrictedImports`, `noRestrictedGlobals`. Its type-dependent rules (`noFloatingPromises`, `useExhaustiveSwitchCases`) are still `nursery` and use Biome's own inference engine rather than `tsc`, so they can disagree with the compiler. No `no-restricted-syntax`/`no-restricted-properties` equivalent; GritQL plugins can express AST bans but are a separate DSL. Good fit for teams that want one binary and accept a weaker type story; less good for Snap's exhaustiveness and promise-safety requirements.

**deno lint.** Not considered further: requires the Deno toolchain and has no type-aware rules.

### 1.4 Recommendation

Default to **ESLint 10 + typescript-eslint 8 on TypeScript 6.0.x** because (a) every required ban is expressible with core rules and a `message`, (b) `strictTypeChecked` plus `switch-exhaustiveness-check` gives exact `tsc`-backed semantics, and (c) the project is small enough that lint speed is not a constraint. Revisit Oxlint when typescript-eslint supports TypeScript 7.1's API (expected Q4 2026) or when a `no-restricted-syntax` equivalent lands, at which point Oxlint + tsgolint + `--type-check` collapses lint and typecheck into one fast step.

## 2. Formatting

### 2.1 Candidates

**Prettier 3.9.** Reference implementation; every editor integrates it. Config surface is intentionally tiny (~12 options). Defaults: `printWidth: 80`, `tabWidth: 2`, `semi: true`, `singleQuote: false`, `trailingComma: "all"` (changed from `es5` in 3.0), `arrowParens: "always"`, `objectWrap: "preserve"`. Import sorting requires a plugin. Package is ~10 MB unpacked, pure JS, no runtime deps of note.

**Oxfmt 0.66.** Rust; Oxc's docs describe it as "the recommended choice when you want a dedicated formatter with a Prettier-compatible workflow, much higher throughput, and built-in sorting features" and claim ~30× Prettier / 2× Biome throughput. Includes import sorting and `package.json` key sorting without plugins. Reads Prettier-style options and has a `migrate from Prettier` guide. Third-party writeups still call it beta (Aug 2026), and it is pre-1.0. Editor support exists via the Oxc VS Code extension.

**Biome formatter.** Prettier-compatible (97%+ on the Prettier test suite per Biome), Rust, bundled with the Biome linter. Only sensible if the Biome linter is also chosen; otherwise it duplicates a binary.

**dprint.** Plugin-host formatter (WASM plugins for TS/JSON/Markdown). Mature, fast, but a smaller ecosystem and requires per-language plugin configuration; no compelling advantage over Oxfmt for a TS-only tree.

### 2.2 ESLint interaction

ESLint 9+ deprecated its core formatting rules and typescript-eslint v8 removed theirs (moved to `@stylistic`). `eslint:recommended` and `strictTypeChecked` therefore contain no rules that conflict with a formatter. `eslint-config-prettier` is only needed if a formatting-rule plugin (e.g. `@stylistic`) is added. **Recommendation: do not install `eslint-config-prettier` unless a conflict actually appears.** Run the formatter and linter as separate steps; never through `eslint-plugin-prettier` (slow, noisy diagnostics).

### 2.3 Recommended defaults and rationale

```json
{
  "printWidth": 100,
  "tabWidth": 2,
  "semi": true,
  "singleQuote": true,
  "trailingComma": "all",
  "arrowParens": "always",
  "objectWrap": "preserve",
  "endOfLine": "lf"
}
```

- `trailingComma: "all"` — adding an argument/element/property touches one line instead of two; stabilizes `git blame`. Prettier's own default since 3.0.
- `arrowParens: "always"` — adding a type annotation or second parameter does not reshape the line. Prettier's default and rationale.
- `printWidth: 100` — Prettier recommends 80 for prose-like readability; 100 is a common compromise for TypeScript, where type annotations and generics lengthen lines, and reduces awkward wraps that produce multi-line diffs for single-token edits. Either is defensible; the point is to pick one and never change it (changing `printWidth` reformats the entire repo and destroys blame). If in doubt, keep Prettier's 80.
- `singleQuote: true` — fewer escape characters in shell-like strings (Snap prints paths and messages containing double quotes in error output). Prettier's default is double quotes because JSON uses them; both are stable choices. Pick by counting escapes in your first 500 lines.
- `semi: true` — avoids ASI hazards and matches TypeScript's own codebase style.
- `objectWrap: "preserve"` (3.5+ default) — lets authors keep intentional multi-line objects (e.g. operation records) without fighting the formatter.
- `endOfLine: "lf"` — Snap's on-disk format is byte-exact; do not let Windows contributors introduce CRLF into fixtures.

Prettier and Oxfmt accept the same key names, so this block is portable between the two. Put it in `.prettierrc.json` (Prettier) or `.oxfmtrc.json` (Oxfmt); do not embed it in `package.json` so editors pick it up uniformly.

### 2.4 Recommendation

Default to **Prettier 3.9** now: universally supported, stable options, no beta caveats. Treat **Oxfmt** as the drop-in upgrade once it ships 1.0 — the config is compatible, and its built-in import sorting would let you drop the import-order lint rule entirely. If the team already leans Oxc (e.g. chooses Oxlint in §1), adopt Oxfmt at the same time and accept the beta label.

## 3. Testing

### 3.1 Node 24 `node:test` and `node:assert/strict`

The Node test runner is Stability 2 (stable since v20). Relevant Node 24 facts:

- **TypeScript execution:** type stripping is stable since v24.12.0 (no warning since v24.3.0). `node --test` discovers `**/*.test.{cts,mts,ts}`, `**/test/**/*.{cts,mts,ts}`, etc. by default unless `--no-strip-types` is passed. So `.ts` tests run **without tsx** as long as the code is erasable-only (no enums, namespaces with values, parameter properties) and relative imports carry extensions. `node --import tsx --test` (or `tsx --test`) still works and additionally supports non-erasable syntax and extensionless imports.
- **Snapshots:** stable since v23.4.0. `t.assert.snapshot(value)`; update with `--test-update-snapshots`; snapshot path and serializers are configurable via `snapshot.setResolveSnapshotPath` / `setDefaultSnapshotSerializers`. Useful for Snap's diff-golden style outputs.
- **Coverage:** `--experimental-test-coverage` is Stability 1 (Experimental). Reports text/lcov; thresholds via `--test-coverage-lines` etc. Adequate for CI reporting; do not gate merges on it yet.
- **Watch mode:** `--watch` with `--test` is Stability 1 (Experimental) but functional.
- **Mocking:** `mock.fn`, `mock.method`, `mock.getter/setter`, `mock.property`, `mock.timers` are stable; **module mocking (`mock.module`) requires `--experimental-test-module-mocks`**. Snap should not need module mocks if filesystem and I/O are injected.
- **Assertions:** `node:assert/strict` provides `deepStrictEqual`, `throws`, `rejects`, `match`. No `expect`-style matchers; error messages are diff-based and adequate.
- Newer conveniences: `--test-rerun-failures <file>`, `--test-isolation=none` (single-process for speed), `it.expectFailure` (v24.14), `t.assert.register`, global setup/teardown, and per-test `context.log` (v24.20).

Dependency weight: zero.

### 3.2 Vitest 5

Vitest 5.0 sits on Vite 6/7/8 and Node ≥20; `npm view vitest dependencies` lists 13 direct dependencies plus a `vite` peer, and coverage needs `@vitest/coverage-v8` (Vitest 4+ uses AST-aware remapping, accurate). Advantages: `expect` matchers with rich diffs, inline snapshots, `vi.mock` module mocking without flags, first-class watch UI, type-testing (`expectTypeOf`), `projects` for multi-config. It transforms TS through Vite/Rolldown, so `tsconfig` is irrelevant at run time (and `verbatimModuleSyntax` mistakes will not surface). Speed for a small suite is similar to `node:test`; startup is heavier.

For a library whose production code is built-in-only and whose acceptance tests already live in a language-neutral YAML harness, Vitest's ergonomics buy little and cost a large transitive tree plus a second module loader whose semantics differ from Node's. It also encourages `vi.mock`, which conflicts with the dependency-injection style Snap needs anyway for deterministic filesystem tests.

### 3.3 Layout and tsconfig

- **Location:** colocated `src/**/*.test.ts` or a sibling `test/` tree both match Node's default globs. Colocation keeps unit tests next to the module and makes the ESLint `files` override obvious (`**/*.test.ts`). The repo's own `test-harness/` uses `test/*.test.ts` with `tsx --test`; either is fine, but pick one for `ts/`. Recommended: `ts/src/**/*.test.ts` for unit tests; keep golden fixtures under `ts/test/fixtures/` if needed.
- **Single tsconfig:** since `noEmit` is set, include tests in the same `tsconfig.json` (`"include": ["src/**/*.ts"]` already covers colocated tests). This is required for type-aware ESLint to lint tests and means tests are type-checked by `npm run build`. Do not create a separate `tsconfig.test.json` unless emit is added later.
- **`types`:** with TS 6 the default `types` is `[]`; set `"types": ["node"]` so `node:test`, `process`, and `Buffer` resolve.
- **Scripts:** `"test": "node --test"` if imports carry `.ts` extensions (see §4/§6) or `"test": "tsx --test"` otherwise; `"test:watch": "node --test --watch"`; `"test:cov": "node --test --experimental-test-coverage"`.

### 3.4 Property-based testing

**fast-check 4.9** is the de facto standard: a single runtime dependency (`pure-rand`), ESM + CJS, TypeScript types built in, actively released (4.7–4.9 in spring 2026, weekly-ish patch cadence), and runner-agnostic — `fc.assert(fc.property(fc.array(fc.uint8Array()), (chunks) => …))` inside a `node:test` `test()` works without an adapter. Arbitraries relevant to Snap: `fc.uint8Array`, `fc.string({ unit: 'binary' })` / `fc.fullUnicodeString`, `fc.commands` for model-based testing of the working tree, `fc.scheduler` for interleaving async operations, `fc.stringMatching` with `\p{…}` (4.7+). Shrinking, replay via `{ seed, path }`, and `fc.pre` are all present.

Alternatives: `@fast-check/vitest` (only if Vitest); `jsverify` (unmaintained); Effect's `@effect/schema` arbitraries (pulls the Effect runtime). None beat fast-check on dependency count.

Use cases worth writing first: OT transform/compose laws (TP1 on random operation pairs), diff-then-patch round-trips on random byte strings, repository serialize/parse round-trips, and merge commutativity on non-conflicting edits.

### 3.5 Recommendation

**`node:test` + `node:assert/strict` + fast-check.** Zero extra runner dependencies; tests run under the same loader and module semantics as production; property tests cover the algebraic core. Adopt Vitest only if the team finds `assert` diffs insufficient — the migration is mechanical.

## 4. Type checking and tsconfig strictness

### 4.1 Current state

`ts/tsconfig.json` today: `target ES2022`, `module ESNext`, `moduleResolution bundler`, `strict`, `noUncheckedIndexedAccess`, `noImplicitOverride`, `noFallthroughCasesInSwitch`, `esModuleInterop`, `skipLibCheck`, `isolatedModules`, `noEmit`; `include: ["src/**/*.ts"]`. `package.json` pins `typescript ^5.9.2`, `@types/node ^22`, `tsx ^4.20`.

### 4.2 Proposed delta

```jsonc
{
  "compilerOptions": {
    // Module system: match Node's own resolution, not a bundler's.
    "module": "nodenext",            // implies moduleResolution nodenext; requires extensions on relative imports
    "target": "es2024",              // Node 24 supports ES2024 fully; TS 6 default floats to es2025
    "types": ["node"],               // TS 6 default is []; be explicit (also faster)
    "lib": ["es2024"],

    // Strictness
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,      // `{ a?: string }` rejects `{ a: undefined }`; matters for op/record shapes
    "noPropertyAccessFromIndexSignature": true, // forces `obj["k"]` for index signatures, surfaces `undefined` intent
    "noImplicitOverride": true,
    "noFallthroughCasesInSwitch": true,
    "noImplicitReturns": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "useUnknownInCatchVariables": true,      // already in strict; listed for visibility

    // ESM / runtime alignment
    "verbatimModuleSyntax": true,    // replaces isolatedModules; forces `import type`, matches Node type-stripping semantics
    "erasableSyntaxOnly": true,      // bans enum, value namespaces, parameter properties, import= aliases
    "allowImportingTsExtensions": true,   // permits `./foo.ts` specifiers (needs noEmit — set)
    "rewriteRelativeImportExtensions": true, // harmless under noEmit; future-proofs an emit step
    "noUncheckedSideEffectImports": true,    // TS 6 default; typos in `import "./x"` become errors
    "esModuleInterop": true,         // TS 6 deprecates `false`
    "skipLibCheck": true,
    "noEmit": true
  },
  "include": ["src/**/*.ts"]
}
```

Option-by-option justification:

- **`module: nodenext`** vs the current `esnext + bundler`: Snap is executed by Node (via tsx today, potentially natively tomorrow), never bundled. `bundler` resolution accepts extensionless relative imports that Node rejects; `nodenext` makes `tsc` enforce exactly what Node enforces, including mandatory extensions and `import type` discipline. TS 6.0 also deprecates `moduleResolution: node` and steers Node projects to `nodenext`. Cost: every relative import must end in `.ts` (with `allowImportingTsExtensions`) — a one-time mechanical change enforced by `import-x/extensions` or simply by `tsc`.
- **`verbatimModuleSyntax`** supersedes `isolatedModules` and is the option Node's docs recommend for type stripping: without it, `import { SomeType } from './x.ts'` compiles under `tsc` but fails at runtime under Node's stripper. Remove `isolatedModules`.
- **`erasableSyntaxOnly`** (TS 5.8+) makes `tsc` reject the same constructs Node's stripper rejects (`ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX`). Node docs explicitly recommend it. It also eliminates `enum`, which is desirable regardless.
- **`exactOptionalPropertyTypes`** is the most impactful non-default strictness flag for a data-model-heavy project: `{ author?: string }` no longer accepts an explicit `undefined`, so serialized records never carry `"author": undefined` ambiguity. It has a real adoption cost with `@types/node` APIs that pass `undefined` explicitly; enable it from day one rather than retrofitting.
- **`noPropertyAccessFromIndexSignature`** forces bracket access on `Record<string, T>`, visually distinguishing "known property" from "lookup that may be undefined". Complements `noUncheckedIndexedAccess`.
- **`noUnusedLocals/Parameters`** can be left to ESLint (`@typescript-eslint/no-unused-vars`) instead; having both is redundant. Prefer the compiler versions so `npm run build` alone catches them, and disable the ESLint rule.
- **`target: es2024`** vs TS 6's floating default: pinning avoids surprise lib changes on TS upgrades; Node 24 (V8 13.6) implements ES2024 fully. `lib` follows `target`.
- **`skipLibCheck`** stays: `@types/node` is the only library, and checking it costs time without benefit.

### 4.3 TypeScript version and tsgo

- **Pin `typescript` to `~6.0.3`** while using typescript-eslint. An unpinned `^6` is also safe; `latest` is not (resolves to 7.0.2). TS 7.0 would also reject nothing in the proposed tsconfig (no `baseUrl`, no legacy `moduleResolution`, `esModuleInterop: true`), so the config is TS 7-ready.
- **tsgo for faster `noEmit`:** for Snap's size, `tsc` 6 finishes in a few seconds; there is no need for the side-by-side `@typescript/native-preview` install and its extra dev dependency. Note that `@typescript/native-preview` is a nightly channel (`7.0.0-dev.*`); the GA route is `typescript@7` itself. If lint moves to Oxlint (§1.3), `oxlint --type-aware --type-check` already runs tsgo's checker and `tsc` becomes redundant.
- **`@types/node`:** bump to `^24` to match the runtime (currently `^22`). `@types/node@26` exists but describes Node 26 APIs that 24 lacks.

### 4.4 Running: tsx vs native type stripping

With the tsconfig above, `node src/main.ts` runs without tsx because all syntax is erasable and imports carry extensions. tsx remains useful for (a) extensionless imports during a transition, (b) source-maps for transformed syntax, and (c) `tsx watch`. Keep tsx as a dev dependency for now; the `./snap` launcher used by the harness can switch to plain `node` once imports are extension-qualified, removing a startup-time dependency. Node does not read `tsconfig.json`; `paths` aliases are unsupported (use `#`-prefixed subpath `imports` in `package.json` if aliases are ever wanted — TS 6 also supports `#/`).

## 5. Pre-commit and CI gates

### 5.1 Options

**Plain `.githooks/` + `git config core.hooksPath .githooks`.** Zero dependencies. A `prepare` script (`"prepare": "git config core.hooksPath .githooks"`) installs it on `npm install`. Hooks are shell scripts committed to the repo. Bypass: `git commit --no-verify`, same as every option below. Downsides: no parallelism or staged-file filtering without writing it yourself; Windows contributors need a POSIX shell.

**simple-git-hooks 2.14.** ~16 KB, zero dependencies. Configuration is a flat map in `package.json` (`"simple-git-hooks": { "pre-commit": "npm run check" }`) plus `"prepare": "simple-git-hooks"`. Runs one command per hook; no staged-file filtering, no parallelism. Essentially a portable installer for the plain-hooks approach.

**Husky 9.1.** ~4 KB, zero dependencies. `"prepare": "husky"` writes `.husky/_/` and hook files are plain shell in `.husky/`. Adds nothing over simple-git-hooks except ubiquity. Usually paired with **lint-staged 17** (5 dependencies) to run linters only on staged files — valuable in large repos, unnecessary when full `lint` + `tsc` takes under ten seconds.

**Lefthook 2.1.** Go binary distributed via npm (~28 KB wrapper, downloads platform binary). YAML config (`lefthook.yml`) supports parallel commands, `{staged_files}` templating with glob filters, `skip`/`only` by branch or env, and `LEFTHOOK=0` to bypass. Fastest option for multi-command hooks; adds a non-JS binary to the dev environment and a YAML file.

### 5.2 Trade-offs for Snap

Snap's full gate (`prettier --check`, `eslint`, `tsc --noEmit`, `node --test`) will run in seconds. Staged-file filtering and parallelism are premature. The dominant criteria are therefore dependency count and portability: plain hooks or simple-git-hooks win. Between them, simple-git-hooks costs one tiny dependency and gains Windows/PowerShell tolerance and self-installation; plain hooks cost nothing and are fully transparent. Either is acceptable; the doc recommends **simple-git-hooks** for the self-install ergonomics, with plain hooks as the zero-dep fallback.

Bypass policy: pre-commit hooks are a convenience; **CI is the gate**. Every option is bypassable with `--no-verify`, so the same `npm run check` must run in CI on every push/PR and be required for merge.

### 5.3 Aggregate script shape

```jsonc
// ts/package.json (scripts)
{
  "start": "tsx src/main.ts",
  "build": "tsc --noEmit",                 // keep the existing name; it is the type-check gate
  "typecheck": "tsc --noEmit",
  "lint": "eslint .",
  "lint:fix": "eslint . --fix",
  "format": "prettier --write .",
  "format:check": "prettier --check .",
  "test": "node --test",                   // or "tsx --test" until imports are extension-qualified
  "test:watch": "node --test --watch",
  "check": "npm run format:check && npm run lint && npm run typecheck && npm test",
  "prepare": "simple-git-hooks"
},
"simple-git-hooks": { "pre-commit": "cd ts && npm run check" }
```

Ordering rationale: cheapest-first so a formatting slip fails in under a second; `test` last because it is the only step that executes code. Use `&&` rather than `npm-run-all`/`concurrently` to avoid another dependency; parallelism is not needed at this scale. If the hook lives at the repo root (the git root is `/…/snap`, not `ts/`), the `cd ts` prefix or a root-level `package.json` delegating into `ts/` and `test-harness/` is required — this is why the config above `cd`s explicitly.

CI: a single job running `npm ci && npm run check` in `ts/` (and the same in `test-harness/`), plus `./verify --lang ts` for the acceptance suite. Cache `~/.npm` keyed on the lockfile.

## 6. Import conventions

### 6.1 `node:` prefix

Three rule implementations exist, all auto-fixable:

- `n/prefer-node-protocol` (`eslint-plugin-n@18`) — reads `engines.node` to decide applicability.
- `unicorn/prefer-node-protocol` (`eslint-plugin-unicorn`) — also handles `process.getBuiltinModule` and `import('fs')` types.
- `import-x/enforce-node-protocol-usage` (`eslint-plugin-import-x@4`) — the same check inside the import plugin (option `"always"`).
- Biome: `style/useNodejsImportProtocol` (recommended, on by default). Oxlint: `unicorn/prefer-node-protocol`.

Zero-plugin fallback using ESLint core: a `no-restricted-imports` `patterns` entry with a regex over the built-in module names, e.g. `{ regex: '^(assert|buffer|child_process|crypto|events|fs|http|https|os|path|readline|stream|string_decoder|url|util|zlib)(/.*)?$', message: 'Use the node: prefix.' }`. Not auto-fixable and requires maintaining the list; acceptable for a project that uses a dozen built-ins.

### 6.2 Import ordering

- **`import-x/order`** — mature, groups (`builtin`, `external`, `internal`, `parent`, `sibling`, `index`, `type`), `newlines-between`, alphabetize. Also brings `import-x/extensions`, `no-unresolved`, `no-duplicates`, `enforce-node-protocol-usage`. import-x has 16 dependencies (vs 117 for `eslint-plugin-import`) and a Rust resolver; the TS resolver package is only needed for `paths`/`exports` resolution, which Snap does not use — set `settings: { 'import-x/extensions': ['.ts'] }` for the built-in node resolver instead.
- **`perfectionist/sort-imports`** (`eslint-plugin-perfectionist@5`) — deterministic natural sort with configurable groups, also sorts named specifiers, object keys, union members, etc. Excellent fixer; does not check extensions or resolution.
- **Formatter-side:** Oxfmt sorts imports natively; Biome's `assist.actions.source.organizeImports` sorts by "distance" (URL → `node:` → packages → aliases → relative) and merges duplicates; Prettier needs `prettier-plugin-organize-imports` (uses the TS language service) or `@ianvs/prettier-plugin-sort-imports`.

Ordering is cosmetic; its value is diff stability, not correctness. The cheapest way to get it with the recommended stack is one ESLint plugin that also does useful correctness work — **import-x** — configured minimally:

```js
import { importX } from 'eslint-plugin-import-x';
// …
importX.flatConfigs.recommended,
importX.flatConfigs.typescript,
{
  settings: { 'import-x/extensions': ['.ts'], 'import-x/resolver': { node: { extensions: ['.ts'] } } },
  rules: {
    'import-x/extensions': ['error', 'always', { ignorePackages: true, checkTypeImports: true }],
    'import-x/enforce-node-protocol-usage': ['error', 'always'],
    'import-x/no-duplicates': ['error', { 'prefer-inline': true }],
    'import-x/order': ['error', {
      groups: ['builtin', 'external', 'parent', 'sibling', 'index', 'type'],
      'newlines-between': 'always',
      alphabetize: { order: 'asc', caseInsensitive: false },
    }],
  },
},
```

If the team prefers zero import plugins: rely on `tsc` (`nodenext` already errors on missing extensions), use the `no-restricted-imports` regex for `node:`, and defer ordering to Oxfmt when adopted.

### 6.3 File extensions under ESM

Node ESM requires explicit extensions in relative specifiers; with type stripping the specifier must be the on-disk `.ts` name (`import './file.ts'`). `allowImportingTsExtensions` lets `tsc` accept this (it requires `noEmit` or `rewriteRelativeImportExtensions`, both set). The alternative convention — writing `.js` in specifiers for `.ts` sources — only makes sense with an emit step and is confusing in a no-build project. **Convention: always `.ts` in relative imports; never extensionless; never `.js`.** `import-x/extensions: 'always'` with `checkTypeImports: true` enforces it on `import type` too.

## 7. Recommended default stack

Direct dev dependencies (10), with justification:

- `typescript` `~6.0.3` — compiler and `noEmit` gate. 6.x rather than 7.x solely because of typescript-eslint's peer range; the tsconfig is already 7-compatible.
- `@types/node` `^24.13.3` — matches the runtime; TS 6 no longer auto-includes it, hence `types: ["node"]`.
- `tsx` `^4.23.13` — already present; keeps extensionless imports working during the transition and provides `watch`. Removable once §6.3 is applied and `./snap` invokes `node` directly.
- `eslint` `^10.10.0` — linter host; flat config only.
- `@eslint/js` `^10.0.1` — `eslint:recommended` as a flat config object.
- `typescript-eslint` `^8.69.0` — parser, plugin, `strictTypeChecked`/`stylisticTypeChecked`, `projectService`.
- `eslint-plugin-import-x` `^4.17.1` — `.ts` extension enforcement, `node:` prefix, duplicate merging, import order. Optional; drop if the team accepts `tsc`-only extension checking and no ordering.
- `prettier` `^3.9.6` — formatter. Swap for `oxfmt` at 1.0.
- `fast-check` `^4.9.0` — property-based tests; one transitive dependency.
- `simple-git-hooks` `^2.14.0` — installs the pre-commit hook; zero dependencies. Or omit and use `.githooks` + `core.hooksPath`.

Not included and why: `eslint-config-prettier` (no formatting rules are enabled, so no conflicts); `vitest` (§3.2); `lint-staged`/`husky`/`lefthook` (§5.2); `@typescript/native-preview` or `typescript@7` (§4.3); `eslint-plugin-n`/`unicorn` (import-x covers the one rule needed); `eslint-import-resolver-typescript` (no `paths`/`exports` to resolve).

### 7.1 `eslint.config.js`

```js
// ts/eslint.config.js
import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import { importX } from 'eslint-plugin-import-x';
import tseslint from 'typescript-eslint';

// typescript-eslint docs now show `defineConfig` from eslint/config; `tseslint.config()` still works.
export default defineConfig(
  { ignores: ['node_modules/**'] },
  js.configs.recommended,
  tseslint.configs.strictTypeChecked,
  tseslint.configs.stylisticTypeChecked,
  importX.flatConfigs.recommended,
  importX.flatConfigs.typescript,
  {
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    settings: {
      'import-x/extensions': ['.ts'],
      'import-x/resolver': { node: { extensions: ['.ts'] } },
    },
    rules: {
      // Exhaustiveness and async safety
      '@typescript-eslint/switch-exhaustiveness-check': ['error', {
        requireDefaultForNonUnion: true,
        considerDefaultExhaustiveForUnions: false,
      }],
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/require-array-sort-compare': ['error', { ignoreStringArrays: false }],
      // Boundaries and types
      '@typescript-eslint/explicit-module-boundary-types': 'error',
      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-non-null-assertion': 'error',
      '@typescript-eslint/no-unused-vars': 'off', // tsc noUnusedLocals/Parameters own this
      // Imports
      'import-x/extensions': ['error', 'always', { ignorePackages: true, checkTypeImports: true }],
      'import-x/enforce-node-protocol-usage': ['error', 'always'],
      'import-x/no-duplicates': ['error', { 'prefer-inline': true }],
      'import-x/order': ['error', {
        groups: ['builtin', 'external', 'parent', 'sibling', 'index', 'type'],
        'newlines-between': 'always',
        alphabetize: { order: 'asc', caseInsensitive: false },
      }],
    },
  },
  {
    // Production-only bans (see §1.2 for messages)
    files: ['src/**/*.ts'],
    ignores: ['src/**/*.test.ts'],
    rules: {
      'no-restricted-globals': ['error', { name: 'fetch', message: '…' }],
      'no-restricted-properties': ['error',
        { object: 'JSON', property: 'parse', message: '…' },
        { object: 'process', property: 'exit', message: '…' },
        { object: 'globalThis', property: 'fetch', message: '…' },
        { property: 'localeCompare', message: '…' },
        { object: 'console', property: 'log', message: '…' },
        { object: 'console', property: 'error', message: '…' },
      ],
      'no-restricted-syntax': ['error',
        { selector: "CallExpression[callee.property.name='toString'][arguments.0.value=/^utf-?8$/i]", message: '…' },
        { selector: "NewExpression[callee.name='TextDecoder']:not([arguments.1.properties.0.key.name='fatal'])", message: '…' },
        { selector: 'TSEnumDeclaration', message: '…' },
      ],
    },
  },
  {
    // The one sanctioned JSON decoder
    files: ['src/repository/decode.ts'],
    rules: { 'no-restricted-properties': 'off' },
  },
  {
    // Tests: allow `!` and console for debugging output
    files: ['**/*.test.ts'],
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
    },
  },
);
```

Adjust the decoder path to wherever the validated JSON entry point lands; the point is that the exception is a `files` override, not an inline disable.

### 7.2 `.prettierrc.json`

See §2.3. Add `.prettierignore` with `node_modules` and any golden-fixture directories whose bytes must not change.

### 7.3 `tsconfig.json`

See §4.2. Net delta from today: `module esnext→nodenext`, remove `moduleResolution bundler`, `target ES2022→es2024`, add `types`, `exactOptionalPropertyTypes`, `noPropertyAccessFromIndexSignature`, `noImplicitReturns`, `noUnusedLocals`, `noUnusedParameters`, `verbatimModuleSyntax` (replacing `isolatedModules`), `erasableSyntaxOnly`, `allowImportingTsExtensions`, `rewriteRelativeImportExtensions`, `noUncheckedSideEffectImports`.

### 7.4 Alternative stack (Oxc lane)

If the team prefers the native lane: `typescript@^7.0.2`, `oxlint@^1.81`, `oxlint-tsgolint@^7.0.2001`, `oxfmt@^0.66`, `fast-check`, `simple-git-hooks`, `@types/node`, `tsx` — 8 direct dependencies, and `oxlint --type-aware --type-check` replaces `tsc --noEmit`. What you give up: `no-restricted-syntax` (the `Buffer#toString('utf8')` and `TextDecoder` bans would need an alpha JS plugin or a code-review convention) and typescript-eslint's exact rule semantics for the two unported rules (`naming-convention`, `prefer-destructuring`, neither needed here). What you gain: one TypeScript install, ~10× faster lint+typecheck, formatter-side import sorting, and no future migration off TS 6.

## Conclusion

Adopt the ESLint lane now: TypeScript `~6.0.3` with a `nodenext`/`verbatimModuleSyntax`/`erasableSyntaxOnly`/`exactOptionalPropertyTypes` tsconfig, ESLint 10 + typescript-eslint `strictTypeChecked` with `projectService`, core `no-restricted-*` rules for the API bans, import-x for extensions/`node:`/order, Prettier with `trailingComma: all` and a fixed `printWidth`, `node:test` + `node:assert/strict` + fast-check, and simple-git-hooks running `npm run check` with CI as the real gate. Ten direct dev dependencies, all justified above.

Plan to re-evaluate in Q4 2026 when TypeScript 7.1 ships its compiler API: either typescript-eslint gains TS 7 support (bump `typescript` to 7, keep everything else) or the Oxc lane becomes strictly better (swap ESLint/Prettier for Oxlint/Oxfmt, delete `tsc` from `check`). The tsconfig and formatter options proposed here are already compatible with both outcomes.

Open questions for the implementer:

- Whether to convert relative imports to `.ts` extensions immediately (enables `node --test` and `node src/main.ts` without tsx) or keep `bundler` resolution + tsx for a first milestone.
- Where the single sanctioned `JSON.parse` call lives, so the ESLint override path can be fixed.
- `printWidth` 80 vs 100 and `singleQuote` — pick once before the first commit of source.
- Whether a root-level `package.json` should orchestrate `ts/` and `test-harness/` checks, or hooks `cd` into each.

## References

- TypeScript 6.0 release notes (defaults: `strict`, `module esnext`, `types`, deprecations of `baseUrl`, `moduleResolution node`, `target es5`, `--stableTypeOrdering`): https://www.typescriptlang.org/docs/handbook/release-notes/typescript-6-0.html
- TypeScript 5.8 release notes (`erasableSyntaxOnly`, `--module nodenext` stable): https://www.typescriptlang.org/docs/handbook/release-notes/typescript-5-8.html
- TypeScript 5.7 release notes (`rewriteRelativeImportExtensions`): https://www.typescriptlang.org/docs/handbook/release-notes/typescript-5-7.html
- Announcing TypeScript 7.0 (Microsoft DevBlogs), and `@typescript/typescript6` shim: https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/
- typescript-eslint issue #12518 (TS 7.0 incompatibility, closed pending TS 7.1 API): https://github.com/typescript-eslint/typescript-eslint/issues/12518
- Node.js 24 — Modules: TypeScript (type stripping stable v24.12, recommended tsconfig, mandatory extensions): https://nodejs.org/docs/latest-v24.x/api/typescript.html
- Node.js 24 — Test runner (stability of coverage, watch, snapshots, module mocks; default file patterns incl. `.ts`): https://nodejs.org/docs/latest-v24.x/api/test.html
- ESLint v10.0.0 release notes: https://eslint.org/blog/2026/02/eslint-v10.0.0-released/
- ESLint core rules: https://eslint.org/docs/latest/rules/no-restricted-syntax , https://eslint.org/docs/latest/rules/no-restricted-properties , https://eslint.org/docs/latest/rules/no-restricted-globals , https://eslint.org/docs/latest/rules/no-restricted-imports
- typescript-eslint: Typed linting and `projectService`: https://typescript-eslint.io/getting-started/typed-linting/ and https://typescript-eslint.io/packages/parser/#projectservice
- typescript-eslint shared configs: https://typescript-eslint.io/users/configs/
- typescript-eslint rules: https://typescript-eslint.io/rules/switch-exhaustiveness-check/ , https://typescript-eslint.io/rules/require-array-sort-compare/ , https://typescript-eslint.io/rules/no-floating-promises/ , https://typescript-eslint.io/rules/consistent-type-imports/ , https://typescript-eslint.io/rules/explicit-module-boundary-types/
- eslint-plugin-import-x README and rules (`extensions`, `enforce-node-protocol-usage`, `order`): https://github.com/un-ts/eslint-plugin-import-x
- eslint-plugin-n `prefer-node-protocol`: https://github.com/eslint-community/eslint-plugin-n/blob/master/docs/rules/prefer-node-protocol.md
- eslint-plugin-unicorn `prefer-node-protocol`: https://github.com/sindresorhus/eslint-plugin-unicorn/blob/main/docs/rules/prefer-node-protocol.md
- eslint-plugin-perfectionist: https://perfectionist.dev/
- Oxlint type-aware linting guide (tsgolint, `--type-check`, TS 7 requirement): https://oxc.rs/docs/guide/usage/linter/type-aware.html
- Oxc blog: Type-Aware Linting Stable (2026-07-22, 59/61 rules, benchmarks, versioning): https://oxc.rs/blog/2026-07-22-type-aware-linting-stable.html
- Oxlint rules reference (870 rules; confirms absence of `no-restricted-syntax`): https://oxc.rs/docs/guide/usage/linter/rules.html
- Oxlint JS plugins (alpha): https://oxc.rs/docs/guide/usage/linter/js-plugins.html
- Oxfmt overview (Prettier-compatible, built-in sorting): https://oxc.rs/docs/guide/usage/formatter.html
- Biome rules: https://biomejs.dev/linter/rules/use-nodejs-import-protocol/ , https://biomejs.dev/linter/rules/no-floating-promises/ (nursery, types domain), https://biomejs.dev/linter/rules/use-exhaustive-switch-cases/ , https://biomejs.dev/linter/rules/use-import-extensions/ , https://biomejs.dev/assist/actions/organize-imports/ , https://biomejs.dev/linter/plugins/
- Prettier options and rationale: https://prettier.io/docs/options and https://prettier.io/docs/rationale
- Vitest 4/5 migration guide (Vite ≥6, Node ≥20, coverage changes): https://vitest.dev/guide/migration
- fast-check releases and docs: https://github.com/dubzzz/fast-check/releases , https://fast-check.dev/
- Lefthook: https://github.com/evilmartians/lefthook
- simple-git-hooks: https://github.com/toplenboren/simple-git-hooks
- Husky: https://typicode.github.io/husky/
- lint-staged: https://github.com/lint-staged/lint-staged
- git `core.hooksPath`: https://git-scm.com/docs/githooks
- Registry versions observed 2026-09-04 via `npm view <pkg> version` / `peerDependencies` (see Landscape summary).
