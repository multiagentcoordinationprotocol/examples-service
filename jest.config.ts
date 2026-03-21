import type { Config } from 'jest';

const config: Config = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: 'src',
  testRegex: '.*\\.spec\\.ts$',
  transform: {
    '^.+\\.ts$': [
      'ts-jest',
      {
        tsconfig: {
          types: ['node', 'jest']
        }
      }
    ]
  },
  collectCoverageFrom: ['**/*.ts', '!**/index.ts', '!main.ts'],
  coverageDirectory: '../coverage',
  testEnvironment: 'node',
  detectOpenHandles: true
};

export default config;
