// @ts-check
/**
 * Tier B fixture — loads REAL chatgpt.com but mocks only the conversation
 * endpoint, so the test exercises real chatgpt selectors / DOM / bundle but
 * doesn't burn rate limits or wait for a model response.
 *
 * Differs from extension.js (Tier A) in:
 *   - No fixture HTML; chatgpt.com loads from the actual origin.
 *   - Only the /conversation endpoint family is intercepted.
 *   - Realistic UA + viewport so Cloudflare is less likely to challenge.
 */

const { test: base, chromium } = require("@playwright/test");
const path = require("path");
const fs = require("fs");
const os = require("os");

const EXT_PATH = path.resolve(__dirname, "..", "..");

const test = base.extend(/** @type {any} */ ({
  context: async ({}, use) => {
    const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "llm-guard-smoke-"));
    const context = await chromium.launchPersistentContext(userDataDir, {
      headless: false,
      viewport: { width: 1280, height: 800 },
      // Match a recent stable Chrome UA to reduce CF heuristics flagging us.
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
      args: [
        `--disable-extensions-except=${EXT_PATH}`,
        `--load-extension=${EXT_PATH}`,
        "--no-first-run",
        "--no-default-browser-check",
      ],
    });

    /** @type {{url: string, body: string, method: string}[]} */
    const captured = [];

    // Match the same /conversation regex the extension uses for chatgpt
    // (LLM_PROFILES.chatgpt.endpointMatch = /\/conversation/). This catches
    // /backend-api/conversation, /backend-anon/conversation, etc.
    //
    // Critical: chatgpt fires SEVERAL POSTs against /conversation paths —
    // gizmo init, model preference, then the actual prompt. Only the prompt
    // body has a `messages` field. Mocking the init requests breaks the
    // page state and the prompt POST never fires. We forward everything
    // except the prompt POST, which we capture and short-circuit.
    await context.route(/https:\/\/chatgpt\.com\/.*conversation.*/, async (route) => {
      const req = route.request();
      if (req.method() !== "POST") {
        await route.fallback();
        return;
      }
      const body = req.postData() || "";
      // Identify the prompt POST: real chatgpt may use `messages` (logged-in)
      // or `parts`/`prompt` (logged-out variants). We accept any of these
      // shapes; auxiliary POSTs (init, sentinel, gizmo) carry none of them.
      const looksLikePrompt =
        body.includes('"messages"') ||
        body.includes('"parts"') ||
        body.includes('"prompt"');
      console.log(`[smoke-route] POST ${req.url()} prompt=${looksLikePrompt} body=${body}`);
      if (!looksLikePrompt) {
        await route.fallback();
        return;
      }
      captured.push({
        url: req.url(),
        method: req.method(),
        body,
      });
      await route.fulfill({
        status: 200,
        contentType: "text/event-stream",
        body: "data: [DONE]\n\n",
      });
    });

    let [sw] = context.serviceWorkers();
    if (!sw) sw = await context.waitForEvent("serviceworker");
    const extensionId = sw.url().split("/")[2];

    /** @param {Record<string, unknown>} cfg */
    const seedStorage = async (cfg) => {
      await sw.evaluate(
        (c) => new Promise((r) => chrome.storage.local.set(c, r)),
        cfg
      );
    };

    /** @type {any} */ (context).__llmGuardSmoke = {
      extensionId,
      capturedRequests: () => captured,
      seedStorage,
      sw: () => {
        const ws = context.serviceWorkers();
        return ws[0] || sw;
      },
    };

    await use(context);
    await context.close();
    try { fs.rmSync(userDataDir, { recursive: true, force: true }); } catch { /* ignore */ }
  },

  extensionId: async ({ context }, use) => {
    /** @type {any} */ const ctx = context;
    await use(ctx.__llmGuardSmoke.extensionId);
  },
  capturedRequests: async ({ context }, use) => {
    /** @type {any} */ const ctx = context;
    await use(ctx.__llmGuardSmoke.capturedRequests);
  },
  seedStorage: async ({ context }, use) => {
    /** @type {any} */ const ctx = context;
    await use(ctx.__llmGuardSmoke.seedStorage);
  },
}));

const expect = test.expect;

/**
 * Best-effort dismissal of the chatgpt "stay logged out" modal and any cookie
 * banners. Logged-out chatgpt sometimes prompts; non-fatal if absent.
 *
 * @param {import("@playwright/test").Page} page
 */
async function dismissChatGPTModals(page) {
  // "Stay logged out" link — appears in some experiments.
  const stayLoggedOut = page.getByRole("link", { name: /stay logged out/i });
  try {
    if (await stayLoggedOut.isVisible({ timeout: 2_000 })) await stayLoggedOut.click();
  } catch { /* not present */ }

  // Cookie banner (region-dependent).
  const accept = page.getByRole("button", { name: /accept|agree|ok/i }).first();
  try {
    if (await accept.isVisible({ timeout: 1_000 })) await accept.click();
  } catch { /* not present */ }
}

/**
 * Open chatgpt.com, dismiss any onboarding modals, and wait for the
 * extension's badge to confirm the content script attached.
 *
 * @param {import("@playwright/test").Page} page
 */
async function openRealChatGPT(page) {
  await page.goto("https://chatgpt.com/", { waitUntil: "domcontentloaded" });
  await dismissChatGPTModals(page);
  await expect(page.locator("#llm-guard-badge")).toBeVisible({ timeout: 20_000 });
}

/**
 * Type into chatgpt's composer (a contenteditable div in modern builds) and
 * send via Enter. `fill()` doesn't work reliably on contenteditable, so we
 * focus + use keyboard.type. Selector mirrors the manifest profile.
 *
 * @param {import("@playwright/test").Page} page
 * @param {string} text
 */
async function typeAndSend(page, text) {
  const composer = page.locator("#prompt-textarea");
  await expect(composer).toBeVisible({ timeout: 10_000 });
  await composer.click();
  await page.keyboard.type(text, { delay: 5 });
  // Send button is the most reliable submit path; fall back to Enter if the
  // button is not exposed (older variants).
  const sendBtn = page.locator('[data-testid="send-button"]');
  if (await sendBtn.count()) {
    await sendBtn.click();
  } else {
    await page.keyboard.press("Enter");
  }
}

module.exports = { test, expect, openRealChatGPT, typeAndSend, dismissChatGPTModals };
