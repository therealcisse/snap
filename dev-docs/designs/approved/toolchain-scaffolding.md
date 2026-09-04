---
title: "Realized: ESLint-lane toolchain for ts/, Node-aligned tsconfig, and the CLI skeleton with the §10 failure model"
date: 2026-09-04
author: agent
id: toolchain-scaffolding
issue: toolchain-scaffolding
plan: toolchain-scaffolding
---

## Summary

`ts/` now has the enforcement mechanism `ts/AGENTS.md` already promised: `npm run check` runs Prettier, type-checked ESLint (with the SPEC-motivated API bans), `tsc --noEmit` on TypeScript 6.0.3, and `node --test` over colocated `src/**/*.test.ts`, and a simple-git-hooks pre-commit hook runs it. `tsconfig.json` is rewritten to `nodenext`/`es2024` with `erasableSyntaxOnly` and `.ts`-extension imports so Node 24 runs the source without tsx. The minimal code the gate needs to prove itself is in place: `src/core/errors.ts` (the §10 exit-code contract), `src/cli/main.ts` (the single write point), a two-line `src/main.ts`, and seven unit tests. Every invocation currently exits 1 with `snap: not implemented: <args>`; `ts/snap`, `run`, `run_tests`, `verify`, and `ts/AGENTS.md` are unchanged.

## Plan Realized

### toolchain-scaffolding

All ten tasks executed. Three deviations, all confined to `ts/eslint.config.js` and the test count:

1. The plan's rule `import-x/enforce-node-protocol-usage` does not exist in `eslint-plugin-import-x@4.17.1` (ESLint aborts with "Could not find" at startup; the only node-related rule is `no-nodejs-modules`). The `node:` prefix is enforced instead with core `no-restricted-imports`, generated from `builtinModules` of `node:module`: every bare built-in name as a `paths` entry and every `name/*` as a `patterns` entry, each with a message naming the `node:` form.
2. `strictTypeChecked` reports `@typescript-eslint/no-floating-promises` on every `describe`/`it` call because `node:test` returns promises the runner itself awaits. A `**/*.test.ts` override keeps the rule at `error` but lists `describe`, `it`, `test` from `node:test` under `allowForKnownSafeCalls`.
3. One extra unit test (`SnapError` is an `Error` named `SnapError`) beyond the six the plan enumerated; seven run in total.

The `createNodeResolver` fallback the plan anticipated was not needed; the export exists in 4.17.1.

## Implementation

`ts/tsconfig.json`: replaced wholesale with the plan's Step 1 block — `module nodenext`, `target es2024`, `lib [es2024]`, `types [node]`, all strict flags (`strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noPropertyAccessFromIndexSignature`, `noImplicitOverride`, `noFallthroughCasesInSwitch`, `noImplicitReturns`, `noUnusedLocals`, `noUnusedParameters`), the Node-alignment flags (`verbatimModuleSyntax`, `erasableSyntaxOnly`, `allowImportingTsExtensions`, `rewriteRelativeImportExtensions`, `noUncheckedSideEffectImports`), `esModuleInterop`, `skipLibCheck`, `noEmit`; `include: ["src/**/*.ts"]`. `moduleResolution` and `isolatedModules` dropped.

`ts/package.json`: `engines.node >=24`; scripts `start` (tsx), `build`/`typecheck` (aliases for `tsc --noEmit`), `lint`/`lint:fix`, `format`/`format:check`, `test` (`node --test 'src/**/*.test.ts'`), `test:watch`, `check` (format:check → lint → typecheck → test), `prepare` (`simple-git-hooks`); `simple-git-hooks.pre-commit = "cd ts && npm run check"`; devDependencies exactly as settled (`typescript ~6.0.3`, `typescript-eslint ^8.69.0`, `eslint ^10.10.0`, `@eslint/js ^10.0.1`, `eslint-plugin-import-x ^4.17.1`, `prettier ^3.9.6`, `fast-check ^4.9.0`, `simple-git-hooks ^2.14.0`, `tsx ^4.23.13`, `@types/node ^24.13.3`). `package-lock.json` regenerated (167 packages); `.git/hooks/pre-commit` installed by `prepare`.

`ts/eslint.config.js` (flat config, `defineConfig`): `js.configs.recommended`, `tseslint.configs.strictTypeChecked` + `stylisticTypeChecked`, `importX.flatConfigs.recommended` + `.typescript`; `projectService: true` with `tsconfigRootDir: import.meta.dirname`; `import-x/resolver-next: [createNodeResolver({ extensions: ['.ts'] })]`. Project rules: `switch-exhaustiveness-check` (`requireDefaultForNonUnion`, no default-as-exhaustive), `require-array-sort-compare` (string arrays included), `explicit-module-boundary-types`, `consistent-type-imports` (inline), `no-unused-vars` off (tsc owns it), `import-x/extensions` always (incl. type imports), `no-restricted-imports` (node: prefix, see deviation 1), `import-x/no-duplicates` prefer-inline, `import-x/order` (builtin, external, parent, sibling, index, type; blank line between groups; case-sensitive ascending). Ban block on `src/**/*.ts` minus `*.test.ts`: `no-restricted-globals` (`fetch`), `no-restricted-properties` (`JSON.parse`, `process.exit`, `globalThis.fetch`, `localeCompare`, `console.log`, `console.error`), `no-restricted-syntax` (`toString('utf8')` probe, `TextDecoder` without `fatal`, `TSEnumDeclaration`), each with the SPEC-citing message from the plan. Overrides: `src/core/json.ts` → `no-restricted-properties` off; `**/*.test.ts` → `no-non-null-assertion` and `no-unsafe-assignment` off plus the `no-floating-promises` allow-list (deviation 2); `**/*.js` → `tseslint.configs.disableTypeChecked`.

`ts/.prettierrc.json`: printWidth 100, tabWidth 2, semi, singleQuote, trailingComma all, arrowParens always, objectWrap preserve, endOfLine lf. `ts/.prettierignore`: `node_modules`, `package-lock.json`, `*.md`.

`ts/src/core/errors.ts`: module doc explaining the two-kind failure model; `export class SnapError extends Error` (constructor takes `detail`, sets `name = 'SnapError'`); `export interface Failure { readonly exitCode: 1 | 2; readonly line: string }`; `export function describeFailure(failure: unknown): Failure` — `SnapError` → `{1, "snap: <message>\n"}`; otherwise `{2, "snap: internal error: <detail>\n"}` with detail = `Error.message` or `String(failure)`.

`ts/src/cli/main.ts`: module doc stating it is the only module writing to the standard streams; `export interface Output { stdout, stderr: (text: string) => void }`; `export function run(argv: readonly string[], out: Output): number` (try `dispatch` → 0; catch → `describeFailure`, write line to `out.stderr`, return `exitCode`); `export function fdOutput(): Output` (`writeSync` to fd 1 and 2); private `dispatch(argv)` throws `new SnapError(\`not implemented: ${argv.join(' ')}\`.trimEnd())`, documented as the seam the CLI-skeleton issue replaces.

`ts/src/main.ts`: `import { fdOutput, run } from './cli/main.ts'; process.exitCode = run(process.argv.slice(2), fdOutput());`.

## Behavior

- Any invocation through `ts/snap`, root `run`, or `node ts/src/main.ts` writes nothing to stdout, writes `snap: not implemented: <argv joined by space>\n` (or `snap: not implemented:\n` for empty argv) to stderr, and exits 1. `./verify --lang ts --filter 01-init` therefore reports the case as *failed* (expected exit 0, got 1; stderr `snap: not implemented: init`), not as a harness error.
- Node 24 executes `src/main.ts` directly: `.ts` relative imports resolve, type annotations are stripped, no tsx involved. The launchers still use tsx.
- `npm run check` exits 0 on the current tree. `git commit` in this repository runs `cd ts && npm run check` first (skippable with `SKIP_SIMPLE_GIT_HOOKS=1`).
- A production source file using any banned API fails lint with the SPEC-citing message; the ban proof (scratch file with `import from 'fs'`, `JSON.parse`, `process.exit`, `localeCompare`, bare `TextDecoder`, `toString('utf8')`, `console.log`, `fetch`, `enum`) produced nine distinct ban errors plus the incidental `no-floating-promises` on `fetch`.
- The exit-code path is exercised end-to-end: `dispatch` throws → `run` catches → `describeFailure` formats → `fdOutput().stderr` writes synchronously → `process.exitCode` set, never `process.exit`.

## Tests

`src/core/errors.test.ts` (5): SnapError → `{1, 'snap: x\n'}`; `TypeError('boom')` → exit 2 internal error; string `'raw'` → exit 2 internal error; fast-check property over `fc.string()` without `\n` that the detail passes through verbatim; `SnapError` is an `Error` with `name === 'SnapError'`. `src/cli/main.test.ts` (2): `run(['--version'])` → 1, empty stdout, exact stderr; `run([])` → 1, `snap: not implemented:\n`. Both use a `captured()` `Output` that buffers into arrays. Not tested: `fdOutput` itself (writes to real descriptors; verified manually by the `ts/snap` and `node` acceptance runs). Total 7 tests, 3 suites, all passing under plain `node --test`.

## Decisions

- `no-restricted-imports` over `builtinModules` rather than dropping node-protocol enforcement or adding another plugin (`eslint-plugin-n`): keeps the dependency set as settled and covers subpath imports (`fs/promises`) via patterns. Cost: the list is computed from the running Node's `builtinModules`, so a built-in new to a future Node minor is banned in its bare form automatically.
- `allowForKnownSafeCalls` scoped to `node:test`'s `describe`/`it`/`test` rather than disabling `no-floating-promises` in tests: a genuinely un-awaited promise inside a test body (e.g. an async assertion) still fails lint.
- `@typescript-eslint/no-unused-vars` off with a comment pointing at `noUnusedLocals`/`noUnusedParameters`: one owner for the diagnostic (tsc), avoiding double reporting in `check`.
- Module-level doc comments in `errors.ts` and `cli/main.ts` state the architectural invariant (two failure kinds; single stream-writing module) rather than restating what the code does; per-member JSDoc only on exported symbols.
- Extra `SnapError` identity test: pins `name` and `instanceof Error`, which `describeFailure` and future stack-trace rendering depend on, at negligible cost.
- Plan's acceptance wording `./snap --version` interpreted as `ts/snap --version` (the plan's own parenthetical says "via `ts/snap`"; no root `snap` exists and creating one is out of scope).

## Follow-Up

- Design `snap-ts-architecture` Test strategy (`ts/test/`, `node --import tsx --test`) is superseded by colocated `src/**/*.test.ts` under plain `node --test`; that design is immutable, so this record is the correction.
- `src/core/json.ts` is named by the ESLint override but does not exist yet (Foundations creates it); until then the override is inert.
- `TEST-HARNESS.md` lines 371–373, 389, 402 still reference `capstones/snap/` (carried over from the previous realized design; still uncaptured).
- Stack `snap-1.0` Scaffolding items (nine) become checkable at `/close-issue`.
