/**
 * vibe-force reference Jest configuration for Lightning Web Components.
 *
 * `@salesforce/sfdx-lwc-jest` works with zero configuration, so `vf-check jest` never passes a
 * config file: it runs the project's own `jest.config.js` when one exists and the packaged
 * defaults otherwise. This file is the reference that `vf-init` mirrors into a project as
 * `jest.config.js` (CommonJS form in templates/jest.config.js), and the place to keep the
 * coverage thresholds aligned with `gates.jestCoverageMin`.
 *
 * `@salesforce/sfdx-lwc-jest/config` is CommonJS, so it is imported as a default binding and
 * destructured; a named ESM import of a CJS export is not guaranteed to resolve.
 *
 * Docs: https://github.com/salesforce/sfdx-lwc-jest#configuration
 */

import sfdxLwcJest from '@salesforce/sfdx-lwc-jest/config';

const { jestConfig } = sfdxLwcJest;

export default {
  ...jestConfig,

  moduleNameMapper: {
    ...jestConfig.moduleNameMapper,
    // Create these stub modules before enabling the matching mapping.
    '^@salesforce/apex$': '<rootDir>/force-app/test/jest-mocks/apex',
    '^lightning/navigation$': '<rootDir>/force-app/test/jest-mocks/lightning/navigation',
    '^lightning/platformShowToastEvent$':
      '<rootDir>/force-app/test/jest-mocks/lightning/platformShowToastEvent',
    '^lightning/uiRecordApi$': '<rootDir>/force-app/test/jest-mocks/lightning/uiRecordApi',
    '^lightning/messageService$': '<rootDir>/force-app/test/jest-mocks/lightning/messageService',
  },

  testPathIgnorePatterns: ['/node_modules/', '/.sfdx/', '/.sf/', '/.vibeforce/'],

  // `vf-check jest` reads coverage from the json-summary reporter and gates on total line
  // coverage. Repeating the thresholds here makes `npm run test:unit:coverage` fail identically.
  collectCoverageFrom: [
    '**/lwc/**/*.js',
    '!**/lwc/**/__tests__/**',
    '!**/lwc/**/*.spec.js',
    '!**/node_modules/**',
  ],
  coverageReporters: ['text-summary', 'json-summary', 'lcov'],
  coverageThreshold: {
    global: {
      lines: 80,
      statements: 80,
      functions: 70,
      branches: 65,
    },
  },

  clearMocks: true,
  restoreMocks: true,
  testTimeout: 15000,
};
