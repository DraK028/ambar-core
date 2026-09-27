/** @type {import('jest').Config} */
const tsJest = ['ts-jest', { tsconfig: '<rootDir>/tsconfig.json' }];

module.exports = {
  testEnvironment: 'node',
  transform: { '^.+\\.ts$': tsJest },
  testMatch: ['<rootDir>/src/**/*.spec.ts', '<rootDir>/test/**/*.test.ts'],
  testTimeout: 30000,
  collectCoverageFrom: ['src/**/*.ts', '!src/**/*.spec.ts', '!src/main.ts'],
  coverageThreshold: {
    './src/domain/': { branches: 90, functions: 100, lines: 95, statements: 95 },
  },
};
