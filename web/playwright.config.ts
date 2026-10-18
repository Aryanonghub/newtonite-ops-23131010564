import { defineConfig } from '@playwright/test';

// Browser tests for the optimistic UI. They run against the real stack: start it first
// with `docker compose up` (from the repo root), then `npm run test:e2e` here.
export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:8088',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
});
