/**
 * Playwright fixtures for end-to-end testing the *loaded* extension.
 *
 * A Chrome extension can only be loaded into a persistent context, so we launch
 * one with `--load-extension` pointed at the built `dist/`. We then intercept
 * the supported LLM host (chatgpt.com) and fulfil it ourselves:
 *
 *   - GET  https://chatgpt.com/  ............ serve the mock LLM page so the
 *                                            content scripts inject (they match
 *                                            on the *committed* URL, which is a
 *                                            real supported host).
 *   - POST .../conversation  ................ echo the request body back, so a
 *                                            test can read the bytes the page
 *                                            actually sent (anonymized or not).
 *
 * No real network or TLS is used — route fulfilment short-circuits both.
 */

import { test as base, chromium, type BrowserContext } from "@playwright/test";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { readFileSync } from "node:fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
// Per-browser output dirs (BROWSER=chrome|firefox); Playwright drives Chrome.
const EXTENSION_PATH = resolve(__dirname, "..", "dist", "chrome");
const MOCK_HTML = readFileSync(resolve(__dirname, "mock-llm.html"), "utf8");

/** The URL the extension treats as ChatGPT (matches manifest host globs). */
export const LLM_PAGE_URL = "https://chatgpt.com/";

export const test = base.extend<{
  context: BrowserContext;
  extensionId: string;
}>({
  // eslint-disable-next-line no-empty-pattern
  context: async ({}, use) => {
    const context = await chromium.launchPersistentContext("", {
      // `channel: chromium` runs the full browser under the new headless mode,
      // which (unlike the headless shell) supports extensions.
      channel: "chromium",
      args: [
        `--disable-extensions-except=${EXTENSION_PATH}`,
        `--load-extension=${EXTENSION_PATH}`,
        "--no-first-run",
      ],
    });

    // Serve the mock page for navigations to the LLM host; echo conversation POSTs.
    await context.route("https://chatgpt.com/**", async (route) => {
      const req = route.request();
      const url = req.url();
      if (url.includes("/conversation")) {
        const posted = req.postData() ?? "{}";
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          // Echo the bytes the extension forwarded, so tests can inspect them.
          body: JSON.stringify({ echoed: JSON.parse(posted) }),
        });
        return;
      }
      await route.fulfill({ status: 200, contentType: "text/html", body: MOCK_HTML });
    });

    await use(context);
    await context.close();
  },

  extensionId: async ({ context }, use) => {
    // The MV3 service worker registers shortly after launch; its host is the id.
    let [sw] = context.serviceWorkers();
    if (!sw) sw = await context.waitForEvent("serviceworker");
    const extensionId = new URL(sw.url()).host;
    await use(extensionId);
  },
});

/**
 * Overwrite the stored GuardConfig from inside the extension's own origin (the
 * only place chrome.storage is reachable). Used to switch guards on or off for
 * a spec — e.g. to exercise the opt-in send guard, or to take the on-device NER
 * model out of the way so a paste resolves synchronously.
 */
export async function setGuardConfig(
  context: BrowserContext,
  extensionId: string,
  patch: Record<string, unknown>,
): Promise<void> {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/src/options/options.html`);
  await page.evaluate(async (p) => {
    const KEY = "guard_config";
    const api = (globalThis as unknown as { chrome: typeof chrome }).chrome;
    const stored = (await api.storage.sync.get(KEY))[KEY] as Record<string, unknown> | undefined;
    const next: Record<string, unknown> = { ...stored, ...p };
    // `ner` is a nested object — merge it rather than replacing it wholesale.
    if (p.ner) {
      next.ner = { ...(stored?.ner as object | undefined), ...(p.ner as object) };
    }
    await api.storage.sync.set({ [KEY]: next });
  }, patch);
  await page.close();
}

export const expect = test.expect;
