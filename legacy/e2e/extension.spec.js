// @ts-check
const { test, expect } = require("./fixtures/extension");

/**
 * Each test starts with a fresh persistent context. We seed chrome.storage
 * BEFORE goto so the content script reads our test config on init via the
 * bridge.js getMode handler — race-free.
 */

async function openMockChatGPT(page) {
  await page.goto("https://chatgpt.com/");
  // Wait for the extension to attach. The badge `#llm-guard-badge` is
  // injected by ui.js once the content script confirms an active LLM
  // profile. Its presence proves the content script ran on this page.
  await expect(page.locator("#llm-guard-badge")).toBeVisible({ timeout: 10_000 });
}

async function send(page, text) {
  await page.locator("#prompt-textarea").fill(text);
  await page.locator("#send").click();
}

async function waitForCapture(getter, predicate = () => true) {
  // Poll instead of using waitForRequest because route handlers above already
  // fulfilled — there's no networkidle event tied to them when the body
  // round-trips through the extension's wrapper.
  const deadline = Date.now() + 8_000;
  while (Date.now() < deadline) {
    const reqs = getter();
    const match = reqs.find(predicate);
    if (match) return match;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("timed out waiting for captured request");
}

test.describe("LLM Guard — extension intercept on mock ChatGPT", () => {
  test("clean prompt passes through unchanged", async ({ context, capturedRequests, seedStorage }) => {
    await seedStorage({ guard_mode: "anonymize" });
    const page = await context.newPage();
    await openMockChatGPT(page);

    const prompt = "Tell me a joke about Belgian frites.";
    await send(page, prompt);

    const req = await waitForCapture(capturedRequests);
    const parsed = JSON.parse(req.body);
    const sentText = parsed.messages[0].content.parts.join(" ");
    expect(sentText).toBe(prompt);
  });

  test("email PII is anonymized in outgoing body", async ({ context, capturedRequests, seedStorage }) => {
    await seedStorage({ guard_mode: "anonymize" });
    const page = await context.newPage();
    await openMockChatGPT(page);

    // NB: example.com / .test / .invalid are RFC-reserved and deliberately
    // skipped by the email validator — use a plausible non-reserved domain.
    const prompt = "Please email me at john.doe@biz.com about the report.";
    await send(page, prompt);

    const req = await waitForCapture(capturedRequests);
    const parsed = JSON.parse(req.body);
    const sentText = parsed.messages[0].content.parts.join(" ");

    expect(sentText).not.toContain("john.doe@biz.com");
    expect(sentText).toMatch(/\[EMAIL_[a-f0-9]+\]/i);
  });

  test("phone + IBAN are both anonymized", async ({ context, capturedRequests, seedStorage }) => {
    await seedStorage({ guard_mode: "anonymize" });
    const page = await context.newPage();
    await openMockChatGPT(page);

    // FR phone + FR IBAN — both should match Layer 1 regex.
    const prompt = "Call +33 6 12 34 56 78 and wire to FR76 3000 6000 0112 3456 7890 189.";
    await send(page, prompt);

    const req = await waitForCapture(capturedRequests);
    const parsed = JSON.parse(req.body);
    const sentText = parsed.messages[0].content.parts.join(" ");

    expect(sentText).not.toContain("+33 6 12 34 56 78");
    expect(sentText).not.toContain("FR76 3000 6000 0112 3456 7890 189");
    expect(sentText).toMatch(/\[TEL_[a-f0-9]+\]/i);
    expect(sentText).toMatch(/\[IBAN_[a-f0-9]+\]/i);
  });

  test("block mode prevents the request from reaching the network", async ({
    context,
    capturedRequests,
    seedStorage,
  }) => {
    await seedStorage({ guard_mode: "block" });
    const page = await context.newPage();
    await openMockChatGPT(page);

    await send(page, "Critical PII: ssn 123-45-6789 + email a@b.com");

    // Page receives a 403 from the extension itself; route handler should
    // not have been invoked.
    await expect(page.locator("#status")).toHaveText(/blocked status=403/, { timeout: 5_000 });
    expect(capturedRequests().length).toBe(0);
  });

  test("response containing placeholder is de-anonymized in DOM", async ({
    context,
    capturedRequests,
    seedStorage,
  }) => {
    await seedStorage({ guard_mode: "anonymize" });
    const page = await context.newPage();
    await openMockChatGPT(page);

    const email = "alice@biz.com";
    await send(page, `Confirm with ${email} please.`);

    // The default route echoes the post-anon body back, so the response
    // contains the placeholder. wrapResponseForDeanonymization rewrites it
    // back to the original email before the page's `await resp.text()`
    // resolves.
    await waitForCapture(capturedRequests);
    await expect(page.locator("#response")).toContainText(email, { timeout: 5_000 });
    // And the captured outgoing body must NOT contain the original.
    const req = capturedRequests()[0];
    expect(req.body).not.toContain(email);
  });

  test("banner appears with action=ANONYMIZED when PII is detected", async ({
    context,
    seedStorage,
    capturedRequests,
  }) => {
    await seedStorage({ guard_mode: "anonymize" });
    const page = await context.newPage();
    await openMockChatGPT(page);

    await send(page, "Reach out to me at bob@corp.com.");
    await waitForCapture(capturedRequests);

    // The banner is injected by ui.js. Selector follows the convention used
    // elsewhere in the codebase; loosen if the markup is different.
    const banner = page.locator("#llm-guard-banner, [data-llm-guard-banner]").first();
    await expect(banner).toBeVisible({ timeout: 3_000 });
  });

  test("telemetry: enabled + configured flushes events to backend", async ({
    context,
    seedStorage,
    capturedRequests,
    telemetryRequests,
  }) => {
    await seedStorage({
      guard_mode: "anonymize",
      guard_telemetry_config: {
        enabled: true,
        backendUrl: "http://localhost:9999",
        deviceToken: "test-token",
        deviceId: "test-device",
        orgId: "test-org",
        userHint: "",
      },
    });

    const page = await context.newPage();
    await openMockChatGPT(page);

    await send(page, "ping carol@biz.com");
    await waitForCapture(capturedRequests);

    // Force an immediate flush via the SW instead of waiting for the 1-min alarm.
    const [sw] = context.serviceWorkers();
    await sw.evaluate(() => self.telemetry.flush());

    // Wait for the POST to /v1/events.
    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline && telemetryRequests().length === 0) {
      await new Promise((r) => setTimeout(r, 100));
    }
    const tel = telemetryRequests();
    expect(tel.length).toBeGreaterThan(0);
    expect(tel[0].headers["authorization"]).toBe("Bearer test-token");
    const payload = JSON.parse(tel[0].body);
    expect(Array.isArray(payload.events)).toBe(true);
    expect(payload.events.length).toBeGreaterThan(0);
    // Scrubber must remove the raw prompt before upload.
    expect(tel[0].body).not.toContain("carol@biz.com");
  });
});
