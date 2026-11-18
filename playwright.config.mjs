import { defineConfig } from '@playwright/test';

const live = process.env.RACE_LAB_LIVE_URL;
const baseURL = live || 'http://127.0.0.1:4177/Formula1/';

export default defineConfig({
  testDir: './evals/browser',
  testMatch: live ? '**/live.spec.mjs' : '**/dashboard.spec.mjs',
  timeout: live ? 90_000 : 35_000,
  workers: live ? 1 : 2,
  reporter: 'list',
  use: { baseURL, trace: 'retain-on-failure' },
  webServer: live ? undefined : {
    command: 'npm run dev',
    env: { PORT: '4177' },
    url: baseURL,
    reuseExistingServer: false
  }
});
