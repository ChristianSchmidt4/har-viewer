export default {
  testEnvironment: 'jsdom',
  transform: {
    '^.+\\.(js|ts)$': 'babel-jest',
  },
  moduleFileExtensions: ['ts', 'js', 'json'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
    // Source imports use explicit ".js" extensions (required by native ESM
    // in the browser/Vite) even though the files are actually ".ts" -
    // resolve those back to the .ts source for Jest/Babel.
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
  testMatch: [
    '**/tests/**/*.test.ts'
  ],
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.test.ts',
  ],
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov'],
};
