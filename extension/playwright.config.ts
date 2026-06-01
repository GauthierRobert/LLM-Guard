import { defineConfig } from "@playwright/test";

/**
 * E2E config for the loaded Chrome extension. Tests live in `e2e/` and use
 * `*.spec.ts` so they never collide with the Vitest unit suite (`*.test.ts`).
 * A Chrome extension can only be loaded into a persistent context, so each
 * spec builds its own context via the fixture in `e2e/fixtures.ts`.
 */
export default defineConfig({
  testDir: "./e2e",
  testMatch: /.*\.spec\.ts$/,
  fullyParallel: false,
  workers: 1,
  timeout: 30_000,
  expect: { timeout: 7_000 },
  reporter: [["list"]],
  use: {
    trace: "retain-on-failure",
  },
});
