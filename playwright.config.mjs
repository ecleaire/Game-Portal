import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/browser',
  workers: 1,
  timeout: 60000,
  use: {
    baseURL: 'http://127.0.0.1:4173/Game-Portal/',
    launchOptions: process.env.PLAYWRIGHT_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH } : {},
    screenshot: 'only-on-failure',
  },
  webServer: [
    { command: 'node scripts/serve.mjs', url: 'http://127.0.0.1:4173/Game-Portal/', reuseExistingServer: false },
    { command: 'node tests/browser/backend.mjs', url: 'http://127.0.0.1:54321/health', timeout: 30000, reuseExistingServer: false },
  ],
});
