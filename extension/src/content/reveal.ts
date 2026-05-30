/**
 * In-page manual reveal (MAIN world).
 *
 * When the user clicks "Reveal" in the popup, swap placeholders like
 * `[EMAIL_a1b2]` back to their real values directly in the visible chat, and
 * swap back to placeholders on "Hide". Reveal is best-effort and reversible: we
 * only ever touch leaf text nodes inside finished message bubbles, wrap each
 * replacement in a marker span carrying the original placeholder, and restore
 * that exact text on hide so the DOM returns to a state React recognises.
 *
 * No innerHTML — createElement/createTextNode/replaceWith only.
 */

const MARKER_ATTR = "data-llmg-reveal";
const PH_ATTR = "data-llmg-ph";
const BANNER_ID = "__llm-guard-toast";

let revealed = false;

/** Build a single regex matching any current placeholder (longest-first). */
function placeholderRegex(map: Record<string, string>): RegExp | null {
  const keys = Object.keys(map);
  if (keys.length === 0) return null;
  keys.sort((a, b) => b.length - a.length);
  const escaped = keys.map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  return new RegExp(escaped.join("|"), "g");
}

/** True if `node` is inside an element we must not touch. */
function isExcluded(node: Node): boolean {
  let el: Node | null = node.parentNode;
  while (el && el.nodeType === Node.ELEMENT_NODE) {
    const e = el as Element;
    const tag = e.tagName;
    if (
      tag === "SCRIPT" ||
      tag === "STYLE" ||
      tag === "TEXTAREA" ||
      tag === "INPUT" ||
      e.id === BANNER_ID ||
      e.hasAttribute(MARKER_ATTR) ||
      e.getAttribute("contenteditable") === "true"
    ) {
      return true;
    }
    el = e.parentNode;
  }
  return false;
}

/** Collect candidate text nodes under `root` that contain a "[" (cheap filter). */
function collectTextNodes(root: Node): Text[] {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node: Node): number {
      const text = node.nodeValue ?? "";
      if (!text.includes("[")) return NodeFilter.FILTER_REJECT;
      if (isExcluded(node)) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  const nodes: Text[] = [];
  let n: Node | null;
  while ((n = walker.nextNode())) nodes.push(n as Text);
  return nodes;
}

function revealRoots(selector: string | null): Element[] {
  if (selector) {
    const found = Array.from(document.querySelectorAll(selector));
    if (found.length > 0) return found;
  }
  return [document.body];
}

/**
 * Reveal: replace placeholders with real values, wrapping each in a marker
 * span. Returns the number of placeholder occurrences replaced.
 */
export function revealInPage(
  map: Record<string, string>,
  conversationSelector: string | null,
): number {
  if (revealed) return 0;
  const re = placeholderRegex(map);
  if (!re) return 0;

  let replaced = 0;
  for (const root of revealRoots(conversationSelector)) {
    const nodes = collectTextNodes(root);
    for (const node of nodes) {
      try {
        const text = node.nodeValue ?? "";
        re.lastIndex = 0;
        if (!re.test(text)) continue;

        const frag = document.createDocumentFragment();
        let last = 0;
        re.lastIndex = 0;
        let m: RegExpExecArray | null;
        while ((m = re.exec(text)) !== null) {
          const placeholder = m[0];
          const value = map[placeholder];
          if (value === undefined) continue;
          if (m.index > last) {
            frag.appendChild(document.createTextNode(text.slice(last, m.index)));
          }
          const span = document.createElement("span");
          span.setAttribute(MARKER_ATTR, "");
          span.setAttribute(PH_ATTR, placeholder);
          span.style.borderBottom = "1px dashed currentColor";
          span.textContent = value;
          frag.appendChild(span);
          last = m.index + placeholder.length;
          replaced++;
        }
        if (last < text.length) {
          frag.appendChild(document.createTextNode(text.slice(last)));
        }
        node.replaceWith(frag);
      } catch {
        /* one bad node must not abort the rest */
      }
    }
  }
  revealed = true;
  return replaced;
}

/** Hide: replace each marker span with a text node of its original placeholder. */
export function hideInPage(): number {
  let restored = 0;
  const markers = Array.from(document.querySelectorAll(`[${MARKER_ATTR}]`));
  for (const span of markers) {
    try {
      const ph = span.getAttribute(PH_ATTR) ?? span.textContent ?? "";
      span.replaceWith(document.createTextNode(ph));
      restored++;
    } catch {
      /* best effort */
    }
  }
  revealed = false;
  return restored;
}

export function isRevealed(): boolean {
  return revealed;
}

/** Reset internal state (used when the placeholder map is cleared/tests). */
export function resetRevealState(): void {
  revealed = false;
}
