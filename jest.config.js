module.exports = {
  testEnvironment: 'node',
  setupFiles: ['<rootDir>/test/env.setup.js'],
  testTimeout: 15000,
  // Run test files one at a time -- they share one Postgres connection
  // pool and a handful of fixture rows seeded once in globalSetup;
  // parallel workers would step on each other's data.
  maxWorkers: 1,
};
