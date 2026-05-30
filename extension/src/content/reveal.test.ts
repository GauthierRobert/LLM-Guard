// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { revealInPage, hideInPage, isRevealed, resetRevealState } from "./reveal";

const MAP = { "[EMAIL_a1b2c3]": "john@gmail.com", "[PHONE_d4e5f6]": "0612345678" };

beforeEach(() => {
  document.body.innerHTML = "";
  resetRevealState();
});

describe("revealInPage / hideInPage", () => {
  it("wraps placeholders in marker spans with the real value", () => {
    document.body.innerHTML = `<div id="c">Mail [EMAIL_a1b2c3] now</div>`;
    const n = revealInPage(MAP, "#c");
    expect(n).toBe(1);
    expect(isRevealed()).toBe(true);
    const span = document.querySelector("[data-llmg-reveal]")!;
    expect(span.textContent).toBe("john@gmail.com");
    expect(span.getAttribute("data-llmg-ph")).toBe("[EMAIL_a1b2c3]");
    expect(document.querySelector("#c")!.textContent).toBe("Mail john@gmail.com now");
  });

  it("hide() restores the exact original placeholder text", () => {
    document.body.innerHTML = `<div id="c">Mail [EMAIL_a1b2c3] now</div>`;
    revealInPage(MAP, "#c");
    const restored = hideInPage();
    expect(restored).toBe(1);
    expect(isRevealed()).toBe(false);
    expect(document.querySelector("[data-llmg-reveal]")).toBeNull();
    expect(document.querySelector("#c")!.textContent).toBe("Mail [EMAIL_a1b2c3] now");
  });

  it("does not touch textarea / contenteditable / script content", () => {
    document.body.innerHTML = `
      <textarea>[EMAIL_a1b2c3]</textarea>
      <div contenteditable="true">[EMAIL_a1b2c3]</div>
      <script>var x = "[EMAIL_a1b2c3]";</script>
      <div id="c">[EMAIL_a1b2c3]</div>`;
    const n = revealInPage(MAP, "body");
    expect(n).toBe(1); // only the plain div
    expect((document.querySelector("textarea") as HTMLTextAreaElement).value).toContain("[EMAIL_a1b2c3]");
  });

  it("does not touch the extension banner", () => {
    document.body.innerHTML = `<div id="__llm-guard-toast">[EMAIL_a1b2c3]</div><div id="c">[EMAIL_a1b2c3]</div>`;
    const n = revealInPage(MAP, "body");
    expect(n).toBe(1);
  });

  it("is idempotent — calling reveal twice does not double-wrap", () => {
    document.body.innerHTML = `<div id="c">[EMAIL_a1b2c3]</div>`;
    revealInPage(MAP, "#c");
    const second = revealInPage(MAP, "#c");
    expect(second).toBe(0);
    expect(document.querySelectorAll("[data-llmg-reveal]")).toHaveLength(1);
  });

  it("replaces multiple distinct placeholders in one node", () => {
    document.body.innerHTML = `<div id="c">[EMAIL_a1b2c3] / [PHONE_d4e5f6]</div>`;
    const n = revealInPage(MAP, "#c");
    expect(n).toBe(2);
    expect(document.querySelector("#c")!.textContent).toBe("john@gmail.com / 0612345678");
  });

  it("returns 0 when the map is empty", () => {
    document.body.innerHTML = `<div id="c">[EMAIL_a1b2c3]</div>`;
    expect(revealInPage({}, "#c")).toBe(0);
  });
});
