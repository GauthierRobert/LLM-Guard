// @ts-check
const { defineConfig } = require("@playwright/test");
const path = require("path");

/**
 * Tier B (smoke) — runs against real chatgpt.com. Slower, more flaky, and
 * separate from the deterministic core suite.
 *
 *   npm run e2e:smoke
 */
module.exports = defineConfig({
  testDir: __dirname,
  testMatch: /smoke-.*\.spec\.js$/,
  fullyParallel: false,
  workers: 1,
  retries: 2,
  reporter: [["list"], ["html", { open: "never", outputFolder: "playwright-report-smoke" }]],
  outputDir: path.join(__dirname, ".test-artifacts-smoke"),
  timeout: 120_000,
  expect: { timeout: 15_000 },
  use: {
    trace: "retain-on-failure",
    video: "retain-on-failure",
    screenshot: "only-on-failure",
  },
});
