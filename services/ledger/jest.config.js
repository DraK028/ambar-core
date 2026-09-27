/** @type {import('jest').Config} */
const tsJest = ['ts-jest', { tsconfig: '<rootDir>/tsconfig.json' }];

module.exports = {
  // Las pruebas de integración levantan Postgres en un contenedor.
  testTimeout: 60000,
  collectCoverageFrom: ['src/**/*.ts', '!src/**/*.spec.ts', '!src/main.ts', '!src/scripts/**', '!src/**/*.cli.ts'],
  coverageThreshold: {
    './src/domain/': { branches: 90, functions: 90, lines: 90, statements: 90 },
    './src/application/': { branches: 80, functions: 90, lines: 90, statements: 90 },
  },
  projects: [
    {
      displayName: 'unit',
      testEnvironment: 'node',
      transform: { '^.+\\.ts$': tsJest },
      testMatch: ['<rootDir>/src/**/*.spec.ts'],
    },
    {
      displayName: 'integration',
      testEnvironment: 'node',
      transform: { '^.+\\.ts$': tsJest },
      testMatch: ['<rootDir>/test/integration/**/*.test.ts'],
      globalSetup: '<rootDir>/test/support/global-setup.ts',
      globalTeardown: '<rootDir>/test/support/global-teardown.ts',
    },
    {
      displayName: 'e2e',
      testEnvironment: 'node',
      transform: { '^.+\\.ts$': tsJest },
      testMatch: ['<rootDir>/test/e2e/**/*.test.ts'],
      globalSetup: '<rootDir>/test/support/global-setup.ts',
      globalTeardown: '<rootDir>/test/support/global-teardown.ts',
    },
  ],
};
