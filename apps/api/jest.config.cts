/* eslint-disable */
import { readFileSync } from 'fs';

const swcJestConfig = JSON.parse(
  readFileSync(`${__dirname}/.spec.swcrc`, 'utf-8')
);

swcJestConfig.swcrc = false;

export default {
  displayName: 'api',
  testEnvironment: 'node',
  transform: {
    '^.+\\.[tj]s$': ['@swc/jest', swcJestConfig],
  },
  moduleFileExtensions: ['ts', 'js', 'html'],
  coverageDirectory: 'test-output/jest/coverage',
  moduleNameMapper: {
    '^@voxpopuli/shared-types$':
      '<rootDir>/../../libs/shared-types/src/index.ts',
  },
};
