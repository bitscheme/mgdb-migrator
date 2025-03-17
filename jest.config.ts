import dotenv from 'dotenv'

// Load environment variables from .env file
dotenv.config()

export default {
  // An array of file extensions your modules use
  moduleFileExtensions: ['js', 'jsx', 'ts', 'tsx', 'json', 'node'],
  // The glob patterns Jest uses to detect test files
  testMatch: ['**/__tests__/**/*.[jt]s?(x)'],
  // An array of regexp pattern strings that are matched against all test paths, matched tests are skipped
  testPathIgnorePatterns: ['/node_modules/', '/dist/'],
  // A preset that is used as a base for Jest's configuration
  preset: 'ts-jest',
}
