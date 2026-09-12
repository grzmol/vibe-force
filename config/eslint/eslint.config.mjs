/**
 * vibe-force ESLint flat config for Salesforce DX projects (ESLint 9+).
 *
 * Copy this file to your project root as `eslint.config.mjs`. It is NOT usable straight from the
 * plugin directory: ESLint resolves `@salesforce/eslint-config-lwc` and its peer plugins relative
 * to the config file, and the plugin repository has no node_modules. `vf-check lint` therefore
 * requires a project-local ESLint config and tells you to copy this one when it is missing.
 *
 * Required dev dependencies (see templates/package.json):
 *   eslint @salesforce/eslint-config-lwc @lwc/eslint-plugin-lwc
 *   @salesforce/eslint-plugin-lightning eslint-plugin-import eslint-plugin-jest
 *
 * @salesforce/eslint-config-lwc v4+ exports flat config arrays under `configs`; spread them.
 * https://github.com/salesforce/eslint-config-lwc#usage
 */

import lwcConfig from '@salesforce/eslint-config-lwc';
import jest from 'eslint-plugin-jest';

export default [
  {
    // Nothing in these paths is authored by hand.
    ignores: [
      '**/node_modules/**',
      '**/.sfdx/**',
      '**/.sf/**',
      '**/.vibeforce/**',
      '**/coverage/**',
      '**/staticresources/**',
      '**/*.min.js',
    ],
  },

  // Lightning Web Components: LWC restrictions + JavaScript best practices.
  ...lwcConfig.configs.recommended.map((config) => ({
    ...config,
    files: ['**/lwc/**/*.js'],
  })),

  {
    files: ['**/lwc/**/*.js'],
    rules: {
      // Wire adapters and @api members are consumed by the framework, not by local code.
      'no-unused-expressions': 'error',
      'no-console': ['error', { allow: ['error', 'warn'] }],
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'prefer-const': 'error',
      'no-var': 'error',
    },
  },

  // Jest unit tests live next to the component in __tests__.
  {
    files: ['**/__tests__/**/*.js', '**/*.test.js'],
    plugins: { jest },
    languageOptions: {
      globals: {
        ...jest.environments.globals.globals,
      },
    },
    rules: {
      ...jest.configs['flat/recommended'].rules,
      // Tests reach into the shadow DOM and await microtasks; these are expected there.
      '@lwc/lwc/no-unexpected-wire-adapter-usages': 'off',
      'no-console': 'off',
      'jest/expect-expect': 'error',
      'jest/no-disabled-tests': 'warn',
      'jest/no-focused-tests': 'error',
      'jest/no-identical-title': 'error',
      'jest/valid-expect': 'error',
    },
  },

  // Aura bundles are ES5-era JavaScript evaluated in the Aura framework sandbox.
  {
    files: ['**/aura/**/*.js'],
    languageOptions: {
      ecmaVersion: 2017,
      sourceType: 'script',
      globals: {
        $A: 'readonly',
        component: 'readonly',
        event: 'readonly',
        helper: 'readonly',
      },
    },
    rules: {
      'no-undef': 'error',
      'no-unused-vars': 'error',
    },
  },

  // Node scripts shipped inside the Salesforce project (data loaders, CI helpers).
  {
    files: ['scripts/**/*.{js,mjs,cjs}', '*.config.{js,mjs,cjs}'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: {
        process: 'readonly',
        console: 'readonly',
        __dirname: 'readonly',
        module: 'writable',
        require: 'readonly',
      },
    },
    rules: {
      'no-console': 'off',
    },
  },
];
