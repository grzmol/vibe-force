/**
 * Jest configuration for Lightning Web Components.
 *
 * `@salesforce/sfdx-lwc-jest` resolves `jest.config.js` from the project root, so this file is
 * CommonJS. It mirrors the reference config in the plugin at config/jest/jest.config.mjs; keep the
 * coverage thresholds in step with `gates.jestCoverageMin` in .vibeforce/config.json, which is
 * what `vf-check jest` enforces.
 *
 * Docs: https://github.com/salesforce/sfdx-lwc-jest#configuration
 */

const { jestConfig } = require('@salesforce/sfdx-lwc-jest/config');

module.exports = {
    ...jestConfig,

    moduleNameMapper: {
        ...jestConfig.moduleNameMapper
        // Add stubs as the project needs them, for example:
        // '^@salesforce/apex$': '<rootDir>/force-app/test/jest-mocks/apex',
        // '^lightning/navigation$': '<rootDir>/force-app/test/jest-mocks/lightning/navigation'
    },

    testPathIgnorePatterns: ['/node_modules/', '/.sfdx/', '/.sf/', '/.vibeforce/'],

    collectCoverageFrom: [
        '**/lwc/**/*.js',
        '!**/lwc/**/__tests__/**',
        '!**/lwc/**/*.spec.js',
        '!**/node_modules/**'
    ],
    coverageReporters: ['text-summary', 'json-summary', 'lcov'],
    coverageThreshold: {
        global: {
            lines: 80,
            statements: 80,
            functions: 70,
            branches: 65
        }
    },

    clearMocks: true,
    restoreMocks: true,
    testTimeout: 15000
};
