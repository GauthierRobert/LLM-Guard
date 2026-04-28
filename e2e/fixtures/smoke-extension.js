// @ts-check
/**
 * Tier B fixture — loads REAL chat.mistral.ai but mocks only the prompt
 * endpoint, so the test exercises real Mistral selectors / DOM / bundle but
 * doesn't burn rate limits or wait for a model response.
 *
 * Mistral is the chosen smoke target because logged-out ChatGPT failed the
 * Cloudflare Sentinel/PoW challenge under instrumented Playwright. Le Chat
 * exposes a free demo flow without that gating, and uses an OpenAI-compatible
 * `{messages: [...]}` wire format the extension's mistral adapter understands.
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

    // The extension matches /api/(chat|conversation|completion)/i for mistral.
    // Le Chat fires several POSTs against these paths — auth, conversation
    // listing, then the actual prompt. Only the prompt POST has a `messages`
    // array; auxiliary calls do not. Forward auxiliary; capture + short-
    // circuit the prompt.
    await context.route(/https:\/\/chat\.mistral\.ai\/api\/.*(chat|conversation|completion).*/i, async (route) => {
      const req = route.request();
      if (req.method() !== "POST") {
        await route.fallback();
        return;
      }
      const body = req.postData() || "";
      const looksLikePrompt = body.includes('"messages"');
      console.log(`[smoke-route] POST ${req.url()} prompt=${looksLikePrompt} body=${body.slice(0, 300)}`);
      if (!looksLikePrompt) {
        await route.fallback();
        return;
      }
      captured.push({ url: req.url(), method: req.method(), body });
      // Mistral streams SSE; an empty stream terminator is enough to satisfy
      // the client without burning model tokens.
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
 * Best-effort dismissal of Le Chat onboarding / cookie modals.
 *
 * @param {import("@playwright/test").Page} page
 */
async function dismissMistralModals(page) {
  // Le Chat shows a ToS modal on first load — the exact button text is
  // "Accept and continue". Wait up to 8s for it to render (it may appear
  // after the initial DOM is interactive).
  const tosBtn = page.getByRole("button", { name: /accept and continue/i });
  try {
    await tosBtn.click({ timeout: 8_000 });
  } catch { /* not present this session */ }

  // Generic cookie consent fallback.
  const accept = page.getByRole("button", { name: /^(accept|agree|ok|got it)$/i }).first();
  try {
    if (await accept.isVisible({ timeout: 1_500 })) await accept.click();
  } catch { /* not present */ }
}

/**
 * Open chat.mistral.ai, dismiss any onboarding modals, and wait for the
 * extension's badge to confirm the content script attached.
 *
 * @param {import("@playwright/test").Page} page
 */
async function openRealMistral(page) {
  await page.goto("https://chat.mistral.ai/", { waitUntil: "domcontentloaded" });
  await dismissMistralModals(page);
  await expect(page.locator("#llm-guard-badge")).toBeVisible({ timeout: 20_000 });
}

/**
 * Type into Le Chat's composer (textarea or contenteditable) and submit via
 * Enter. The composer selector mirrors LLM_PROFILES.mistral.composerSelector.
 *
 * @param {import("@playwright/test").Page} page
 * @param {string} text
 */
async function typeAndSend(page, text) {
  const composer = page.locator('textarea[placeholder], div[contenteditable="true"]').first();
  await expect(composer).toBeVisible({ timeout: 10_000 });
  await composer.click();
  await page.keyboard.type(text, { delay: 5 });
  // Send-button selector varies; fall back to Enter (Le Chat submits on
  // unmodified Enter for textarea composers).
  const sendBtn = page.locator('button[type="submit"], button[aria-label*="send" i]').first();
  if (await sendBtn.count()) {
    await sendBtn.click().catch(() => page.keyboard.press("Enter"));
  } else {
    await page.keyboard.press("Enter");
  }
}

module.exports = { test, expect, openRealMistral, typeAndSend, dismissMistralModals };
