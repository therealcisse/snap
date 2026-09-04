---
title: "Lock down the ts/ toolchain and land the CLI skeleton with the §10 error type"
date: 2026-09-04
author: agent
id: toolchain-scaffolding
issue: toolchain-scaffolding
research:
  - ts-toolchain-conventions
designs:
  - snap-ts-architecture
completed: 2026-09-04
closeout_notes: true
---

## Context

Issue `toolchain-scaffolding`: `ts/AGENTS.md` promises `npm run check`, `eslint.config.js`, and `.prettierrc.json` that do not exist, and the tsconfig permits extensionless imports the agreed convention forbids. This plan installs the ESLint-lane toolchain the research verified and the user settled, rewrites `tsconfig.json` to Node-aligned strictness, and lands the minimal code the gate needs to prove itself: `src/core/errors.ts` (§10 exit-code contract), `src/cli/main.ts` (single write point), `src/main.ts` delegating to it, and unit tests that exercise `node --test` and fast-check. Everything else in `ts/` remains for Foundations.

## Current State

- `ts/package.json`: scripts `start` (`tsx src/main.ts`), `build` (`tsc --noEmit`); devDeps `@types/node ^22.18.0`, `tsx ^4.20.5`, `typescript ^5.9.2`. `ts/package-lock.json` present; `ts/node_modules` installed.
- `ts/tsconfig.json`: `target ES2022`, `module ESNext`, `moduleResolution bundler`, `strict`, `noUncheckedIndexedAccess`, `noImplicitOverride`, `noFallthroughCasesInSwitch`, `esModuleInterop`, `skipLibCheck`, `isolatedModules`, `noEmit`; `include: ["src/**/*.ts"]`.
- `ts/src/main.ts`: 62-byte stub, the only source file. No `src/cli/`, no `src/core/`.
- `ts/snap` and root `run` exec `node ts/node_modules/tsx/dist/cli.mjs ts/src/main.ts`; `run_tests` runs `npm ci --silent` in `ts/` when `node_modules` is absent. Neither is touched.
- No `eslint.config.js`, `.prettierrc.json`, `.prettierignore`, git hook, or test file.
- `ts/AGENTS.md` (Conventions, lines 38–71) already describes the target state and must need no edit.
- Research `ts-toolchain-conventions` §7.1–7.3 contains the reference `eslint.config.js`, Prettier block, and tsconfig delta; §1.2 lists the ban messages. Its example ESLint override path `src/repository/decode.ts` is superseded by the design's `src/core/json.ts`.
- Design `snap-ts-architecture` locks `core/errors.ts` ("`SnapError` (expected, exit 1) and the internal-failure path (exit 2); the single `snap: <detail>` formatting point") and `cli/main.ts` ("environment validation, dispatch, error-to-exit-code mapping, flushed writes. `src/main.ts` only calls it"). Its Test strategy names `ts/test/` with `node --import tsx --test`; the later stack and `ts/AGENTS.md` supersede that with colocated `src/**/*.test.ts` under plain `node --test`.
- Registry state on 2026-09-04: `typescript` latest 7.0.2, `6.0.3` available; `typescript-eslint@8.69.0` peer `typescript >=4.8.4 <6.1.0`; `eslint 10.10.0`, `@eslint/js 10.0.1`, `eslint-plugin-import-x 4.17.1` (peer `eslint ^8.57.0 || ^9.0.0 || ^10.0.0`), `prettier 3.9.6`, `fast-check 4.9.0`, `simple-git-hooks 2.14.0`, `tsx 4.23.13`, `@types/node 24.13.3` (latest 24.x). Local Node v24.9.0 with type stripping enabled by default.

## Developer Feedback

- **One plan** (agent recommendation, uncontested): the nine stack items are one coherent change set; splitting toolchain from skeleton would leave `npm run check` with nothing to run against.
- **Versions are settled** (user): `typescript ~6.0.3`, `@types/node ^24.13.3`, `eslint ^10.10.0`, `@eslint/js ^10.0.1`, `typescript-eslint ^8.69.0`, `eslint-plugin-import-x ^4.17.1`, `prettier ^3.9.6`, `fast-check ^4.9.0`, `simple-git-hooks ^2.14.0`, `tsx ^4.23.13`. Re-verified against the registry on 2026-09-04: `typescript-eslint` peer range `<6.1.0` forces TS 6.0.x. Rejected: Oxc lane (no `no-restricted-syntax`, TS 7 requirement); Biome (nursery type rules); Vitest (13 deps, second module loader); husky/lint-staged/lefthook (premature for a seconds-long gate).
- **Prettier scope** (user): code and config only. `.prettierignore` excludes `node_modules`, `package-lock.json`, `*.md`. Rejected: formatting Markdown (rewraps `AGENTS.md` prose); `src`-only (leaves `eslint.config.js` and JSON unformatted).
- **Error model** (user): one `SnapError extends Error` (exit 1, `message` is `<detail>`); every other thrown value is internal (exit 2). One function `describeFailure(failure: unknown): Failure` is the sole formatting point. Rejected: a `SnapFailure` base with two subclasses (a second class with no second behavior); `Result<T, SnapError>` returns (forces every command signature to carry it before any command exists).
- **Test discovery** (agent): `"test": "node --test 'src/**/*.test.ts'"` with an explicit glob rather than relying on Node's default `.ts` patterns, so the script is unambiguous across Node minors.
- **`eslint.config.js` itself is linted** (agent): `eslint .` covers it; a `disableTypeChecked` override for `**/*.js` avoids the "file not included in project" error from `projectService`. Rejected: `eslint src` (config file unlinted).
- **Runtime unchanged** (user, from issue): `tsx` retained; `ts/snap`, root `run`, `run_tests` untouched. `node src/main.ts` working natively is verified as evidence the tsconfig is right, not adopted as the launcher.
- **Skeleton behavior** (agent): with no commands implemented, `run` throws `SnapError('not implemented…')` for every argv, so every invocation exits 1 with a `snap: not implemented` line. This exercises the whole exit path without inventing grammar (out of scope).

## Approach

### Step 1 — `ts/tsconfig.json`

Replace wholesale:

```json
{
  "compilerOptions": {
    "module": "nodenext",
    "target": "es2024",
    "lib": ["es2024"],
    "types": ["node"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "noPropertyAccessFromIndexSignature": true,
    "noImplicitOverride": true,
    "noFallthroughCasesInSwitch": true,
    "noImplicitReturns": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "verbatimModuleSyntax": true,
    "erasableSyntaxOnly": true,
    "allowImportingTsExtensions": true,
    "rewriteRelativeImportExtensions": true,
    "noUncheckedSideEffectImports": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "noEmit": true
  },
  "include": ["src/**/*.ts"]
}
```

`moduleResolution` and `isolatedModules` are removed (implied / superseded).

### Step 2 — `ts/package.json`

```json
{
  "name": "snap",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "engines": { "node": ">=24" },
  "scripts": {
    "start": "tsx src/main.ts",
    "build": "tsc --noEmit",
    "typecheck": "tsc --noEmit",
    "lint": "eslint .",
    "lint:fix": "eslint . --fix",
    "format": "prettier --write .",
    "format:check": "prettier --check .",
    "test": "node --test 'src/**/*.test.ts'",
    "test:watch": "node --test --watch 'src/**/*.test.ts'",
    "check": "npm run format:check && npm run lint && npm run typecheck && npm test",
    "prepare": "simple-git-hooks"
  },
  "simple-git-hooks": { "pre-commit": "cd ts && npm run check" },
  "devDependencies": {
    "@eslint/js": "^10.0.1",
    "@types/node": "^24.13.3",
    "eslint": "^10.10.0",
    "eslint-plugin-import-x": "^4.17.1",
    "fast-check": "^4.9.0",
    "prettier": "^3.9.6",
    "simple-git-hooks": "^2.14.0",
    "tsx": "^4.23.13",
    "typescript": "~6.0.3",
    "typescript-eslint": "^8.69.0"
  }
}
```

Run `npm install` in `ts/` to regenerate `package-lock.json`; `prepare` installs `.git/hooks/pre-commit` at the repository root (simple-git-hooks walks up to find `.git`).

### Step 3 — `ts/eslint.config.js`

Flat config per research §7.1 with these deltas: sanctioned decoder path `src/core/json.ts`; ban messages from §1.2 written out; `disableTypeChecked` for `**/*.js`; node resolver via `createNodeResolver({ extensions: ['.ts'] })` from `eslint-plugin-import-x`.

```js
import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import { createNodeResolver, importX } from 'eslint-plugin-import-x';
import tseslint from 'typescript-eslint';

export default defineConfig(
  { ignores: ['node_modules/**'] },
  js.configs.recommended,
  tseslint.configs.strictTypeChecked,
  tseslint.configs.stylisticTypeChecked,
  importX.flatConfigs.recommended,
  importX.flatConfigs.typescript,
  {
    languageOptions: { parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname } },
    settings: { 'import-x/resolver-next': [createNodeResolver({ extensions: ['.ts'] })] },
    rules: {
      '@typescript-eslint/switch-exhaustiveness-check': ['error', { requireDefaultForNonUnion: true, considerDefaultExhaustiveForUnions: false }],
      '@typescript-eslint/require-array-sort-compare': ['error', { ignoreStringArrays: false }],
      '@typescript-eslint/explicit-module-boundary-types': 'error',
      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
      '@typescript-eslint/no-unused-vars': 'off',
      'import-x/extensions': ['error', 'always', { ignorePackages: true, checkTypeImports: true }],
      'import-x/enforce-node-protocol-usage': ['error', 'always'],
      'import-x/no-duplicates': ['error', { 'prefer-inline': true }],
      'import-x/order': ['error', { groups: ['builtin', 'external', 'parent', 'sibling', 'index', 'type'], 'newlines-between': 'always', alphabetize: { order: 'asc', caseInsensitive: false } }],
    },
  },
  {
    files: ['src/**/*.ts'],
    ignores: ['src/**/*.test.ts'],
    rules: {
      'no-restricted-globals': ['error', { name: 'fetch', message: 'Use node:http/node:https; fetch follows redirects (SPEC §9).' }],
      'no-restricted-properties': ['error',
        { object: 'JSON', property: 'parse', message: 'Use the strict reader in src/core/json.ts (SPEC §4.1).' },
        { object: 'process', property: 'exit', message: 'Set process.exitCode and return; exit() truncates piped stdout (SPEC §10).' },
        { object: 'globalThis', property: 'fetch', message: 'Use node:http/node:https; fetch follows redirects (SPEC §9).' },
        { property: 'localeCompare', message: 'Use the byte-order comparator in src/core/bytes.ts (SPEC §2).' },
        { object: 'console', property: 'log', message: 'Write through src/cli/main.ts.' },
        { object: 'console', property: 'error', message: 'Write through src/cli/main.ts.' },
      ],
      'no-restricted-syntax': ['error',
        { selector: "CallExpression[callee.property.name='toString'][arguments.0.value=/^utf-?8$/i]", message: 'Use isText and TextDecoder({ fatal: true, ignoreBOM: true }) (SPEC §4.4).' },
        { selector: "NewExpression[callee.name='TextDecoder']:not([arguments.1.properties.0.key.name='fatal'])", message: 'Construct TextDecoder with { fatal: true, ignoreBOM: true }.' },
        { selector: 'TSEnumDeclaration', message: 'Use a string-literal union; enums are not erasable syntax.' },
      ],
    },
  },
  { files: ['src/core/json.ts'], rules: { 'no-restricted-properties': 'off' } },
  { files: ['**/*.test.ts'], rules: { '@typescript-eslint/no-non-null-assertion': 'off', '@typescript-eslint/no-unsafe-assignment': 'off' } },
  { files: ['**/*.js'], extends: [tseslint.configs.disableTypeChecked] },
);
```

If `createNodeResolver` is not exported by the installed import-x, fall back to `settings: { 'import-x/resolver': { node: { extensions: ['.ts'] } } }` (research §6.2 form) and record it as a deviation.

### Step 4 — Prettier

`ts/.prettierrc.json`: `{"printWidth":100,"tabWidth":2,"semi":true,"singleQuote":true,"trailingComma":"all","arrowParens":"always","objectWrap":"preserve","endOfLine":"lf"}`.
`ts/.prettierignore`: `node_modules`, `package-lock.json`, `*.md`.

### Step 5 — `src/core/errors.ts`

```ts
/** An expected failure: reported as one `snap: <detail>` line and exit status 1 (SPEC §10). */
export class SnapError extends Error {
  constructor(detail: string) {
    super(detail);
    this.name = 'SnapError';
  }
}

export interface Failure {
  readonly exitCode: 1 | 2;
  /** Complete plain-mode stderr line including the trailing LF. */
  readonly line: string;
}

/** The single formatting point for every failure the CLI reports. */
export function describeFailure(failure: unknown): Failure {
  if (failure instanceof SnapError) return { exitCode: 1, line: `snap: ${failure.message}\n` };
  const detail = failure instanceof Error ? failure.message : String(failure);
  return { exitCode: 2, line: `snap: internal error: ${detail}\n` };
}
```

### Step 6 — `src/cli/main.ts` and `src/main.ts`

```ts
// src/cli/main.ts
import { writeSync } from 'node:fs';

import { SnapError, describeFailure } from '../core/errors.ts';

export interface Output {
  readonly stdout: (text: string) => void;
  readonly stderr: (text: string) => void;
}

/** Runs one CLI invocation and returns the process exit status; never throws. */
export function run(argv: readonly string[], out: Output): number {
  try {
    dispatch(argv);
    return 0;
  } catch (failure: unknown) {
    const { exitCode, line } = describeFailure(failure);
    out.stderr(line);
    return exitCode;
  }
}

/** Output bound to file descriptors 1 and 2 with synchronous, flushed writes. */
export function fdOutput(): Output {
  return {
    stdout: (text) => { writeSync(1, text); },
    stderr: (text) => { writeSync(2, text); },
  };
}

function dispatch(argv: readonly string[]): void {
  throw new SnapError(`not implemented: ${argv.join(' ')}`.trimEnd());
}
```

```ts
// src/main.ts
import { fdOutput, run } from './cli/main.ts';

process.exitCode = run(process.argv.slice(2), fdOutput());
```

`dispatch` is the seam the CLI-skeleton issue replaces; its error text is `snap: not implemented:` for empty argv and `snap: not implemented: <args>` otherwise.

### Step 7 — Unit tests

`src/core/errors.test.ts` (`node:test`, `node:assert/strict`, fast-check):
- `describeFailure(new SnapError('x'))` deep-equals `{ exitCode: 1, line: 'snap: x\n' }`.
- `describeFailure(new TypeError('boom'))` → exit 2, line `snap: internal error: boom\n`.
- `describeFailure('raw')` → exit 2, line `snap: internal error: raw\n`.
- Property: for `fc.string()` filtered to no `\n`, `describeFailure(new SnapError(s)).line === \`snap: ${s}\n\``.

`src/cli/main.test.ts`:
- `run(['--version'], captured)` returns 1, stdout buffer is empty, stderr buffer is `snap: not implemented: --version\n`.
- `run([], captured)` returns 1 with stderr `snap: not implemented:\n`.

### Step 8 — Verification and ban proof

`npm run check` green. Prove the bans fire without committing anything: write a scratch `src/scratch.ts` containing `JSON.parse('1'); process.exit(0); 'a'.localeCompare('b'); new TextDecoder(); enum E { A }` and confirm `npx eslint src/scratch.ts` reports each message; delete the file.

## Tasks

- [ ] Replace `ts/tsconfig.json` with the Step 1 configuration.
- [ ] Rewrite `ts/package.json` per Step 2 (engines, scripts, `simple-git-hooks`, pinned devDependencies); run `npm install` in `ts/` to regenerate `package-lock.json` and install the pre-commit hook.
- [ ] Create `ts/eslint.config.js` per Step 3, with the `src/core/json.ts` override and full ban messages.
- [ ] Create `ts/.prettierrc.json` and `ts/.prettierignore` per Step 4.
- [ ] Create `ts/src/core/errors.ts` with `SnapError`, `Failure`, `describeFailure` per Step 5.
- [ ] Create `ts/src/cli/main.ts` with `Output`, `run`, `fdOutput`, and the `dispatch` seam per Step 6; rewrite `ts/src/main.ts` to the two-line delegate.
- [ ] Create `ts/src/core/errors.test.ts` and `ts/src/cli/main.test.ts` per Step 7.
- [ ] Run `npm run format` once, then `npm run check`; fix until green.
- [ ] Perform the Step 8 scratch-file ban proof and remove the scratch file.
- [ ] Verify `./snap --version`, `node ts/src/main.ts --version`, and `./verify --lang ts --filter 01-init` per Acceptance Tests.

## Documentation Impact

- `ts/AGENTS.md`: none — acceptance requires it unchanged. Its reference to `npm run build` as "type-check only" remains true (`build` and `typecheck` are aliases).
- Root `AGENTS.md`, `README.md`: none.
- Design `snap-ts-architecture` Test strategy (`ts/test/`, `node --import tsx --test`) is superseded by colocated `src/**/*.test.ts` under plain `node --test`; the design is immutable, so the realized design for this plan records the deviation.
- Stack `snap-1.0` Scaffolding items become checkable at `/close-issue`.

## Acceptance Tests

- `cd ts && npm ci && npm run check` exits 0: Prettier check, ESLint (including `eslint.config.js`), `tsc --noEmit`, and `node --test` reporting both test files with all tests passing (at least 6 tests).
- `cd ts && npm test` output shows `src/core/errors.test.ts` and `src/cli/main.test.ts` executed natively (no tsx in the command).
- `./snap --version` (from repo root via `ts/snap`) exits 1, stdout empty, stderr exactly `snap: not implemented: --version\n`.
- `node ts/src/main.ts --version` produces the same result without tsx (proves `erasableSyntaxOnly` + `.ts` extensions are honored by Node).
- `cat .git/hooks/pre-commit` contains `cd ts && npm run check`.
- Scratch-file ban proof: each of `JSON.parse`, `process.exit`, `localeCompare`, bare `TextDecoder`, and `enum` reports its configured message; scratch file removed; `git status` shows no `src/scratch.ts`.
- `./verify --lang ts --filter 01-init` runs to completion and reports the case as failed (candidate exit 1 with `snap: not implemented: init …`), not as a harness error.
- `git diff --quiet ts/AGENTS.md README.md AGENTS.md ts/snap run run_tests verify` exits 0.
- `npx tsc --version` in `ts/` prints `Version 6.0.x`.
