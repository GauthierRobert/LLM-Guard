/**
 * End-to-end tests for the **send guard** — the v4 fetch interception, which
 * since v5 is opt-in (`guardOnSend`) and therefore switched on explicitly here.
 * The primary, default protection is the paste guard: see `paste.spec.ts`.
 *
 * Each test navigates to the (mocked) ChatGPT page, calls `window.sendPrompt`
 * — which POSTs a prompt the way the real web app does — and asserts on the
 * outcome the extension produced:
 *   - the toast banner (#__llm-guard-toast), and
 *   - the bytes the page actually sent (echoed back by the mock endpoint).
 *
 * Detection runs off the bundled default rules, which are active in the MAIN
 * world from page boot.
 */

import { test, expect, LLM_PAGE_URL, setGuardConfig } from "./fixtures";

type SendResult = { status: number; body: { echoed?: { messages: { content: { parts: string[] } }[] } } | null };

declare global {
  interface Window {
    /** Defined by mock-llm.html — POSTs a prompt the way the LLM web app does. */
    sendPrompt(text: string): Promise<SendResult>;
  }
}

/** Pull the (possibly anonymized) prompt text back out of the echoed body. */
function sentPrompt(res: SendResult): string {
  return res.body?.echoed?.messages?.[0]?.content?.parts?.[0] ?? "";
}

const TOAST = "#__llm-guard-toast";

test.describe("AvoPseudo — send guard (opt-in)", () => {
  test.beforeEach(async ({ context, extensionId, page }) => {
    await setGuardConfig(context, extensionId, {
      enabled: true,
      // The send guard is off by default in v5; these specs are about it.
      guardOnSend: true,
      ner: { enabled: false },
    });
    await page.goto(LLM_PAGE_URL);
    // @crxjs loads the MAIN-world script via an async import, so window.fetch is
    // patched a tick after document_start. Wait for the patch's readiness marker
    // before sending, otherwise a fast fetch races the original (unpatched) one.
    await page.waitForFunction(() => "__llmGuardOriginalFetch" in window);
  });

  test("anonymizes an email before it leaves the page", async ({ page }) => {
    const res: SendResult = await page.evaluate(
      () => window.sendPrompt("Contact me at alice@personal.com please."),
    );

    expect(res.status).toBe(200);
    const sent = sentPrompt(res);
    expect(sent).toContain("[EMAIL_");
    expect(sent).not.toContain("alice@personal.com");

    await expect(page.locator(TOAST)).toContainText(/anonymized/i);
  });

  test("blocks a prompt containing an AWS access key", async ({ page }) => {
    const res: SendResult = await page.evaluate(
      () => window.sendPrompt("my key is AKIAIOSFODNN7EXAMPLE do not share"),
    );

    // Blocked requests never reach the network: a synthetic 403 is returned.
    expect(res.status).toBe(403);
    await expect(page.locator(TOAST)).toContainText(/blocked/i);
  });

  test("warns (but still sends) on an RGPD-sensitive keyword", async ({ page }) => {
    // NOTE: the bundled ruleset spells its French keywords without accents and
    // there is no accent folding, so "dossier médical" does NOT match today —
    // only the unaccented spelling does.
    const res: SendResult = await page.evaluate(
      () => window.sendPrompt("Le dossier medical du dossier RH est joint."),
    );

    expect(res.status).toBe(200);
    // warn passes the prompt through untouched.
    expect(sentPrompt(res)).toContain("dossier medical");
    await expect(page.locator(TOAST)).toContainText(/detected/i);
  });

  test("passes a clean prompt through with no banner", async ({ page }) => {
    const res: SendResult = await page.evaluate(
      () => window.sendPrompt("What is the capital of France?"),
    );

    expect(res.status).toBe(200);
    expect(sentPrompt(res)).toBe("What is the capital of France?");
    await expect(page.locator(TOAST)).toHaveCount(0);
  });

  test("anonymizes the same value to a stable placeholder", async ({ page }) => {
    const res: SendResult = await page.evaluate(
      () =>
        window.sendPrompt(
          "Mail alice@personal.com, then again alice@personal.com.",
        ),
    );

    const sent = sentPrompt(res);
    const labels = sent.match(/\[EMAIL_[0-9a-f]+\]/g) ?? [];
    expect(labels.length).toBe(2);
    // Same source value → same placeholder both times.
    expect(labels[0]).toBe(labels[1]);
  });
});
