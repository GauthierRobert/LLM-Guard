// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import {
  findComposer,
  insertText,
  isTextField,
  readComposerText,
  replaceInComposer,
  setComposerText,
} from "./composer";

beforeEach(() => {
  document.body.replaceChildren();
});

/**
 * jsdom does not implement `isContentEditable`, so rich-editor fixtures declare
 * it themselves. (jsdom also has no `execCommand`, which conveniently exercises
 * the Range-based fallback insertion.)
 */
function contentEditable(html: string): HTMLElement {
  const el = document.createElement("div");
  el.setAttribute("contenteditable", "true");
  Object.defineProperty(el, "isContentEditable", { value: true, configurable: true });
  el.textContent = html;
  document.body.appendChild(el);
  return el;
}

function textarea(value = ""): HTMLTextAreaElement {
  const el = document.createElement("textarea");
  el.value = value;
  document.body.appendChild(el);
  return el;
}

describe("isTextField", () => {
  it("accepts textareas and free-text inputs, rejects the rest", () => {
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    const search = document.createElement("input");
    search.type = "search";
    expect(isTextField(textarea())).toBe(true);
    expect(isTextField(search)).toBe(true);
    expect(isTextField(checkbox)).toBe(false);
    expect(isTextField(document.createElement("div"))).toBe(false);
    expect(isTextField(null)).toBe(false);
  });
});

describe("findComposer", () => {
  it("finds the textarea a paste is aimed at", () => {
    const el = textarea();
    expect(findComposer(el)).toBe(el);
  });

  it("climbs to the outermost contenteditable host", () => {
    const host = contentEditable("");
    const inner = document.createElement("p");
    Object.defineProperty(inner, "isContentEditable", { value: true, configurable: true });
    inner.textContent = "hello";
    host.appendChild(inner);
    expect(findComposer(inner)).toBe(host);
    expect(findComposer(inner.firstChild)).toBe(host);
  });

  it("returns null for a paste outside any editable field", () => {
    const div = document.createElement("div");
    document.body.appendChild(div);
    expect(findComposer(div)).toBeNull();
  });
});

describe("readComposerText", () => {
  it("reads a text field value and a rich editor's text", () => {
    expect(readComposerText(textarea("hello"))).toBe("hello");
    expect(readComposerText(contentEditable("hi there"))).toBe("hi there");
  });
});

describe("insertText — text field", () => {
  it("inserts at the caret and moves it past the insertion", () => {
    const el = textarea("ab");
    el.setSelectionRange(1, 1);
    expect(insertText(el, "XY")).toBe(true);
    expect(el.value).toBe("aXYb");
    expect(el.selectionStart).toBe(3);
  });

  it("replaces the current selection", () => {
    const el = textarea("keep DROP keep");
    el.setSelectionRange(5, 9);
    insertText(el, "[X]");
    expect(el.value).toBe("keep [X] keep");
  });

  it("fires a bubbling input event so React-controlled fields stay in sync", () => {
    const el = textarea("");
    let seen = 0;
    document.body.addEventListener("input", () => seen++);
    insertText(el, "hi");
    expect(seen).toBe(1);
  });
});

describe("insertText — rich editor (Range fallback)", () => {
  it("writes the text into the editor", () => {
    const el = contentEditable("");
    expect(insertText(el, "pseudonymised")).toBe(true);
    expect(el.textContent).toContain("pseudonymised");
  });

  it("keeps multi-line pastes on separate lines", () => {
    const el = contentEditable("");
    insertText(el, "one\ntwo");
    expect(el.querySelectorAll("br")).toHaveLength(1);
    expect(el.textContent).toBe("onetwo");
  });
});

describe("setComposerText / replaceInComposer", () => {
  it("replaces the whole text-field content", () => {
    const el = textarea("old text");
    expect(setComposerText(el, "new text")).toBe(true);
    expect(el.value).toBe("new text");
  });

  it("swaps the pseudonymised text back for the original (undo)", () => {
    const el = textarea("hi [EMAIL_a1b2c3] bye");
    expect(replaceInComposer(el, "[EMAIL_a1b2c3]", "john@acme.com")).toBe(true);
    expect(el.value).toBe("hi john@acme.com bye");
  });

  it("reports failure when the text to replace is gone", () => {
    const el = textarea("the user retyped everything");
    expect(replaceInComposer(el, "[EMAIL_a1b2c3]", "john@acme.com")).toBe(false);
    expect(el.value).toBe("the user retyped everything");
  });

  it("still finds the text when the editor renormalised the whitespace", () => {
    // ProseMirror & co. read a single "\n" back as a paragraph break.
    const el = textarea("line one\n\nline [EMAIL_a1b2c3] two");
    expect(replaceInComposer(el, "line one\nline [EMAIL_a1b2c3] two", "restored")).toBe(true);
    expect(el.value).toBe("restored");
  });

  it("undoes inside a rich editor too", () => {
    const el = contentEditable("hi [EMAIL_a1b2c3] bye");
    expect(replaceInComposer(el, "[EMAIL_a1b2c3]", "john@acme.com")).toBe(true);
    expect(el.textContent).toBe("hi john@acme.com bye");
  });
});
