import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end tests.
 *
 * By default Playwright starts the Next.js dev server on port 3200 against the
 * database configured in `.env` / `.env.local`. Set `PLAYWRIGHT_BASE_URL` to
 * test an already-running server (for example a production build) instead.
 */

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3200";
const useExistingServer = Boolean(process.env.PLAYWRIGHT_BASE_URL);

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 90_000,
  expect: { timeout: 10_000 },
  reporter: [["list"]],
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: useExistingServer
    ? undefined
    : {
        command: "npm run dev -- --port 3200",
        url: baseURL,
        reuseExistingServer: !process.env.CI,
        timeout: 180_000,
        env: {
          NEXT_PUBLIC_APP_URL: baseURL,
        },
      },
});
