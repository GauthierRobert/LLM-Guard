/**
 * The v5 paste notice — the in-page panel that tells the user, unambiguously,
 * that *AvoPseudo* just rewrote what they pasted.
 *
 * Two design constraints drive everything here:
 *
 *  1. It must never be mistaken for the website's own UI or for something the
 *     AI said. So it is branded, sits outside the conversation flow, carries an
 *     explicit "this comes from your AvoPseudo extension, not from this site or
 *     the AI" line, and spells out that the `[LABEL_xxxx]` tags now in the box
 *     were written by the extension.
 *  2. It must survive any host page. So it lives in a **shadow root** (page CSS
 *     cannot reach in) and every style is applied through the CSSOM
 *     (`el.style.x = …`), which no page Content-Security-Policy can block — no
 *     `<style>` element, no inline style attribute, no innerHTML, ever.
 */

import type { PasteOutcome, PasteReplacement } from "@/content/paste-plan";

const HOST_ID = "__avopseudo-paste-notice";
const PENDING_ID = "__avopseudo-paste-pending";
const PULSE_ID = "__avopseudo-composer-pulse";

const AUTO_DISMISS_MS = 18_000;

interface Palette {
  dark: boolean;
  surface: string;
  surfaceAlt: string;
  border: string;
  text: string;
  muted: string;
  chipBg: string;
  shadow: string;
}

const LIGHT: Palette = {
  dark: false,
  surface: "#ffffff",
  surfaceAlt: "#f6faf9",
  border: "#dfe7e5",
  text: "#0f172a",
  muted: "#64748b",
  chipBg: "#e2f5f0",
  shadow: "0 12px 32px rgba(12, 52, 43, 0.18)",
};

const DARK: Palette = {
  dark: true,
  surface: "#111c1a",
  surfaceAlt: "#172724",
  border: "#2e4440",
  text: "#f1f5f9",
  muted: "#94a3b8",
  chipBg: "#12332c",
  shadow: "0 12px 32px rgba(0, 0, 0, 0.55)",
};

/**
 * Brand teal-green, taken from the AvoPseudo logo (#0E9E85 mid, #14B89C light,
 * #0C342B deep). Warn/block keep their conventional amber and red — those carry
 * meaning the brand colour must not override — brightened for dark surfaces.
 */
const ACCENT: Record<PasteOutcome, { light: string; dark: string }> = {
  clean: { light: "#0e9e85", dark: "#14b89c" },
  pseudonymised: { light: "#0e9e85", dark: "#14b89c" },
  warned: { light: "#d97706", dark: "#f59e0b" },
  blocked: { light: "#dc2626", dark: "#ef4444" },
};

function accentFor(outcome: PasteOutcome, p: Palette): string {
  const pair = ACCENT[outcome] ?? ACCENT.pseudonymised;
  return p.dark ? pair.dark : pair.light;
}

const TITLE: Record<PasteOutcome, string> = {
  clean: "Paste checked",
  pseudonymised: "Pasted text pseudonymised",
  warned: "Sensitive data in what you pasted",
  blocked: "Paste blocked",
};

function palette(): Palette {
  try {
    return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? DARK : LIGHT;
  } catch {
    return LIGHT;
  }
}

/* ------------------------------ tiny helpers ------------------------------ */

type Styles = Partial<Record<keyof CSSStyleDeclaration, string>>;

function make<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  styles: Styles,
  text?: string,
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  Object.assign(el.style, styles);
  if (text !== undefined) el.textContent = text;
  return el;
}

/**
 * The AvoPseudo mark — the hourglass inside the shield, from `assets/icon.svg`
 * scaled to a 24-unit box. Drawn inline so the panel is recognisable at a
 * glance without loading an extension resource the page's CSP could block.
 */
function shield(color: string, size: number): SVGSVGElement {
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", String(size));
  svg.setAttribute("height", String(size));
  svg.setAttribute("aria-hidden", "true");

  const body = document.createElementNS(ns, "path");
  body.setAttribute("fill", color);
  body.setAttribute("d", "M12 2 4 5v6c0 5 3.4 9.4 8 11 4.6-1.6 8-6 8-11V5l-8-3Z");
  svg.appendChild(body);

  // Hourglass: two bars, two triangles meeting at a neck.
  const glass = document.createElementNS(ns, "path");
  glass.setAttribute("fill", "#fff");
  glass.setAttribute(
    "d",
    // top bar / bottom bar
    "M8.3 6.3h7.4a.7.7 0 0 1 0 1.4H8.3a.7.7 0 0 1 0-1.4Z" +
      "M8.3 14.8h7.4a.7.7 0 0 1 0 1.4H8.3a.7.7 0 0 1 0-1.4Z" +
      // upper funnel, lower funnel and the neck between them
      "M8.7 8.5h6.6L12 11.4Z" +
      "M8.7 14.2h6.6L12 11.4Z" +
      "M11.5 10.9h1v1.6h-1Z",
  );
  svg.appendChild(glass);
  return svg;
}

/** Partially hide a value so the panel does not itself put PII back on screen. */
function mask(value: string): string {
  const v = value.trim();
  if (v.length <= 4) return "••••";
  const head = v.slice(0, 2);
  const tail = v.slice(-1);
  return `${head}${"•".repeat(Math.min(8, v.length - 3))}${tail}`;
}

function removeById(id: string): void {
  document.getElementById(id)?.remove();
}

function mountRoot(): HTMLElement | null {
  return document.body ?? document.documentElement ?? null;
}

/** A fixed-position shadow host, isolated from the page's CSS. */
function createHost(id: string): { host: HTMLElement; shadow: ShadowRoot } | null {
  const root = mountRoot();
  if (!root) return null;
  removeById(id);
  const host = make("div", {
    position: "fixed",
    zIndex: "2147483647",
    // The host itself is a transparent, non-interactive layer; the card inside
    // re-enables pointer events for itself.
    pointerEvents: "none",
    inset: "auto",
  });
  host.id = id;
  const shadow = host.attachShadow({ mode: "open" });
  root.appendChild(host);
  return { host, shadow };
}

const MARGIN = 16;
/** Gap between the panel and the composer it is anchored to. */
const GAP = 12;

/**
 * Park the panel next to the composer it belongs to, so the connection is
 * obvious — above it when there is room, below it otherwise.
 *
 * A chat composer is not always at the bottom of the screen: ChatGPT centres it
 * vertically until the first message is sent, which leaves only half a viewport
 * above. So we measure both sides, take the roomier one, and fall back to the
 * viewport corner (where the full height is available) when neither side can
 * show a useful amount of the panel.
 *
 * Returns the height the caller may actually use, so the panel can cap itself
 * and scroll internally instead of running off the screen.
 */
function place(
  host: HTMLElement,
  anchor: Element | null | undefined,
  width: number,
  comfortable: number,
): number {
  const viewportHeight = window.innerHeight;
  const corner = (): number => {
    host.style.right = `${MARGIN}px`;
    host.style.bottom = `${MARGIN}px`;
    return viewportHeight - MARGIN * 2;
  };

  let rect: DOMRect | null = null;
  try {
    rect = anchor?.getBoundingClientRect() ?? null;
  } catch {
    rect = null;
  }
  if (!rect || rect.width === 0 || rect.bottom < 0 || rect.top > viewportHeight) return corner();

  const spaceAbove = rect.top - GAP - MARGIN;
  const spaceBelow = viewportHeight - rect.bottom - GAP - MARGIN;
  if (Math.max(spaceAbove, spaceBelow) < comfortable) return corner();

  // Right-align on the composer, clamped so the panel stays fully on screen.
  const right = Math.max(MARGIN, window.innerWidth - rect.right);
  host.style.right = `${Math.min(right, Math.max(MARGIN, window.innerWidth - width - MARGIN))}px`;

  if (spaceAbove >= spaceBelow) {
    host.style.bottom = `${viewportHeight - rect.top + GAP}px`;
    return spaceAbove;
  }
  host.style.top = `${rect.bottom + GAP}px`;
  return spaceBelow;
}

/* -------------------------------- the panel ------------------------------- */

export interface PasteNoticeOptions {
  outcome: PasteOutcome;
  /** Values that were replaced (pseudonymised outcome). */
  replacements: PasteReplacement[];
  /** Rule names behind a warn/block decision. */
  ruleIds: string[];
  /** Composer the paste landed in — used to position the panel. */
  anchor?: Element | null;
  /** When given, an "undo" button is shown that puts the original text back. */
  onUndo?: () => void;
}

let dismissTimer: ReturnType<typeof setTimeout> | null = null;
let escHandler: ((e: KeyboardEvent) => void) | null = null;

export function hidePasteNotice(): void {
  if (dismissTimer !== null) {
    clearTimeout(dismissTimer);
    dismissTimer = null;
  }
  if (escHandler) {
    window.removeEventListener("keydown", escHandler, true);
    escHandler = null;
  }
  removeById(HOST_ID);
}

/** Give a button a hover/press feel without any stylesheet. */
function wireButtonFeel(btn: HTMLButtonElement, base: string, hover: string): void {
  btn.addEventListener("mouseenter", () => {
    btn.style.background = hover;
  });
  btn.addEventListener("mouseleave", () => {
    btn.style.background = base;
  });
}

export function showPasteNotice(opts: PasteNoticeOptions): void {
  try {
    hidePastePending();
    hidePasteNotice();

    const p = palette();
    const accent = accentFor(opts.outcome, p);
    const width = 348;

    const mounted = createHost(HOST_ID);
    if (!mounted) return;
    const { host, shadow } = mounted;
    // Below this the panel is not worth squeezing next to the composer; place()
    // then puts it in the viewport corner, where it gets the full height.
    const available = place(host, opts.anchor, width, 380);

    const card = make("div", {
      pointerEvents: "auto",
      boxSizing: "border-box",
      width: `${width}px`,
      maxWidth: "calc(100vw - 32px)",
      // Column layout capped to the room `place()` found: only the list of
      // substitutions scrolls, so the header and the buttons can never be
      // pushed off the screen.
      display: "flex",
      flexDirection: "column",
      maxHeight: `${Math.max(220, Math.min(560, available))}px`,
      overflow: "hidden",
      background: p.surface,
      color: p.text,
      border: `1px solid ${p.border}`,
      borderTop: `3px solid ${accent}`,
      borderRadius: "12px",
      boxShadow: p.shadow,
      font: '13px/1.5 system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
      opacity: "0",
      transform: "translateY(6px)",
      transition: "opacity 160ms ease, transform 160ms ease",
    });
    card.setAttribute("role", "status");
    card.setAttribute("aria-live", "polite");

    /* -- header: who is talking -- */
    const header = make("div", {
      display: "flex",
      alignItems: "center",
      gap: "8px",
      padding: "12px 14px 8px",
      flex: "0 0 auto",
    });
    header.appendChild(shield(accent, 20));

    const brandBox = make("div", { display: "flex", flexDirection: "column", flex: "1", minWidth: "0" });
    brandBox.appendChild(
      make("span", { fontSize: "13px", fontWeight: "650", letterSpacing: "-0.01em" }, "AvoPseudo"),
    );
    brandBox.appendChild(
      make(
        "span",
        {
          fontSize: "10px",
          fontWeight: "600",
          letterSpacing: "0.06em",
          textTransform: "uppercase",
          color: p.muted,
        },
        "Browser extension",
      ),
    );
    header.appendChild(brandBox);

    const close = make(
      "button",
      {
        border: "none",
        background: "transparent",
        color: p.muted,
        cursor: "pointer",
        fontSize: "18px",
        lineHeight: "1",
        padding: "2px 4px",
        borderRadius: "6px",
      },
      "×",
    );
    close.type = "button";
    close.setAttribute("aria-label", "Dismiss");
    close.addEventListener("click", () => hidePasteNotice());
    header.appendChild(close);
    card.appendChild(header);

    /* -- the attribution strip: this is not the site, and not the AI -- */
    const attribution = make(
      "div",
      {
        margin: "0 14px 10px",
        padding: "7px 10px",
        borderRadius: "8px",
        background: p.surfaceAlt,
        border: `1px dashed ${p.border}`,
        color: p.muted,
        fontSize: "11.5px",
        flex: "0 0 auto",
      },
      "You are reading a message from your AvoPseudo extension — not from this website, and not from the AI.",
    );
    card.appendChild(attribution);

    /* -- what happened -- */
    const bodyBox = make("div", { padding: "0 14px 12px", flex: "0 0 auto" });
    bodyBox.appendChild(
      make("div", { fontSize: "14px", fontWeight: "650", color: accent, marginBottom: "4px" }, TITLE[opts.outcome]),
    );

    const count = opts.replacements.reduce((n, r) => n + r.count, 0);
    let summary: string;
    if (opts.outcome === "pseudonymised") {
      summary =
        count === 1
          ? "1 value was replaced with a placeholder before your text reached the chat box."
          : `${count} values were replaced with placeholders before your text reached the chat box.`;
    } else if (opts.outcome === "warned") {
      summary =
        "Your text was pasted unchanged, but it looks sensitive. Check it before you send it.";
    } else if (opts.outcome === "blocked") {
      summary = "Nothing was pasted. Your rules forbid sending this content to an AI service.";
    } else {
      summary = "No sensitive data found in what you pasted.";
    }
    bodyBox.appendChild(make("div", { color: p.text }, summary));

    if (opts.outcome === "pseudonymised") {
      bodyBox.appendChild(
        make(
          "div",
          { marginTop: "6px", color: p.muted, fontSize: "11.5px" },
          "The [LABEL_1a2b] tags now in the box were written by AvoPseudo. They are not part of your text, and the AI did not produce them.",
        ),
      );
    }

    if (opts.ruleIds.length > 0 && opts.outcome !== "pseudonymised") {
      bodyBox.appendChild(
        make(
          "div",
          { marginTop: "6px", color: p.muted, fontSize: "11.5px" },
          `Triggered by: ${opts.ruleIds.slice(0, 6).join(", ")}`,
        ),
      );
    }
    card.appendChild(bodyBox);

    /* -- the substitutions, value by value -- */
    if (opts.replacements.length > 0) {
      const listBox = make("div", {
        margin: "0 14px 12px",
        border: `1px solid ${p.border}`,
        borderRadius: "10px",
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
        // The only part of the card allowed to shrink and scroll.
        flex: "0 1 auto",
        minHeight: "0",
      });

      const listHead = make("div", {
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: "8px",
        padding: "7px 10px",
        background: p.surfaceAlt,
        borderBottom: `1px solid ${p.border}`,
        flex: "0 0 auto",
      });
      listHead.appendChild(
        make(
          "span",
          { fontSize: "10.5px", fontWeight: "650", letterSpacing: "0.05em", textTransform: "uppercase", color: p.muted },
          "What was replaced",
        ),
      );
      const toggle = make(
        "button",
        {
          border: "none",
          background: "transparent",
          color: accent,
          cursor: "pointer",
          font: "inherit",
          fontSize: "11.5px",
          fontWeight: "600",
          padding: "0",
        },
        "Show originals",
      );
      toggle.type = "button";
      listHead.appendChild(toggle);
      listBox.appendChild(listHead);

      const rowsBox = make("div", { overflowY: "auto", flex: "0 1 auto", minHeight: "0" });
      listBox.appendChild(rowsBox);

      let shown = false;
      const valueCells: Array<{ cell: HTMLElement; value: string }> = [];

      for (const r of opts.replacements.slice(0, 12)) {
        const row = make("div", {
          display: "flex",
          alignItems: "center",
          gap: "8px",
          padding: "7px 10px",
          borderTop: valueCells.length === 0 ? "none" : `1px solid ${p.border}`,
        });

        const chip = make(
          "code",
          {
            display: "inline-block",
            flex: "0 0 auto",
            maxWidth: "50%",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            background: p.chipBg,
            color: accent,
            border: `1px solid ${p.border}`,
            borderRadius: "6px",
            padding: "1px 6px",
            font: '11.5px/1.5 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
          },
          r.placeholder,
        );
        row.appendChild(chip);

        row.appendChild(make("span", { color: p.muted, flex: "0 0 auto" }, "←"));

        const cell = make(
          "span",
          {
            flex: "1 1 auto",
            minWidth: "0",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            color: p.muted,
          },
          mask(r.value),
        );
        cell.title = "Hidden until you choose to show it";
        row.appendChild(cell);
        valueCells.push({ cell, value: r.value });

        if (r.count > 1) {
          row.appendChild(
            make("span", { flex: "0 0 auto", color: p.muted, fontSize: "11px" }, `×${r.count}`),
          );
        }
        rowsBox.appendChild(row);
      }

      if (opts.replacements.length > 12) {
        rowsBox.appendChild(
          make(
            "div",
            { padding: "7px 10px", borderTop: `1px solid ${p.border}`, color: p.muted, fontSize: "11.5px" },
            `+ ${opts.replacements.length - 12} more`,
          ),
        );
      }

      toggle.addEventListener("click", () => {
        shown = !shown;
        toggle.textContent = shown ? "Hide originals" : "Show originals";
        for (const { cell, value } of valueCells) {
          cell.textContent = shown ? value : mask(value);
          cell.style.color = shown ? p.text : p.muted;
        }
      });

      card.appendChild(listBox);
    }

    /* -- actions -- */
    const actions = make("div", {
      display: "flex",
      gap: "8px",
      justifyContent: "flex-end",
      padding: "0 14px 14px",
      flex: "0 0 auto",
    });

    if (opts.onUndo) {
      const undo = make(
        "button",
        {
          border: `1px solid ${p.border}`,
          background: p.surfaceAlt,
          color: p.text,
          borderRadius: "8px",
          padding: "6px 10px",
          cursor: "pointer",
          font: "inherit",
          fontSize: "12px",
          fontWeight: "600",
        },
        "Undo — paste my original",
      );
      undo.type = "button";
      wireButtonFeel(undo, p.surfaceAlt, p.chipBg);
      undo.addEventListener("click", () => {
        try {
          opts.onUndo?.();
        } finally {
          hidePasteNotice();
        }
      });
      actions.appendChild(undo);
    }

    const ok = make(
      "button",
      {
        border: "none",
        background: accent,
        color: "#ffffff",
        borderRadius: "8px",
        padding: "6px 12px",
        cursor: "pointer",
        font: "inherit",
        fontSize: "12px",
        fontWeight: "600",
      },
      opts.outcome === "blocked" ? "Understood" : "Got it",
    );
    ok.type = "button";
    ok.addEventListener("click", () => hidePasteNotice());
    actions.appendChild(ok);
    card.appendChild(actions);

    shadow.appendChild(card);

    requestAnimationFrame(() => {
      card.style.opacity = "1";
      card.style.transform = "translateY(0)";
    });

    escHandler = (e: KeyboardEvent) => {
      if (e.key === "Escape") hidePasteNotice();
    };
    window.addEventListener("keydown", escHandler, true);

    // A block needs an explicit acknowledgement; the rest fades on its own.
    if (opts.outcome !== "blocked") {
      dismissTimer = setTimeout(() => hidePasteNotice(), AUTO_DISMISS_MS);
    }
  } catch {
    // Never break the host page.
  }
}

/* ------------------------- pending / composer pulse ----------------------- */

/**
 * A small pill shown while the on-device model is still looking at the paste,
 * so the composer never just sits there empty without explanation.
 */
export function showPastePending(anchor?: Element | null): void {
  try {
    const p = palette();
    const mounted = createHost(PENDING_ID);
    if (!mounted) return;
    // One line tall: it fits beside the composer wherever the composer is.
    place(mounted.host, anchor, 240, 0);

    const pill = make("div", {
      pointerEvents: "none",
      display: "flex",
      alignItems: "center",
      gap: "7px",
      padding: "7px 11px",
      background: p.surface,
      color: p.text,
      border: `1px solid ${p.border}`,
      borderRadius: "999px",
      boxShadow: p.shadow,
      font: '12px/1.4 system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
    });
    pill.appendChild(shield(accentFor("pseudonymised", p), 14));
    pill.appendChild(make("span", {}, "AvoPseudo is checking your paste…"));
    mounted.shadow.appendChild(pill);
  } catch {
    /* ignore */
  }
}

export function hidePastePending(): void {
  removeById(PENDING_ID);
}

/**
 * Flash an outline over the composer so the user's eye goes to the box that
 * was just rewritten. Purely decorative overlay — it never touches the editor.
 */
export function pulseComposer(el: Element, outcome: PasteOutcome = "pseudonymised"): void {
  try {
    const root = mountRoot();
    if (!root) return;
    removeById(PULSE_ID);

    const rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    const accent = accentFor(outcome, palette());

    let radius = "12px";
    try {
      radius = getComputedStyle(el).borderRadius || radius;
    } catch {
      /* keep the default */
    }

    const overlay = make("div", {
      position: "fixed",
      left: `${rect.left - 3}px`,
      top: `${rect.top - 3}px`,
      width: `${rect.width + 6}px`,
      height: `${rect.height + 6}px`,
      border: `2px solid ${accent}`,
      borderRadius: radius,
      boxShadow: `0 0 0 4px ${accent}22`,
      pointerEvents: "none",
      zIndex: "2147483646",
      opacity: "0",
      transition: "opacity 200ms ease",
    });
    overlay.id = PULSE_ID;
    root.appendChild(overlay);

    requestAnimationFrame(() => {
      overlay.style.opacity = "1";
      setTimeout(() => {
        overlay.style.opacity = "0";
        setTimeout(() => overlay.remove(), 250);
      }, 1400);
    });
  } catch {
    /* decorative only */
  }
}
