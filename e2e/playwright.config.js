// @ts-check
const { defineConfig } = require("@playwright/test");
const path = require("path");

module.exports = defineConfig({
  testDir: __dirname,
  testMatch: /.*\.spec\.js$/,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"], ["html", { open: "never", outputFolder: "playwright-report" }]],
  outputDir: path.join(__dirname, ".test-artifacts"),
  timeout: 30_000,
  expect: { timeout: 5_000 },
  use: {
    trace: "retain-on-failure",
    video: "retain-on-failure",
  },
});
