export default {
    testEnvironment: 'node',
    transform: {},
    moduleNameMapper: {
        '^(\\.\\.?/)*dependencies/gi\\.js$': '<rootDir>/test/__mocks__/gi.js',
        '^(\\.\\.?/)*dependencies/shell/ui\\.js$': '<rootDir>/test/__mocks__/shell-ui.js',
        '^(\\.\\.?/)*dependencies/shell/misc\\.js$': '<rootDir>/test/__mocks__/shell-misc.js',
        '^(\\.\\.?/)*dependencies/shell/extensions/extension\\.js$':
            '<rootDir>/test/__mocks__/shell-extension.js',
        '^(\\.\\.?/)*imports\\.js$': '<rootDir>/test/__mocks__/imports.js',
        '^resource:///.*$': '<rootDir>/test/__mocks__/shell-ui.js',
        '^gi://.*$': '<rootDir>/test/__mocks__/gi.js',
    },
    setupFiles: ['<rootDir>/test/setup.js'],
    globalSetup: '<rootDir>/test/globalSetup.js',
    testMatch: ['<rootDir>/test/**/*.test.js'],
    testPathIgnorePatterns: ['<rootDir>/test/integration/'],
    collectCoverageFrom: ['*.js', '!eslint.config.mjs'],
    collectCoverage: true,
    coverageReporters: ['text', 'json-summary'],
};
