import { defineConfig } from 'vitest/config';

// Tests always use the separate test database, never the demo one. Set here (before any
// test code loads) so it also overrides a DATABASE_URL that may be set in your shell.
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? 'postgres://ops:ops@localhost:5432/ops_test';
process.env.JWT_SECRET = 'test-secret';
process.env.LOG_LEVEL = 'silent'; // the request logs would drown the test output
process.env.LIVE_POLL_MS = '100';
process.env.LIVE_STREAM_SECONDS = '2';

export default defineConfig({
  test: {
    globalSetup: './tests/global-setup.ts', // run migrations once
    setupFiles: ['./tests/setup.ts'],
    fileParallelism: false, // test files share one database, so run them one after another
    testTimeout: 15000,
  },
});
