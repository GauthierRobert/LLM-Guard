/**
 * End-to-end tests for the v5 paste guard against the loaded extension.
 *
 * The mock page dispatches a real `ClipboardEvent` carrying a `DataTransfer`
 * (`window.pasteInto`), which is what a Ctrl/⌘+V, a right-click *Paste* and an
 * on-screen paste button all produce. The extension's capture-phase listener
 * sees it, runs the bundled default rules and writes the result back into the
 * composer — so the assertions read the composer, not the network.
 *
 * The on-device NER model is switched off for these specs: it would add a
 * (bounded) wait to every paste and its findings are not what is under test.
 */

import { test, expect, LLM_PAGE_URL, setGuardConfig } from "./fixtures";

declare global {
  interface Window {
    pasteInto(selector: string, text: string): Promise<unknown>;
    composerText(selector: string): string;
  }
}

const NOTICE = "#__avopseudo-paste-notice";
const TEXTAREA = "#composer";
const RICH = "#rich";

/** Read the notice panel's text out of its shadow root. */
async function noticeText(page: import("@playwright/test").Page): Promise<string> {
  return page.evaluate((sel) => {
    const host = document.querySelector(sel);
    return host?.shadowRoot?.textContent ?? "";
  }, NOTICE);
}

test.describe("AvoPseudo — paste interception", () => {
  test.beforeEach(async ({ context, extensionId, page }) => {
    await setGuardConfig(context, extensionId, {
      enabled: true,
      pasteGuard: true,
      guardOnSend: false,
      ner: { enabled: false },
    });
    await page.goto(LLM_PAGE_URL);
    // @crxjs loads the MAIN-world script via an async import, so the listener is
    // installed a tick after document_start.
    await page.waitForFunction(() => "__llmGuardOriginalFetch" in window);
  });

  test("pseudonymises an email as it is pasted into a textarea", async ({ page }) => {
    await page.evaluate(() =>
      window.pasteInto("#composer", "Contact me at alice@personal.com please."),
    );

    const text = await page.evaluate((s) => window.composerText(s), TEXTAREA);
    expect(text).toContain("[EMAIL_");
    expect(text).not.toContain("alice@personal.com");
  });

  test("pseudonymises into a contenteditable rich editor too", async ({ page }) => {
    await page.evaluate(() =>
      window.pasteInto("#rich", "Contact me at alice@personal.com please."),
    );

    const text = await page.evaluate((s) => window.composerText(s), RICH);
    expect(text).toContain("[EMAIL_");
    expect(text).not.toContain("alice@personal.com");
  });

  test("says who did it, in words, and lists the substitution", async ({ page }) => {
    await page.evaluate(() =>
      window.pasteInto("#composer", "Contact me at alice@personal.com please."),
    );

    await expect(page.locator(NOTICE)).toHaveCount(1);
    const text = await noticeText(page);
    expect(text).toContain("AvoPseudo");
    expect(text).toContain("not from this website");
    expect(text).toContain("not from the AI");
    expect(text).toContain("[EMAIL_");
    // The real value is masked until the user asks for it.
    expect(text).not.toContain("alice@personal.com");
  });

  test("undo puts the original text back in the box", async ({ page }) => {
    await page.evaluate(() =>
      window.pasteInto("#composer", "Contact me at alice@personal.com please."),
    );
    await expect(page.locator(NOTICE)).toHaveCount(1);

    await page.evaluate((sel) => {
      const host = document.querySelector(sel);
      const buttons = Array.from(host?.shadowRoot?.querySelectorAll("button") ?? []);
      buttons.find((b) => b.textContent?.startsWith("Undo"))?.click();
    }, NOTICE);

    const text = await page.evaluate((s) => window.composerText(s), TEXTAREA);
    expect(text).toBe("Contact me at alice@personal.com please.");
  });

  test("blocks a paste containing an AWS access key — nothing lands in the box", async ({
    page,
  }) => {
    await page.evaluate(() =>
      window.pasteInto("#composer", "my key is AKIAIOSFODNN7EXAMPLE do not share"),
    );

    expect(await page.evaluate((s) => window.composerText(s), TEXTAREA)).toBe("");
    expect(await noticeText(page)).toContain("Nothing was pasted");
  });

  test("keeps a stable placeholder for a value pasted twice", async ({ page }) => {
    await page.evaluate(() =>
      window.pasteInto("#composer", "Mail alice@personal.com, then alice@personal.com again."),
    );

    const text = await page.evaluate((s) => window.composerText(s), TEXTAREA);
    const labels = text.match(/\[EMAIL_[0-9a-f]+\]/g) ?? [];
    expect(labels.length).toBe(2);
    expect(labels[0]).toBe(labels[1]);
  });

  // ChatGPT centres its composer vertically until the first message is sent,
  // which leaves far less room above it than a bottom-docked composer does.
  for (const [label, css] of [
    ["centred composer", { top: "50%", bottom: "auto" }],
    ["bottom-docked composer", { top: "auto", bottom: "24px" }],
  ] as const) {
    test(`panel stays fully on screen — ${label}`, async ({ page }) => {
      await page.setViewportSize({ width: 900, height: 700 });
      await page.evaluate((style) => {
        const ta = document.querySelector("#composer") as HTMLTextAreaElement;
        Object.assign(ta.style, { position: "fixed", left: "40px", width: "800px" }, style);
      }, css);

      await page.evaluate(() =>
        window.pasteInto(
          "#composer",
          "Madame Sophie Lemaire, nee le 14/03/1978, Rue de la Loi 42, +32 475 12 34 56, " +
            "sophie.lemaire@lemaire-avocats.be, NRN 78.03.14-123.49, IBAN BE68 5390 0754 7034.",
        ),
      );
      await expect(page.locator(NOTICE)).toHaveCount(1);

      const box = await page.evaluate((sel) => {
        const card = document.querySelector(sel)!.shadowRoot!.firstElementChild!;
        const r = card.getBoundingClientRect();
        const buttons = Array.from(card.querySelectorAll("button")).map((b) => ({
          text: b.textContent ?? "",
          bottom: b.getBoundingClientRect().bottom,
        }));
        return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, buttons };
      }, NOTICE);

      const vw = 900;
      const vh = 700;
      expect(box.top).toBeGreaterThanOrEqual(0);
      expect(box.bottom).toBeLessThanOrEqual(vh);
      expect(box.left).toBeGreaterThanOrEqual(0);
      expect(box.right).toBeLessThanOrEqual(vw);

      // The actions are the point of the panel — they must be on screen too.
      const undo = box.buttons.find((b) => b.text.startsWith("Undo"));
      expect(undo).toBeDefined();
      expect(undo!.bottom).toBeLessThanOrEqual(vh);
    });
  }

  test("stays out of the way when there is nothing to protect", async ({ page }) => {
    await page.evaluate(() => window.pasteInto("#composer", "What is the capital of France?"));

    // Clean text is left to the browser's own native paste, which a synthetic
    // ClipboardEvent cannot perform — so the box stays empty and, crucially,
    // no notice is raised.
    await expect(page.locator(NOTICE)).toHaveCount(0);
  });
});
