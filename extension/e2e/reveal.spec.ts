/**
 * End-to-end test for manual reveal/hide against the loaded extension.
 *
 * Flow: paste sensitive text into the composer (mints a placeholder in the
 * MAIN-world anonymizer) -> simulate the message landing in the finished
 * conversation (reveal never touches the composer itself, by design) -> open
 * the real popup and click "Reveal real values" -> assert the placeholder in
 * the conversation is swapped for the real value -> click "Hide" -> assert it
 * is swapped back.
 */

import { test, expect, LLM_PAGE_URL, setGuardConfig } from "./fixtures";
import type { Page } from "@playwright/test";

declare global {
  interface Window {
    pasteInto(selector: string, text: string): Promise<unknown>;
    composerText(selector: string): string;
  }
}

const TEXTAREA = "#composer";
const CONVERSATION = "#conversation";
const NOTICE = "#__avopseudo-paste-notice";

/** Read the notice panel's text out of its shadow root. */
async function noticeText(page: Page): Promise<string> {
  return page.evaluate((sel) => {
    const host = document.querySelector(sel);
    return host?.shadowRoot?.textContent ?? "";
  }, NOTICE);
}

test.describe("AvoPseudo — manual reveal", () => {
  test.beforeEach(async ({ context, extensionId, page }) => {
    await setGuardConfig(context, extensionId, {
      enabled: true,
      pasteGuard: true,
      guardOnSend: false,
      ner: { enabled: false },
    });
    await page.goto(LLM_PAGE_URL);
    await page.waitForFunction(() => "__llmGuardOriginalFetch" in window);
  });

  /**
   * Open the toolbar popup fresh (as a real user does every time — the popup
   * document is destroyed on close and rebuilt from scratch on next open) and
   * click "Reveal/Hide" exactly once, the way a user clicks whatever the
   * button currently says.
   */
  async function openPopupAndClickReveal(
    context: import("@playwright/test").BrowserContext,
    extensionId: string,
    llmPage: Page,
  ): Promise<{ popup: Page; buttonLabelBefore: string; hint: string }> {
    const popup = await context.newPage();
    // A real toolbar popup never steals "active tab" status from the page that
    // was open when the user clicked the icon. Navigating to popup.html as a
    // plain tab (Playwright has no way to trigger the real popup surface) does
    // make it a tab, so re-activate the LLM tab to match chrome.tabs.query's
    // real-world { active: true, currentWindow: true } result — and do it
    // *before* navigating, since popup.ts queries the reveal status as soon as
    // its document loads.
    await llmPage.bringToFront();
    await popup.goto(`chrome-extension://${extensionId}/src/popup/popup.html`);
    const btn = popup.locator("#reveal-toggle");
    const buttonLabelBefore = (await btn.textContent()) ?? "";
    await btn.click();
    await popup.waitForFunction(
      () => !(document.getElementById("reveal-toggle") as HTMLButtonElement).disabled,
    );
    const hint = (await popup.locator("#reveal-hint").textContent()) ?? "";
    return { popup, buttonLabelBefore, hint };
  }

  test("reveals the real value in a finished conversation bubble, then hides it again", async ({
    context,
    extensionId,
    page,
  }) => {
    await page.evaluate(() =>
      window.pasteInto("#composer", "Contact me at alice@personal.com please."),
    );
    const pseudonymised = await page.evaluate((s) => window.composerText(s), TEXTAREA);
    expect(pseudonymised).toContain("[EMAIL_");

    // Simulate the message having been sent: the placeholder text now sits in
    // a finished conversation bubble, which is the only place reveal touches.
    await page.evaluate(
      ({ sel, text }) => {
        document.querySelector(sel)!.textContent = text;
      },
      { sel: CONVERSATION, text: pseudonymised },
    );

    // First open: click "Reveal real values".
    const first = await openPopupAndClickReveal(context, extensionId, page);
    expect(first.buttonLabelBefore).toContain("Reveal");
    await first.popup.close();

    const revealedText = await page.evaluate((s) => document.querySelector(s)!.textContent, CONVERSATION);
    expect(first.hint).toContain("Showing");
    expect(revealedText).toContain("alice@personal.com");
    expect(revealedText).not.toContain("[EMAIL_");

    // Reopen the popup (a fresh document, exactly like a real toolbar popup)
    // and click whatever it says now, expecting it to say "Hide" since the
    // page is currently revealed — and for the click to actually hide it.
    const second = await openPopupAndClickReveal(context, extensionId, page);
    await second.popup.close();

    const hiddenText = await page.evaluate((s) => document.querySelector(s)!.textContent, CONVERSATION);
    expect(second.buttonLabelBefore).toContain("Hide");
    expect(hiddenText).toContain("[EMAIL_");
    expect(hiddenText).not.toContain("alice@personal.com");
  });

  test("reveals an unsent paste by reopening the review panel", async ({
    context,
    extensionId,
    page,
  }) => {
    await page.evaluate(() =>
      window.pasteInto("#composer", "Contact me at alice@personal.com please."),
    );
    const pseudonymised = await page.evaluate((s) => window.composerText(s), TEXTAREA);
    expect(pseudonymised).toContain("[EMAIL_");

    // Nothing has been sent, so the placeholder exists only in the composer —
    // which the in-page walk deliberately never touches. Reveal used to look
    // completely dead here; it must bring the panel back instead.
    const first = await openPopupAndClickReveal(context, extensionId, page);
    expect(first.buttonLabelBefore).toContain("Reveal");
    await first.popup.close();

    await expect(page.locator(NOTICE)).toHaveCount(1);
    expect(await noticeText(page)).toContain("alice@personal.com");
    expect(first.hint).toContain("AvoPseudo panel");

    // ...and the box the user is about to send is left exactly as it was.
    expect(await page.evaluate((s) => window.composerText(s), TEXTAREA)).toBe(pseudonymised);

    // The popup now offers "Hide", which masks the values again in place.
    const second = await openPopupAndClickReveal(context, extensionId, page);
    expect(second.buttonLabelBefore).toContain("Hide");
    await second.popup.close();

    expect(await noticeText(page)).not.toContain("alice@personal.com");
  });
});
