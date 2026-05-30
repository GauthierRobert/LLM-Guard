// @ts-check
const { test: base, chromium } = require("@playwright/test");
const path = require("path");
const fs = require("fs");
const os = require("os");

const EXT_PATH = path.resolve(__dirname, "..", "..");
const FIXTURE_HTML = path.resolve(__dirname, "mock-chatgpt.html");

/**
 * Routes used by the mock LLM. All requests against chatgpt.com are answered
 * locally so we never hit the real OpenAI endpoint.
 *
 *   GET  /                              → mock-chatgpt.html
 *   POST /backend-api/conversation      → captured body + canned response
 *
 * The captured body is what the *extension* actually sent — i.e. after its
 * fetch-monkey-patch ran. That's the assertion target for anonymization tests.
 */

/**
 * @typedef {Object} CapturedRequest
 * @property {string} url
 * @property {string} method
 * @property {string} body
 * @property {Record<string,string>} headers
 */

/**
 * @typedef {Object} ExtensionFixture
 * @property {import("@playwright/test").BrowserContext} context
 * @property {string} extensionId
 * @property {() => CapturedRequest[]} capturedRequests
 * @property {() => CapturedRequest[]} telemetryRequests
 * @property {(body: string) => void} setNextResponse
 * @property {(config: Record<string, unknown>) => Promise<void>} seedStorage
 */

const test = base.extend(/** @type {any} */ ({
  /**
   * Launches a fresh Chromium with the unpacked extension. Each test gets a
   * brand-new persistent context so chrome.storage is empty and SW state is
   * not shared. Headed mode is required — Chrome MV3 extensions only load in
   * the new headless mode, so we set `headless: false` for portability and
   * suggest xvfb for CI in the README.
   */
  context: async ({}, use) => {
    const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "llm-guard-e2e-"));
    const context = await chromium.launchPersistentContext(userDataDir, {
      headless: false,
      args: [
        `--disable-extensions-except=${EXT_PATH}`,
        `--load-extension=${EXT_PATH}`,
        "--no-first-run",
        "--no-default-browser-check",
      ],
    });

    /** @type {CapturedRequest[]} */
    const captured = [];
    /** @type {CapturedRequest[]} */
    const telemetry = [];
    /** @type {string | null} */
    let overrideResponseBody = null;

    // Route registration order matters: Playwright tries routes in REVERSE
    // registration order, so the LAST-registered handler wins for overlapping
    // patterns. Register the catch-all 404 first, then specific handlers, so
    // the specific ones take precedence.

    // Catch-all so any other chatgpt.com asset request returns 404 instead of
    // hitting the real network. Registered first → lowest priority.
    await context.route("https://chatgpt.com/**", async (route) => {
      await route.fulfill({ status: 404, body: "" });
    });

    // Capture and respond to the conversation endpoint. The extension's fetch
    // hook reaches this route AFTER its anonymization step, so what we capture
    // here IS the post-anonymization body. Default response echoes the user
    // text back so the de-anonymization path is exercised: any placeholder in
    // the post-anon body appears in the response and should be rewritten by
    // wrapResponseForDeanonymization.
    await context.route("https://chatgpt.com/backend-api/conversation", async (route) => {
      const req = route.request();
      const postData = req.postData() || "";
      captured.push({
        url: req.url(),
        method: req.method(),
        body: postData,
        headers: req.headers(),
      });
      let body = overrideResponseBody;
      if (body === null) {
        try {
          const parsed = JSON.parse(postData);
          const userText = parsed?.messages?.[0]?.content?.parts?.join(" ") || "";
          body = `Reply echo: ${userText}`;
        } catch {
          body = "Reply echo: (unparseable body)";
        }
      }
      await route.fulfill({
        status: 200,
        contentType: "text/plain; charset=utf-8",
        body,
      });
    });

    // Route the fixture page itself. Registered last → highest priority for
    // the root path.
    await context.route("https://chatgpt.com/", async (route) => {
      const body = fs.readFileSync(FIXTURE_HTML, "utf8");
      await route.fulfill({
        status: 200,
        contentType: "text/html; charset=utf-8",
        body,
      });
    });

    // Telemetry: extension flushes to {backendUrl}/v1/events. We use
    // http://localhost:9999 as the seeded URL and capture POSTs here.
    await context.route("http://localhost:9999/v1/events", async (route) => {
      const req = route.request();
      telemetry.push({
        url: req.url(),
        method: req.method(),
        body: req.postData() || "",
        headers: req.headers(),
      });
      await route.fulfill({
        status: 202,
        contentType: "application/json",
        body: JSON.stringify({ accepted: true }),
      });
    });

    // Resolve the extension's MV3 service worker so we can talk to chrome.* APIs.
    let [sw] = context.serviceWorkers();
    if (!sw) sw = await context.waitForEvent("serviceworker");
    const extensionId = sw.url().split("/")[2];

    /** @param {Record<string, unknown>} config */
    const seedStorage = async (config) => {
      // chrome.storage.local.set returns a Promise in MV3; await inside the
      // SW so the test sees a fully-flushed write before navigating.
      await sw.evaluate(
        (cfg) => new Promise((resolve) => chrome.storage.local.set(cfg, resolve)),
        config
      );
    };

    /** @param {string | null} body */
    const setNextResponse = (body) => {
      overrideResponseBody = body;
    };

    /** @type {ExtensionFixture} */
    const fixture = {
      context,
      extensionId,
      capturedRequests: () => captured,
      telemetryRequests: () => telemetry,
      setNextResponse,
      seedStorage,
    };

    // Make the helpers available via context._fixture so individual fixture
    // entries below can read them without reconstructing.
    /** @type {any} */ (context).__llmGuardFixture = fixture;

    await use(context);
    await context.close();
    try { fs.rmSync(userDataDir, { recursive: true, force: true }); } catch { /* ignore */ }
  },

  extensionId: async ({ context }, use) => {
    /** @type {any} */
    const ctx = context;
    await use(ctx.__llmGuardFixture.extensionId);
  },

  capturedRequests: async ({ context }, use) => {
    /** @type {any} */
    const ctx = context;
    await use(ctx.__llmGuardFixture.capturedRequests);
  },

  telemetryRequests: async ({ context }, use) => {
    /** @type {any} */
    const ctx = context;
    await use(ctx.__llmGuardFixture.telemetryRequests);
  },

  setNextResponse: async ({ context }, use) => {
    /** @type {any} */
    const ctx = context;
    await use(ctx.__llmGuardFixture.setNextResponse);
  },

  seedStorage: async ({ context }, use) => {
    /** @type {any} */
    const ctx = context;
    await use(ctx.__llmGuardFixture.seedStorage);
  },
}));

const expect = test.expect;

module.exports = { test, expect, EXT_PATH };
