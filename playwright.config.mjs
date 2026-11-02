import { defineConfig, devices } from '@playwright/test';

const port = Number(process.env.LOOM_TEST_PORT || 5187);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid test port');
const baseURL = `http://localhost:${port}`;

export default defineConfig({
  testDir: './tests/browser',
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    viewport: { width: 1440, height: 980 },
  },
  projects: [
    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'], viewport: { width: 1440, height: 980 } },
    },
    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'], viewport: { width: 1440, height: 980 } },
    },
  ],
  webServer: {
    command: `node scripts/dev.mjs --port ${port}`,
    url: `${baseURL}/create.html`,
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
});
