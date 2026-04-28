// @ts-check
/**
 * Tier B — real chat.mistral.ai smoke. Loads the live page (no login required
 * for demo flow) and runs the extension against the actual DOM. The prompt
 * endpoint is mocked so we don't burn rate limits or wait for a model
 * response, but every other selector / network path / SPA quirk is real.
 *
 *   npm run e2e:smoke
 *
 * If a test fails because Le Chat's selectors drifted, that's a real signal
 * — the LLM_PROFILES.mistral entry probably needs updating.
 */

const { test, expect, openRealMistral, typeAndSend } = require("./fixtures/smoke-extension");

const PII_EMAIL = "alice.smith@biz.com";

async function waitForCapture(getter, timeout = 30_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const reqs = getter();
    if (reqs.length > 0) return reqs[0];
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error("timed out waiting for prompt POST — submission did not fire, or endpoint/selector drift");
}

test.describe("@smoke real chat.mistral.ai — modes", () => {
  test("anonymize mode: PII is anonymized in the outgoing prompt POST", async ({
    context,
    seedStorage,
    capturedRequests,
  }) => {
    await seedStorage({ guard_mode: "anonymize" });
    const page = await context.newPage();
    await openRealMistral(page);

    await typeAndSend(page, `Send a thank-you email to ${PII_EMAIL} for the demo.`);

    const req = await waitForCapture(capturedRequests);
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
    await openRealMistral(page);

    await typeAndSend(page, `Wire it to FR76 3000 6000 0112 3456 7890 189 — for ${PII_EMAIL}.`);

    await expect(page.locator("#llm-guard-banner")).toBeVisible({ timeout: 10_000 });
    expect(capturedRequests().length).toBe(0);
  });

  test("visible mode: reveal button appears, user bubble shows placeholder, toggle reveals/masks", async ({
    context,
    seedStorage,
    capturedRequests,
  }) => {
    await seedStorage({ guard_mode: "visible" });
    const page = await context.newPage();
    await openRealMistral(page);

    const revealBtn = page.locator("#llm-guard-reveal");
    await expect(revealBtn).toBeVisible({ timeout: 10_000 });
    await expect(revealBtn).toHaveText(/Révéler les PII/i);

    await typeAndSend(page, `Email ${PII_EMAIL} with the report.`);

    const req = await waitForCapture(capturedRequests);
    expect(req.body).not.toContain(PII_EMAIL);
    expect(req.body).toMatch(/\[EMAIL_[a-f0-9]+\]/i);

    const conversation = page.locator("main");
    await expect(conversation).toContainText(/\[EMAIL_[a-f0-9]+\]/i, { timeout: 10_000 });
    await expect(conversation).not.toContainText(PII_EMAIL);

    await revealBtn.click();
    await expect(revealBtn).toHaveText(/Masquer les PII/i);
    await expect(conversation).toContainText(PII_EMAIL, { timeout: 5_000 });

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
    await openRealMistral(page);

    await typeAndSend(page, `Loop in ${PII_EMAIL} on the launch.`);
    await waitForCapture(capturedRequests);

    const revealBtn = page.locator("#llm-guard-reveal");
    await expect(revealBtn).toBeVisible({ timeout: 5_000 });
    await revealBtn.click();
    const conversation = page.locator("main");
    await expect(conversation).toContainText(PII_EMAIL, { timeout: 5_000 });

    // Mode switch via storage. bridge.js relays storage.onChanged →
    // modeUpdate → updateRevealButton(false) → revertToPlaceholdersFn() must
    // sweep the DOM back to placeholders BEFORE the button hides.
    await seedStorage({ guard_mode: "anonymize" });

    await expect(revealBtn).toBeHidden({ timeout: 5_000 });
    await expect(conversation).not.toContainText(PII_EMAIL, { timeout: 5_000 });
    await expect(conversation).toContainText(/\[EMAIL_[a-f0-9]+\]/i);
  });
});
