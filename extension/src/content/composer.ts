/**
 * Composer helpers (MAIN world).
 *
 * v5 works on the *input box* of the LLM web app instead of the outgoing
 * request, so it needs to read from and write into whatever the site uses as a
 * composer. Two shapes cover every supported service:
 *
 *   - a plain `<textarea>` / `<input>`   (Copilot, DeepSeek, Grok…)
 *   - a `contenteditable` rich editor    (ChatGPT, Claude, Gemini — ProseMirror,
 *                                         Lexical, Quill…)
 *
 * Rich editors keep their own model of the document, so we never rewrite their
 * DOM by hand: we write through `execCommand("insertText")`, which those editors
 * observe exactly like a real keystroke. Text fields are written with the native
 * value setter plus an `input` event, the standard way to keep a
 * React-controlled field in sync.
 *
 * Everything here is best-effort and defensive — the host page must never break.
 */

/** `<input>` types that hold free text a user could paste a prompt into. */
const TEXT_INPUT_TYPES = new Set(["text", "search", "url", "email", "tel", ""]);

/** Anything we can read a prompt from and write one back into. */
export type Composer = HTMLTextAreaElement | HTMLInputElement | HTMLElement;

export function isTextField(el: Element | null): el is HTMLTextAreaElement | HTMLInputElement {
  if (!el) return false;
  if (el instanceof HTMLTextAreaElement) return true;
  if (el instanceof HTMLInputElement) return TEXT_INPUT_TYPES.has(el.type.toLowerCase());
  return false;
}

/** True for an element that is (or lives inside) a rich-text editor. */
function isEditableHost(el: Element | null): el is HTMLElement {
  return el instanceof HTMLElement && el.isContentEditable;
}

/**
 * Resolve the composer a paste is landing in, walking up from the event target
 * and falling back to the focused element. Returns null when the paste is not
 * going into an editable field (a page-level paste we must not touch).
 */
export function findComposer(target: EventTarget | null): Composer | null {
  const candidates: Array<EventTarget | null> = [target, document.activeElement];
  for (const candidate of candidates) {
    let node: Node | null = candidate instanceof Node ? candidate : null;
    // Text nodes inside a contenteditable: start from the parent element.
    if (node && node.nodeType !== Node.ELEMENT_NODE) node = node.parentElement;
    while (node instanceof Element) {
      if (isTextField(node)) return node;
      if (isEditableHost(node)) {
        // Climb to the outermost contenteditable host (ProseMirror roots).
        let host: HTMLElement = node;
        let parent = host.parentElement;
        while (parent && parent.isContentEditable) {
          host = parent;
          parent = host.parentElement;
        }
        return host;
      }
      node = node.parentElement;
    }
  }
  return null;
}

/** Current text of the composer (plain text, newlines preserved). */
export function readComposerText(el: Composer): string {
  if (isTextField(el)) return el.value;
  // innerText respects line breaks; jsdom has no innerText → textContent.
  return (el as HTMLElement).innerText ?? el.textContent ?? "";
}

/* ------------------------------- writing --------------------------------- */

/**
 * Set a text field's value through the prototype setter so React's value
 * tracker sees the change and the following `input` event is not swallowed.
 */
function setNativeValue(el: HTMLTextAreaElement | HTMLInputElement, value: string): void {
  const proto =
    el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
  if (setter) setter.call(el, value);
  else el.value = value;
}

function dispatchInput(el: Element, data: string | null, inputType: string): void {
  try {
    el.dispatchEvent(
      new InputEvent("input", { bubbles: true, cancelable: false, data, inputType }),
    );
  } catch {
    // Limited environments (jsdom): a plain Event still reaches React.
    el.dispatchEvent(new Event("input", { bubbles: true }));
  }
}

/**
 * Fallback insertion for contenteditable when execCommand is unavailable or
 * refuses: splice the text into the current range by hand. Newlines become
 * `<br>` so multi-line pastes keep their shape.
 */
function insertViaRange(el: HTMLElement, text: string): boolean {
  const selection = window.getSelection?.();
  if (!selection) return false;

  let range: Range;
  if (selection.rangeCount > 0 && el.contains(selection.getRangeAt(0).commonAncestorContainer)) {
    range = selection.getRangeAt(0);
  } else {
    range = document.createRange();
    range.selectNodeContents(el);
    range.collapse(false);
  }
  range.deleteContents();

  const fragment = document.createDocumentFragment();
  const lines = text.split("\n");
  lines.forEach((line, i) => {
    if (i > 0) fragment.appendChild(document.createElement("br"));
    if (line) fragment.appendChild(document.createTextNode(line));
  });
  const last = fragment.lastChild;
  range.insertNode(fragment);

  if (last) {
    const after = document.createRange();
    after.setStartAfter(last);
    after.collapse(true);
    selection.removeAllRanges();
    selection.addRange(after);
  }
  return true;
}

/**
 * Insert `text` at the caret, replacing the selection. Returns false only when
 * nothing could be written at all.
 */
export function insertText(el: Composer, text: string): boolean {
  try {
    if (isTextField(el)) {
      const start = el.selectionStart ?? el.value.length;
      const end = el.selectionEnd ?? start;
      const next = el.value.slice(0, start) + text + el.value.slice(end);
      setNativeValue(el, next);
      const caret = start + text.length;
      try {
        el.setSelectionRange(caret, caret);
      } catch {
        /* input types that forbid selection ranges */
      }
      dispatchInput(el, text, "insertFromPaste");
      return true;
    }

    const host = el as HTMLElement;
    host.focus();
    let ok = false;
    try {
      // Rich-text editors observe this exactly like a typed insertion and fire
      // their own beforeinput/input, so we must not dispatch one afterwards.
      ok = document.execCommand("insertText", false, text);
    } catch {
      ok = false;
    }
    if (ok) return true;

    if (!insertViaRange(host, text)) return false;
    dispatchInput(host, text, "insertFromPaste");
    return true;
  } catch {
    return false;
  }
}

/** Replace the whole composer content with `text`. */
export function setComposerText(el: Composer, text: string): boolean {
  try {
    if (isTextField(el)) {
      setNativeValue(el, text);
      try {
        el.setSelectionRange(text.length, text.length);
      } catch {
        /* ignore */
      }
      dispatchInput(el, text, "insertReplacementText");
      return true;
    }
    const host = el as HTMLElement;
    host.focus();
    const selection = window.getSelection?.();
    if (selection) {
      const all = document.createRange();
      all.selectNodeContents(host);
      selection.removeAllRanges();
      selection.addRange(all);
    }
    return insertText(host, text);
  } catch {
    return false;
  }
}

/**
 * Locate `needle` in `haystack`, tolerating a different amount of whitespace.
 * A rich editor re-reads as its own idea of the text — a single "\n" we wrote
 * often comes back as a paragraph break — so an exact match would miss text we
 * demonstrably just inserted.
 */
function findLoose(haystack: string, needle: string): { start: number; end: number } | null {
  const exact = haystack.indexOf(needle);
  if (exact !== -1) return { start: exact, end: exact + needle.length };
  if (!/\s/.test(needle)) return null;

  const pattern = needle
    .split(/\s+/)
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("\\s+");
  const match = new RegExp(pattern).exec(haystack);
  return match ? { start: match.index, end: match.index + match[0].length } : null;
}

/**
 * Swap the first occurrence of `from` for `to` inside the composer — used by
 * the notice's "paste my original instead" action. Text fields are edited
 * surgically; rich editors are rewritten wholesale (their content is rebuilt
 * from the plain text), which is acceptable for an explicit user action.
 */
export function replaceInComposer(el: Composer, from: string, to: string): boolean {
  try {
    const current = readComposerText(el);
    const at = findLoose(current, from);
    if (!at) return false;
    const next = current.slice(0, at.start) + to + current.slice(at.end);
    return setComposerText(el, next);
  } catch {
    return false;
  }
}

/* ------------------------------ selection -------------------------------- */

export interface SelectionSnapshot {
  field?: { start: number; end: number };
  range?: Range;
}

/**
 * Remember where the caret is, so an async detection pass (NER) can hand focus
 * back exactly where the user left it before we insert.
 */
export function snapshotSelection(el: Composer): SelectionSnapshot | null {
  try {
    if (isTextField(el)) {
      return { field: { start: el.selectionStart ?? 0, end: el.selectionEnd ?? 0 } };
    }
    const selection = window.getSelection?.();
    if (selection && selection.rangeCount > 0) {
      return { range: selection.getRangeAt(0).cloneRange() };
    }
    return {};
  } catch {
    return null;
  }
}

export function restoreSelection(el: Composer, snapshot: SelectionSnapshot | null): void {
  try {
    el.focus();
    if (!snapshot) return;
    if (isTextField(el) && snapshot.field) {
      el.setSelectionRange(snapshot.field.start, snapshot.field.end);
      return;
    }
    if (snapshot.range) {
      const selection = window.getSelection?.();
      if (!selection) return;
      selection.removeAllRanges();
      selection.addRange(snapshot.range);
    }
  } catch {
    /* focus/selection is best-effort */
  }
}
