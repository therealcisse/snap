---
title: "ts/ has no lint, format, test, or pre-commit gate, and ts/AGENTS.md references tooling that does not exist"
date: 2026-09-04
start-date: 2026-09-04
author: agent
id: toolchain-scaffolding
stack: snap-1.0
closed: 2026-09-04
---
# ts/ has no lint, format, test, or pre-commit gate, and ts/AGENTS.md references tooling that does not exist

## Problem

The TypeScript workspace cannot yet enforce any of the rules the project has agreed on. `ts/AGENTS.md` tells agents to run `npm run check` before every commit and points at `eslint.config.js` and `.prettierrc.json` as the enforcement mechanism, but none of those exist: `ts/` is a two-script `package.json`, a stub `src/main.ts`, and a generic `tsconfig.json`. Any code written now is checked only by hand, and the conventions most likely to produce wrong bytes (`JSON.parse`, `localeCompare`, `process.exit`, `console.*`, BOM-stripping decoders) have no mechanical guard.

Technically, `ts/package.json` declares only `start` (`tsx src/main.ts`) and `build` (`tsc --noEmit`), with `typescript ^5.9.2`, `@types/node ^22.18.0`, and `tsx ^4.20.5`. `ts/tsconfig.json` uses `module: ESNext` / `moduleResolution: bundler` / `isolatedModules`, which permits extensionless relative imports — but the agreed convention is `.ts` extensions so `node --test` can run unit tests without `tsx`. No ESLint, Prettier, test runner, property-testing library, or git hook is installed. `src/main.ts` is a placeholder; there is no `src/cli/main.ts` for it to delegate to, and no error type distinguishing expected failures (exit 1, `snap: <detail>`) from internal failures (exit 2) per §10 — so there is also nothing for `npm run check` to prove itself against.

## Impact

- Every conventions bullet in `ts/AGENTS.md` marked "enforced by `eslint.config.js`" is currently aspirational; agents implementing Foundations onward would rely on review to catch byte-level regressions the linter is meant to catch.
- `npm run check` fails (script does not exist), so the documented pre-commit gate cannot be followed and no hook installs it.
- Unit tests for Foundations (§11 requires unit-testing `auto` TTY selection, byte-order divergence, etc.) have no runner, layout, or assertion library to land in.
- The tsconfig delta changes import resolution; retrofitting `.ts` extensions after modules exist is churn across every file, so it must precede Foundations.
- Without the §10 error type, each command would invent its own exit-code and message handling, and the single `snap: <detail>` formatting point the design locks would not exist.

## Context

- `ts/package.json`, `ts/tsconfig.json`, `ts/src/main.ts`, `ts/snap` (runs `node_modules/tsx/dist/cli.mjs src/main.ts`); root `run` and `run_tests` do `npm ci` in `ts/` when `node_modules` is absent and exec the same tsx path. Node v24.9.0 locally.
- Research `ts-toolchain-conventions` records the verified compatibility matrix and chosen lane; design `snap-ts-architecture` locks the module layout (`core/`, `text/`, `repo/`, `fs/`, `http/`, `commands/`, `cli/`), colocated `src/**/*.test.ts`, `node:test` + `node:assert/strict` + fast-check, and the single write/exit point in `src/cli/main.ts`. `ts/AGENTS.md` Conventions already names the rules the config must enforce.
- Settled constraints (user decision, from the research): ESLint lane with `eslint ^10`, `@eslint/js`, `typescript-eslint ^8` (`strictTypeChecked` + `stylisticTypeChecked`, `projectService`), `eslint-plugin-import-x ^4`, `prettier ^3.9`, `fast-check ^4`, `simple-git-hooks ^2`, `@types/node ^24`, and `typescript ~6.0.3` because TypeScript 7 exposes no compiler API before 7.1 and typescript-eslint requires it. The plan re-verifies these against the registry but does not reopen the lane choice. `tsx` stays as the runtime.
- Settled tsconfig delta (stack): `module: nodenext`, `target: es2024`, `types: ["node"]`, `verbatimModuleSyntax`, `erasableSyntaxOnly`, `allowImportingTsExtensions`, `rewriteRelativeImportExtensions`, `noUncheckedSideEffectImports`, `exactOptionalPropertyTypes`, `noPropertyAccessFromIndexSignature`, `noImplicitReturns`, `noUnusedLocals`, `noUnusedParameters`; existing strict flags retained.
- Settled formatting (user decision): printWidth 100, singleQuote, trailingComma all, arrowParens always, endOfLine lf. Pre-commit hook runs `cd ts && npm run check` (format:check, lint, typecheck, test).
- Settled API bans on `src/**` with explanatory messages: `JSON.parse` (allowed only in `src/core/json.ts`), `process.exit`, global and `globalThis.fetch`, `localeCompare`, `console.log`/`console.error`, `toString('utf8')` probe, `TextDecoder` without `fatal`, `TSEnumDeclaration`; `no-non-null-assertion` and `no-unsafe-assignment` relaxed for `*.test.ts`.
- §10 fixes the exit-code contract: success 0, expected errors 1 as one plain-mode line `snap: <detail>`, unexpected internal failures 2; output UTF-8 with LF.
- Constraint: the harness starts ~300 processes with a cold tsx cache, so the module graph must stay small and free of top-level work.
- `ts/AGENTS.md` must not need editing when this lands; it already describes the target state.

## Out of Scope

- Any Foundations behavior (byte comparator, version parsing, strict JSON reader body, text detection, base64) — `src/core/json.ts` is not created here even though the ESLint override names it.
- Any command behavior, argument grammar, `SNAP_COLOR` resolution, or output beyond the error type and an empty `cli/main.ts` entry.
- Changing the runtime away from tsx or editing `ts/snap`, root `run`, `run_tests`, or `verify`.
- `test-harness/` toolchain or `TEST-HARNESS.md`.
- CI configuration (no CI exists in this repository).
- Making `./verify --lang ts` pass any suite; the skeleton is expected to fail all 31.

## Plan Closeout Notes

<!-- plan-close-review: toolchain-scaffolding -->

- Scope: no drift; three implementation deviations recorded in design `toolchain-scaffolding` — `import-x/enforce-node-protocol-usage` does not exist in `eslint-plugin-import-x@4.17.1`, replaced by core `no-restricted-imports` over `node:module`'s `builtinModules`; `no-floating-promises` in `*.test.ts` keeps `error` with `allowForKnownSafeCalls` for `node:test`'s `describe`/`it`/`test`; one extra unit test (7 total, plan listed 6). No acceptance tests added or modified; all ten tasks implemented and all acceptance checks passed (`npm ci && npm run check` exit 0; `ts/snap --version` and `node ts/src/main.ts --version` exit 1 with `snap: not implemented: --version`; hook installed; ban proof; `./verify --filter 01-init` fails the case not the harness; `tsc` 6.0.3; `ts/AGENTS.md`, `README.md`, `AGENTS.md`, `ts/snap`, `run`, `run_tests`, `verify` unchanged).
- Documentation impact: as planned — none to `ts/AGENTS.md`, root `AGENTS.md`, or `README.md`; `ts/AGENTS.md` Conventions remain accurate (the `node:` prefix bullet is enforced by `no-restricted-imports`, not import-x). Design `snap-ts-architecture` Test strategy (`ts/test/`, `node --import tsx --test`) is superseded by colocated `src/**/*.test.ts` under plain `node --test`; recorded in the realized design since the intent design is immutable.
- Guidelines / conventions: none recorded (no `GUIDELINES.md` in this repository; the plan *establishes* the enforced conventions rather than extending existing ones).
- Comments / docstrings: conform (module docs in `src/core/errors.ts` and `src/cli/main.ts` state the invariant; per-member JSDoc on exports only; `eslint.config.js` comments explain rule choices).
- Stack items satisfied: `snap-1.0` → Scaffolding: all nine items (`tsconfig.json` delta; dev dependencies pinned; `eslint.config.js` rule set — with `no-restricted-imports` standing in for `enforce-node-protocol-usage`; `eslint.config.js` API bans; `.prettierrc.json` and `.prettierignore`; `package.json` scripts and `simple-git-hooks`; colocated `src/**/*.test.ts` with `.ts` imports; `src/main.ts` delegating to `src/cli/main.ts` with `npm run check` green; exit 1 vs exit 2 error type with single formatting point).

<!-- /plan-close-review -->
