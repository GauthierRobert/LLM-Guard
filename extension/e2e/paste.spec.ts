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
const BADGE = "#__avopseudo-paste-badge";
const TEXTAREA = "#composer";
const RICH = "#rich";

/** Read the notice panel's text out of its shadow root. */
async function noticeText(page: import("@playwright/test").Page): Promise<string> {
  return page.evaluate((sel) => {
    const host = document.querySelector(sel);
    return host?.shadowRoot?.textContent ?? "";
  }, NOTICE);
}

/**
 * The badge is a plain container holding two real buttons — a nested button
 * would be invalid and unreachable by keyboard — so they are told apart by the
 * accessible name a screen-reader user would hear.
 */
const BADGE_DISMISS = "button[aria-label='Dismiss']";
const BADGE_REVIEW = "button:not([aria-label='Dismiss'])";

/** Click one of the badge's buttons inside its shadow root. */
async function clickInBadge(
  page: import("@playwright/test").Page,
  selector: string,
): Promise<void> {
  await page.locator(BADGE).waitFor({ state: "attached" });
  await page.evaluate(
    ({ host, button }) => {
      const el = document.querySelector(host)?.shadowRoot?.querySelector(button);
      (el as HTMLButtonElement | null)?.click();
    },
    { host: BADGE, button: selector },
  );
}

/**
 * A pseudonymised paste shows a compact review badge, not the full panel —
 * click it to open the full panel, the way a user would.
 */
async function openReviewBadge(page: import("@playwright/test").Page): Promise<void> {
  await clickInBadge(page, BADGE_REVIEW);
}

/**
 * Where the badge sits relative to the box it hangs from. The host itself is a
 * zero-height strip across that box's top edge — the visible pill hangs off it
 * inside the shadow root, so that is what we measure.
 */
async function badgeOffsets(
  page: import("@playwright/test").Page,
): Promise<{ gap: number; right: number }> {
  return page.evaluate((badge) => {
    const host = document.querySelector(badge)!;
    const b = host.shadowRoot!.firstElementChild!.getBoundingClientRect();
    const c = host.parentElement!.getBoundingClientRect();
    return { gap: Math.round(c.top - b.bottom), right: Math.round(c.right - b.right) };
  }, BADGE);
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

  test("shows a review badge, not the full panel, right after a pseudonymised paste", async ({
    page,
  }) => {
    await page.evaluate(() =>
      window.pasteInto("#composer", "Contact me at alice@personal.com please."),
    );

    await expect(page.locator(BADGE)).toHaveCount(1);
    await expect(page.locator(NOTICE)).toHaveCount(0);
  });

  test("says who did it, in words, and lists the substitution", async ({ page }) => {
    await page.evaluate(() =>
      window.pasteInto("#composer", "Contact me at alice@personal.com please."),
    );
    await openReviewBadge(page);

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
    await openReviewBadge(page);
    await expect(page.locator(NOTICE)).toHaveCount(1);

    await page.evaluate((sel) => {
      const host = document.querySelector(sel);
      const buttons = Array.from(host?.shadowRoot?.querySelectorAll("button") ?? []);
      buttons.find((b) => b.textContent?.startsWith("Undo"))?.click();
    }, NOTICE);

    const text = await page.evaluate((s) => window.composerText(s), TEXTAREA);
    expect(text).toBe("Contact me at alice@personal.com please.");
    // Nothing pseudonymised is left in the box, so no review badge either.
    await expect(page.locator(BADGE)).toHaveCount(0);
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
      await openReviewBadge(page);
      await expect(page.locator(NOTICE)).toHaveCount(1);

      const box = await page.evaluate((sel) => {
        // shadow root → the positioning box → the card itself.
        const card = document.querySelector(sel)!.shadowRoot!.firstElementChild!
          .firstElementChild!;
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

  test("dismissing the review badge's × removes it without opening the panel", async ({
    page,
  }) => {
    await page.evaluate(() =>
      window.pasteInto("#composer", "Contact me at alice@personal.com please."),
    );
    await expect(page.locator(BADGE)).toHaveCount(1);

    await clickInBadge(page, BADGE_DISMISS);

    await expect(page.locator(BADGE)).toHaveCount(0);
    await expect(page.locator(NOTICE)).toHaveCount(0);
  });

  test("the badge's controls are two real, keyboard-reachable buttons", async ({ page }) => {
    await page.evaluate(() =>
      window.pasteInto("#composer", "Contact me at alice@personal.com please."),
    );
    await expect(page.locator(BADGE)).toHaveCount(1);

    const shape = await page.evaluate((sel) => {
      const root = document.querySelector(sel)!.shadowRoot!;
      const buttons = Array.from(root.querySelectorAll("button"));
      return {
        count: buttons.length,
        // A <button> inside a <button> is invalid and gets flattened by
        // assistive tech, which is what left the × unreachable.
        nested: buttons.some((b) => b.querySelector("button, [role='button']") !== null),
        names: buttons.map((b) => b.getAttribute("aria-label")),
      };
    }, BADGE);

    expect(shape.count).toBe(2);
    expect(shape.nested).toBe(false);
    expect(shape.names[1]).toBe("Dismiss");
    expect(shape.names[0]).toContain("Review what AvoPseudo replaced");
  });

  test("the badge rides with the composer through a scroll and a resize", async ({ page }) => {
    // The badge used to be a fixed-position box measured against the composer
    // and re-measured on every scroll. Because it took whichever side of the
    // box had more room, that comparison flipped mid-scroll and the badge
    // teleported from above the composer to below it — one badge reading as
    // two, top and bottom. It now hangs inside the composer's own container,
    // so the browser keeps the two together and nothing runs on scroll.
    await page.setViewportSize({ width: 900, height: 600 });
    await page.evaluate(() => {
      const filler = document.createElement("div");
      filler.style.height = "3000px";
      document.body.appendChild(filler);
    });

    await page.evaluate(() =>
      window.pasteInto("#composer", "Contact me at alice@personal.com please."),
    );
    await expect(page.locator(BADGE)).toHaveCount(1);

    // Mounted in the composer's wrapper, not on <body>.
    const mountedWithComposer = await page.evaluate(
      ({ badge, composer }) =>
        document.querySelector(badge)!.parentElement!.contains(document.querySelector(composer)),
      { badge: BADGE, composer: TEXTAREA },
    );
    expect(mountedWithComposer).toBe(true);

    const before = await badgeOffsets(page);
    expect(before.gap).toBe(10); // just above the box…
    expect(before.right).toBe(0); // …sharing its right edge

    const composerBottom = async (): Promise<number> =>
      page.evaluate(
        (s) => Math.round(document.querySelector(s)!.getBoundingClientRect().bottom),
        TEXTAREA,
      );
    const bottomBefore = await composerBottom();

    // Both things that used to move it: the page scrolling behind the composer,
    // and the composer growing as the user types.
    await page.evaluate(() => window.scrollTo(0, 1200));
    await page.evaluate((s) => {
      (document.querySelector(s) as HTMLTextAreaElement).rows = 10;
    }, TEXTAREA);
    await expect.poll(() => composerBottom()).not.toBe(bottomBefore);

    await expect.poll(() => badgeOffsets(page)).toEqual(before);
  });

  test("a paste that overflows a ChatGPT-shaped composer still shows the badge", async ({
    page,
  }) => {
    // The regression that hid the card completely. ChatGPT's editor lives in a
    // max-height scroller: once a paste overflows it, the editor element's own
    // box extends past its frame and getBoundingClientRect().top becomes
    // `frame.top - scrollTop` — hundreds of pixels above the visible composer,
    // and off the top of the screen entirely for a long paste. Anchoring to
    // that element put the badge there with it.
    await page.setViewportSize({ width: 900, height: 700 });
    await page.evaluate(() => {
      const shell = document.querySelector("#gpt-shell") as HTMLElement;
      Object.assign(shell.style, { position: "fixed", left: "60px", bottom: "40px" });
    });

    const long = Array.from(
      { length: 40 },
      (_, i) => `Ligne ${i}: Sophie Lemaire, sophie.lemaire@lemaire-avocats.be`,
    ).join("\n");
    await page.evaluate((text) => window.pasteInto("#gptish", text), long);

    await expect(page.locator(BADGE)).toHaveCount(1);

    const geometry = await page.evaluate(
      ({ badge }) => {
        // A real editor scrolls the caret into view after inserting, which is
        // the state the user was in: composer scrolled, its own box hanging
        // well above the frame.
        const scroller = document.querySelector("#gptish")!.parentElement!;
        scroller.scrollTop = scroller.scrollHeight;

        const host = document.querySelector(badge)!;
        const pill = host.shadowRoot!.firstElementChild!.getBoundingClientRect();
        const editor = document.querySelector("#gptish")!.getBoundingClientRect();
        const shell = document.querySelector("#gpt-shell")!.getBoundingClientRect();
        return {
          scrollTop: Math.round(scroller.scrollTop),
          editorTop: Math.round(editor.top),
          shellTop: Math.round(shell.top),
          gapToShell: Math.round(shell.top - pill.bottom),
          onScreen: pill.top >= 0 && pill.bottom <= 700 && pill.left >= 0 && pill.right <= 900,
        };
      },
      { badge: BADGE },
    );

    // The editor really did overflow and slide up out of its frame...
    expect(geometry.scrollTop).toBeGreaterThan(200);
    expect(geometry.editorTop).toBeLessThan(geometry.shellTop - 200);
    // ...but the badge tracks the visible shell, so it stays put and on screen.
    expect(geometry.gapToShell).toBe(10);
    expect(geometry.onScreen).toBe(true);
  });

  test("the badge goes away once the pseudonymised text leaves the box", async ({ page }) => {
    await page.evaluate(() =>
      window.pasteInto("#composer", "Contact me at alice@personal.com please."),
    );
    await expect(page.locator(BADGE)).toHaveCount(1);

    // Sending a message clears the composer from the site's own code, which
    // need not fire an `input` event — the badge has to notice by itself.
    await page.evaluate((s) => {
      (document.querySelector(s) as HTMLTextAreaElement).value = "";
    }, TEXTAREA);

    await expect(page.locator(BADGE)).toHaveCount(0);
  });

  test("says so instead of silently swallowing a paste the box refuses", async ({ page }) => {
    // Force both write strategies in `insertText` to fail: execCommand refuses
    // and there is no selection to splice into. The content script shares this
    // MAIN world, so the stubs apply to it too.
    await page.evaluate(() => {
      document.execCommand = () => false;
      window.getSelection = () => null;
    });

    await page.evaluate(() =>
      window.pasteInto("#rich", "Contact me at alice@personal.com please."),
    );

    // Nothing landed — the guard had already called preventDefault()...
    expect(await page.evaluate((s) => window.composerText(s), RICH)).toBe("");
    // ...so the user must be told, rather than left watching a paste vanish.
    await expect(page.locator(NOTICE)).toHaveCount(1);
    await expect(page.locator(BADGE)).toHaveCount(0);

    const text = await noticeText(page);
    expect(text).toContain("AvoPseudo");
    expect(text).toContain("Nothing was pasted");
    expect(text).toContain("still on your clipboard");
    // It must not claim a substitution the user cannot see, nor leak the value
    // it was protecting.
    expect(text).not.toContain("now in the box");
    expect(text).not.toContain("alice@personal.com");
  });

  test("a pseudonymised paste replaces an open panel instead of stacking under it", async ({
    page,
  }) => {
    // A warn shows the full panel, which then sits there for its 18s.
    await page.evaluate(() =>
      window.pasteInto("#composer", "Le dossier medical du dossier RH est joint."),
    );
    await expect(page.locator(NOTICE)).toHaveCount(1);

    await page.evaluate(() =>
      window.pasteInto("#composer", " Contact me at alice@personal.com please."),
    );

    await expect(page.locator(BADGE)).toHaveCount(1);
    // The stale panel described the *previous* paste; it must not survive.
    await expect(page.locator(NOTICE)).toHaveCount(0);
  });

  test("closing the full panel returns to the review badge, not to nothing", async ({ page }) => {
    await page.evaluate(() =>
      window.pasteInto("#composer", "Contact me at alice@personal.com please."),
    );
    await openReviewBadge(page);
    await expect(page.locator(NOTICE)).toHaveCount(1);
    await expect(page.locator(BADGE)).toHaveCount(0);

    await page.evaluate((sel) => {
      const host = document.querySelector(sel);
      const buttons = Array.from(host?.shadowRoot?.querySelectorAll("button") ?? []);
      buttons.find((b) => b.textContent === "Got it")?.click();
    }, NOTICE);

    await expect(page.locator(NOTICE)).toHaveCount(0);
    await expect(page.locator(BADGE)).toHaveCount(1);

    // And the badge still opens the same review, with the placeholder still
    // sitting in the composer untouched.
    await openReviewBadge(page);
    await expect(page.locator(NOTICE)).toHaveCount(1);
    const text = await page.evaluate((s) => window.composerText(s), TEXTAREA);
    expect(text).toContain("[EMAIL_");
  });
});
