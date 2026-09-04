import { builtinModules } from 'node:module';

import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import { createNodeResolver, importX } from 'eslint-plugin-import-x';
import tseslint from 'typescript-eslint';

/** Bare built-in specifiers (`fs`, `path/posix`, …); the `node:`-prefixed forms are the only ones allowed. */
const bareBuiltins = builtinModules.filter((name) => !name.startsWith('node:'));

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
    settings: { 'import-x/resolver-next': [createNodeResolver({ extensions: ['.ts'] })] },
    rules: {
      '@typescript-eslint/switch-exhaustiveness-check': [
        'error',
        { requireDefaultForNonUnion: true, considerDefaultExhaustiveForUnions: false },
      ],
      '@typescript-eslint/require-array-sort-compare': ['error', { ignoreStringArrays: false }],
      '@typescript-eslint/explicit-module-boundary-types': 'error',
      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
      // tsc's noUnusedLocals/noUnusedParameters already report these.
      '@typescript-eslint/no-unused-vars': 'off',
      'import-x/extensions': ['error', 'always', { ignorePackages: true, checkTypeImports: true }],
      'no-restricted-imports': [
        'error',
        {
          paths: bareBuiltins.map((name) => ({
            name,
            message: `Import built-ins with the node: prefix ('node:${name}').`,
          })),
          patterns: bareBuiltins.map((name) => ({
            group: [`${name}/*`],
            message: `Import built-ins with the node: prefix ('node:${name}/…').`,
          })),
        },
      ],
      'import-x/no-duplicates': ['error', { 'prefer-inline': true }],
      'import-x/order': [
        'error',
        {
          groups: ['builtin', 'external', 'parent', 'sibling', 'index', 'type'],
          'newlines-between': 'always',
          alphabetize: { order: 'asc', caseInsensitive: false },
        },
      ],
    },
  },
  {
    // Bans for production code: each idiomatic default below produces bytes that violate SPEC.md.
    files: ['src/**/*.ts'],
    ignores: ['src/**/*.test.ts'],
    rules: {
      'no-restricted-globals': [
        'error',
        { name: 'fetch', message: 'Use node:http/node:https; fetch follows redirects (SPEC §9).' },
      ],
      'no-restricted-properties': [
        'error',
        {
          object: 'JSON',
          property: 'parse',
          message: 'Use the strict reader in src/core/json.ts (SPEC §4.1).',
        },
        {
          object: 'process',
          property: 'exit',
          message: 'Set process.exitCode and return; exit() truncates piped stdout (SPEC §10).',
        },
        {
          object: 'globalThis',
          property: 'fetch',
          message: 'Use node:http/node:https; fetch follows redirects (SPEC §9).',
        },
        {
          property: 'localeCompare',
          message: 'Use the byte-order comparator in src/core/bytes.ts (SPEC §2).',
        },
        { object: 'console', property: 'log', message: 'Write through src/cli/main.ts.' },
        { object: 'console', property: 'error', message: 'Write through src/cli/main.ts.' },
      ],
      'no-restricted-syntax': [
        'error',
        {
          selector:
            "CallExpression[callee.property.name='toString'][arguments.0.value=/^utf-?8$/i]",
          message: 'Use isText and TextDecoder({ fatal: true, ignoreBOM: true }) (SPEC §4.4).',
        },
        {
          selector:
            "NewExpression[callee.name='TextDecoder']:not([arguments.1.properties.0.key.name='fatal'])",
          message: 'Construct TextDecoder with { fatal: true, ignoreBOM: true }.',
        },
        {
          selector: 'TSEnumDeclaration',
          message: 'Use a string-literal union; enums are not erasable syntax.',
        },
      ],
    },
  },
  { files: ['src/core/json.ts'], rules: { 'no-restricted-properties': 'off' } },
  {
    files: ['**/*.test.ts'],
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      // node:test's describe/it/test return promises that the runner itself awaits.
      '@typescript-eslint/no-floating-promises': [
        'error',
        {
          allowForKnownSafeCalls: [
            { from: 'package', package: 'node:test', name: ['describe', 'it', 'test'] },
          ],
        },
      ],
    },
  },
  { files: ['**/*.js'], extends: [tseslint.configs.disableTypeChecked] },
);
