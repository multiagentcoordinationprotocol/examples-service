import type { Config } from 'jest';

const config: Config = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: '..',
  roots: ['<rootDir>/test'],
  testRegex: '\\.integration\\.spec\\.ts$',
  transform: {
    '^.+\\.ts$': [
      'ts-jest',
      {
        tsconfig: 'test/tsconfig.integration.json'
      }
    ]
  },
  testEnvironment: 'node',
  testTimeout: 60000,
  maxWorkers: 1,
  detectOpenHandles: true
};

export default config;
