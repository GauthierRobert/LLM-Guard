// @ts-check
/**
 * Tier B — real chatgpt.com smoke. Loads the live page (logged-out) and runs
 * the extension against the actual DOM. The /backend-api/conversation endpoint
 * is mocked so we don't burn rate limits, but every other selector / network
 * path / SPA quirk is real — that's the whole point of this tier.
 *
 *   npm run e2e:smoke
 *
 * If a test fails because chatgpt's selectors drifted, that's a real signal
 * — the adapter or composerSelector probably needs updating.
 */

const { test, expect, openRealChatGPT, typeAndSend } = require("./fixtures/smoke-extension");

const PII_EMAIL = "alice.smith@biz.com";

async function waitForCapture(getter, timeout = 30_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const reqs = getter();
    if (reqs.length > 0) return reqs[0];
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error("timed out waiting for prompt POST — chatgpt did not submit, or endpoint/selector drift");
}

/** Attach a request logger to a page that prints every POST. Used for triage. */
function attachPostLogger(page, label = "page-req") {
  page.on("request", (req) => {
    if (req.method() !== "POST") return;
    if (!req.url().includes("chatgpt.com")) return;
    if (req.url().includes("/cdn-cgi/")) return;
    if (req.url().includes("/ces/v1/")) return;
    if (req.url().includes("ab.chatgpt.com")) return;
    const body = (req.postData() || "").slice(0, 300);
    console.log(`[${label}] POST ${req.url()} body=${body}`);
  });
}

/** Same logger at context level — catches Service Worker requests. */
function attachContextPostLogger(context, label = "ctx-req") {
  context.on("request", (req) => {
    if (req.method() !== "POST") return;
    if (!req.url().includes("chatgpt.com")) return;
    if (req.url().includes("/cdn-cgi/")) return;
    if (req.url().includes("/ces/v1/")) return;
    if (req.url().includes("ab.chatgpt.com")) return;
    const body = (req.postData() || "").slice(0, 400);
    console.log(`[${label}] POST ${req.url()} body=${body}`);
  });
}

test.describe("@smoke real chatgpt.com — modes", () => {
  test("anonymize mode: PII is anonymized in the outgoing /conversation POST", async ({
    context,
    seedStorage,
    capturedRequests,
  }) => {
    await seedStorage({ guard_mode: "anonymize" });
    attachContextPostLogger(context, "ctx");
    const page = await context.newPage();
    attachPostLogger(page, "page");
    await openRealChatGPT(page);

    await typeAndSend(page, `Send a thank-you email to ${PII_EMAIL} for the demo.`);

    const req = await waitForCapture(capturedRequests, 60_000);
    // Don't assume a specific JSON shape — the adapter has already extracted
    // and rewritten in place. Assert on the wire body as a string.
    expect(req.body).not.toContain(PII_EMAIL);
    expect(req.body).toMatch(/\[EMAIL_[a-f0-9]+\]/i);
  });

  test("block mode: extension stops the request and shows a banner", async ({
    context,
    seedStorage,
    capturedRequests,
  }) => {
    await seedStorage({ guard_mode: "block" });
    const page = await context.newPage();
    await openRealChatGPT(page);

    await typeAndSend(page, `Wire it to FR76 3000 6000 0112 3456 7890 189 — for ${PII_EMAIL}.`);

    // The block banner is injected by ui.js. Loose match in case the markup
    // adds wrappers; the ID is stable across modes.
    await expect(page.locator("#llm-guard-banner")).toBeVisible({ timeout: 10_000 });

    // The conversation route should not have been hit — the extension's fetch
    // hook returned 403 before the network call.
    expect(capturedRequests().length).toBe(0);
  });

  test("visible mode: reveal button appears, user bubble shows placeholder, toggle reveals/masks", async ({
    context,
    seedStorage,
    capturedRequests,
  }) => {
    await seedStorage({ guard_mode: "visible" });
    const page = await context.newPage();
    await openRealChatGPT(page);

    // Reveal button is mounted at content-script init; visible only in visible mode.
    const revealBtn = page.locator("#llm-guard-reveal");
    await expect(revealBtn).toBeVisible({ timeout: 10_000 });
    await expect(revealBtn).toHaveText(/Révéler les PII/i);

    await typeAndSend(page, `Email ${PII_EMAIL} with the report.`);

    // Outgoing body must still be anonymized in visible mode (visible only
    // affects the local DOM rendering of the user bubble).
    const req = await waitForCapture(capturedRequests);
    expect(req.body).not.toContain(PII_EMAIL);
    expect(req.body).toMatch(/\[EMAIL_[a-f0-9]+\]/i);

    // The user's own message bubble — rendered by chatgpt — should show the
    // placeholder, not the original email. The conversation observer rewrites
    // it after submit. We assert against the conversation main container.
    const conversation = page.locator("main");
    await expect(conversation).toContainText(/\[EMAIL_[a-f0-9]+\]/i, { timeout: 10_000 });
    await expect(conversation).not.toContainText(PII_EMAIL);

    // Click reveal → bubble should now show the original email.
    await revealBtn.click();
    await expect(revealBtn).toHaveText(/Masquer les PII/i);
    await expect(conversation).toContainText(PII_EMAIL, { timeout: 5_000 });

    // Click again → back to placeholder.
    await revealBtn.click();
    await expect(revealBtn).toHaveText(/Révéler les PII/i);
    await expect(conversation).not.toContainText(PII_EMAIL);
    await expect(conversation).toContainText(/\[EMAIL_[a-f0-9]+\]/i);
  });

  test("visible → anonymize switch reverts revealed PII (privacy guard)", async ({
    context,
    seedStorage,
    capturedRequests,
  }) => {
    await seedStorage({ guard_mode: "visible" });
    const page = await context.newPage();
    await openRealChatGPT(page);

    await typeAndSend(page, `Loop in ${PII_EMAIL} on the launch.`);
    await waitForCapture(capturedRequests);

    const revealBtn = page.locator("#llm-guard-reveal");
    await expect(revealBtn).toBeVisible({ timeout: 5_000 });
    await revealBtn.click();
    const conversation = page.locator("main");
    await expect(conversation).toContainText(PII_EMAIL, { timeout: 5_000 });

    // Switch mode → "anonymize" via storage (popup does the same thing).
    // bridge.js relays storage.onChanged → modeUpdate → updateRevealButton(false)
    // → revertToPlaceholdersFn() must sweep the DOM back.
    await seedStorage({ guard_mode: "anonymize" });

    await expect(revealBtn).toBeHidden({ timeout: 5_000 });
    await expect(conversation).not.toContainText(PII_EMAIL, { timeout: 5_000 });
    await expect(conversation).toContainText(/\[EMAIL_[a-f0-9]+\]/i);
  });
});
