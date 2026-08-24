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
const BADGE_ID = "__avopseudo-paste-badge";

const AUTO_DISMISS_MS = 18_000;

/**
 * How often a mounted badge re-checks that its placeholders are still in the
 * composer. Polled rather than observed: the composer is cleared by the site's
 * own code when the message is sent, which need not fire an `input` event.
 */
const BADGE_STALE_CHECK_MS = 1000;

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

/**
 * Drop every host carrying this id — plural on purpose. `getElementById` returns
 * only the first match, so if a second copy of the extension ever mounts one
 * (a re-injected content script, two unpacked builds side by side) the loser
 * would be left on screen for good, looking like a duplicate badge.
 */
function removeById(id: string): void {
  for (const el of Array.from(document.querySelectorAll(`#${id}`))) el.remove();
}

function mountRoot(): HTMLElement | null {
  return document.body ?? document.documentElement ?? null;
}

const MARGIN = 16;
/** Gap between the card and the top edge of the composer it hangs over. */
const GAP = 10;

/**
 * How the card is positioned.
 *
 * `anchored` is the one we want: the host is hung **inside the composer's own
 * container**, absolutely positioned over the composer's top edge. Placement is
 * then the browser's job — the card rides with the box through page scroll,
 * container scroll and a growing composer, with nothing measured on the scroll
 * path and, crucially, no above/below choice that can flip mid-scroll and make
 * one badge look like two.
 *
 * `pinned` is the fallback for pages where no usable container exists: the
 * viewport's bottom-right corner.
 */
type Placement = "anchored" | "pinned";

/** Elements that cut off anything sticking out past their box. */
function clips(cs: CSSStyleDeclaration): boolean {
  return (
    cs.overflowX !== "visible" ||
    cs.overflowY !== "visible" ||
    (cs.contain ?? "").includes("paint")
  );
}

/** Out of the scroll flow: moves with the viewport, not with the document. */
function detached(cs: CSSStyleDeclaration): boolean {
  return cs.position === "fixed" || cs.position === "sticky";
}

/**
 * The element to hang an anchored card from: the nearest ancestor of the
 * composer that is **positioned** (so it is a containing block for our
 * absolutely positioned host) and does **not clip** its overflow (the card
 * sticks out above the composer, so a clipping container would swallow it).
 *
 * Clipping ancestors *below* the one we pick are harmless — the host ends up a
 * sibling of that subtree, not inside it. A `position: fixed` composer dock is
 * picked up here too, since fixed counts as positioned: the card then stays
 * docked with the composer exactly as the site's own chrome does.
 *
 * The one shape we refuse is a composer that has itself left the scroll flow
 * while every usable container is still in it — an absolute host there would
 * scroll out from under the box it is annotating. Returning null falls the card
 * back to the viewport corner, which for a viewport-docked composer is stable
 * anyway.
 */
function anchorContainer(anchor: Element | null | undefined): HTMLElement | null {
  if (!(anchor instanceof HTMLElement) || !anchor.isConnected) return null;
  try {
    if (detached(getComputedStyle(anchor))) return null;
  } catch {
    return null;
  }
  let el = anchor.parentElement;
  for (let hops = 0; el && hops < 8; hops += 1, el = el.parentElement) {
    let cs: CSSStyleDeclaration;
    try {
      cs = getComputedStyle(el);
    } catch {
      return null;
    }
    if (clips(cs)) {
      // Skipping past a clipper is fine — unless it is what holds the composer
      // still against the viewport, in which case nothing above it will do.
      if (detached(cs)) return null;
      continue;
    }
    if (cs.position !== "static") return el;
  }
  return null;
}

/**
 * Lay the host as a zero-height strip exactly over the composer's top edge,
 * in `container`'s coordinates. The card inside then hangs off that strip's
 * bottom-right corner — i.e. just above the composer, right-aligned to it.
 *
 * Offsets for an absolutely positioned box are measured from its containing
 * block's *padding* box, in that block's own unscrolled coordinates — hence the
 * `clientLeft`/`clientTop` (border) and `scrollLeft`/`scrollTop` corrections.
 */
function anchorTo(host: HTMLElement, container: HTMLElement, anchor: HTMLElement): boolean {
  try {
    const c = container.getBoundingClientRect();
    const a = anchor.getBoundingClientRect();
    if (a.width === 0 && a.height === 0) return false;
    host.style.left = `${a.left - c.left - container.clientLeft + container.scrollLeft}px`;
    host.style.top = `${a.top - c.top - container.clientTop + container.scrollTop}px`;
    host.style.width = `${a.width}px`;
    return true;
  } catch {
    return false;
  }
}

/** Viewport room above the composer — how tall an anchored card may grow. */
function roomAbove(anchor: Element | null | undefined): number {
  try {
    const r = anchor?.getBoundingClientRect();
    if (!r || (r.width === 0 && r.height === 0)) return 0;
    return r.top - GAP - MARGIN;
  } catch {
    return 0;
  }
}

interface Mount {
  host: HTMLElement;
  /** Where the card is appended — positions it within the host. */
  box: HTMLElement;
  placement: Placement;
}

/**
 * A shadow host for one card. Contents live in a shadow root, so page CSS
 * cannot reach them; the host itself now sits in the page's own tree when
 * anchored, so its own box is reset defensively against inherited page rules.
 *
 * Pass the composer to anchor to it; pass nothing to pin to the viewport.
 */
function createHost(id: string, anchor?: Element | null): Mount | null {
  const fallbackRoot = mountRoot();
  if (!fallbackRoot) return null;
  removeById(id);

  const host = make("div", {
    zIndex: "2147483647",
    // The host is a transparent, non-interactive layer; the card inside
    // re-enables pointer events for itself.
    pointerEvents: "none",
    // The host is a child of the page now, so neutralise anything the site's
    // stylesheet might otherwise impose on a stray <div>.
    margin: "0",
    padding: "0",
    border: "0",
    background: "none",
    float: "none",
    transform: "none",
    clipPath: "none",
    minWidth: "0",
    maxWidth: "none",
  });
  host.id = id;
  const shadow = host.attachShadow({ mode: "open" });

  const container = anchorContainer(anchor);
  let placement: Placement = "pinned";
  if (container && anchor instanceof HTMLElement) {
    host.style.position = "absolute";
    host.style.right = "auto";
    host.style.bottom = "auto";
    host.style.height = "0";
    container.appendChild(host);
    if (anchorTo(host, container, anchor)) placement = "anchored";
    else host.remove();
  }
  if (placement === "pinned") {
    host.style.position = "fixed";
    host.style.top = "auto";
    host.style.left = "auto";
    host.style.right = `${MARGIN}px`;
    host.style.bottom = `${MARGIN}px`;
    host.style.width = "auto";
    host.style.height = "auto";
    fallbackRoot.appendChild(host);
  }

  // Anchored: hang the card off the strip's bottom-right corner, so it sits
  // GAP above the composer and shares its right edge. Pinned: the host already
  // *is* the corner, so the card just fills it.
  const box = make(
    "div",
    placement === "anchored"
      ? { position: "absolute", right: "0", bottom: `${GAP}px`, display: "flex", justifyContent: "flex-end" }
      : { display: "flex", justifyContent: "flex-end" },
  );
  shadow.appendChild(box);
  return { host, box, placement };
}

/* -------------------------------- the panel ------------------------------- */

export interface PasteNoticeOptions {
  outcome: PasteOutcome;
  /** Values that were replaced (pseudonymised outcome). */
  replacements: PasteReplacement[];
  /** Rule names behind a warn/block decision. */
  ruleIds: string[];
  /**
   * Composer the paste landed in. Not used for positioning (the card is pinned
   * to the viewport) — it is how the badge tells whether its placeholders are
   * still in the box. See `stillInComposer`.
   */
  anchor?: Element | null;
  /** When given, an "undo" button is shown that puts the original text back. */
  onUndo?: () => void;
  /**
   * The composer refused the write, so nothing actually landed in the box. The
   * guard has already claimed the paste at this point, so without saying this
   * out loud the user just watches their paste vanish with no explanation.
   */
  insertFailed?: boolean;
}

let dismissTimer: ReturnType<typeof setTimeout> | null = null;
let escHandler: ((e: KeyboardEvent) => void) | null = null;

/**
 * The last pseudonymised paste, kept so the popup's "Reveal real values" has
 * something to reopen. In-page reveal never rewrites the composer by design
 * (see `content/reveal.ts`), so for a paste the user has not sent yet this
 * panel is the *only* place the originals can be shown.
 */
let lastReview: PasteNoticeOptions | null = null;

/** Flips the originals on/off inside the panel that is currently mounted. */
let panelSetOriginals: ((shown: boolean) => void) | null = null;

/** Whether a mounted panel is showing real values right now. */
let originalsShown = false;

export function hidePasteNotice(): void {
  if (dismissTimer !== null) {
    clearTimeout(dismissTimer);
    dismissTimer = null;
  }
  if (escHandler) {
    window.removeEventListener("keydown", escHandler, true);
    escHandler = null;
  }
  panelSetOriginals = null;
  originalsShown = false;
  removeById(HOST_ID);
}

/**
 * Give a button a hover/press feel without any stylesheet. `paint` is the
 * element whose background actually changes — on the review badge the hovered
 * control is the button, but the surface that tints is the pill around it.
 */
function wireButtonFeel(
  btn: HTMLElement,
  base: string,
  hover: string,
  paint: HTMLElement = btn,
): void {
  btn.addEventListener("mouseenter", () => {
    paint.style.background = hover;
  });
  btn.addEventListener("mouseleave", () => {
    paint.style.background = base;
  });
}

/**
 * Render the full detail panel — the substitutions list, undo, everything.
 * Called either directly (warn/block, which need active attention right
 * away) or on demand when the user clicks the review badge (pseudonymised)
 * or the popup's "Reveal real values" button (`showOriginals`).
 */
function openFullNotice(opts: PasteNoticeOptions, showOriginals = false): void {
  try {
    hidePastePending();
    hidePasteBadge();
    hidePasteNotice();

    // Nothing reached the composer, so every line below that describes what is
    // "now in the box" would be a lie.
    const failed = opts.insertFailed === true;

    // Only a pseudonymised paste has originals worth coming back to — warn
    // and block never touch the composer, so once acknowledged there is
    // nothing left to review.
    const returnToBadge = opts.outcome === "pseudonymised" && !failed;
    const dismiss = (): void => {
      hidePasteNotice();
      if (returnToBadge) showPasteBadge(opts);
    };

    const p = palette();
    // A failed write is a failure whatever the rules decided, so it takes the
    // warning colour rather than the reassuring brand green.
    const accent = failed ? accentFor("warned", p) : accentFor(opts.outcome, p);
    const width = 348;

    // The panel is tall, so unlike the badge it only hangs over the composer
    // when there is real room above it — otherwise it would run off the top of
    // the screen. This is decided once, when the panel opens, and never
    // revisited: a side that can change under the user is what made the old
    // placement feel broken.
    const room = roomAbove(opts.anchor);
    const anchored = room >= 300;

    const mounted = createHost(HOST_ID, anchored ? opts.anchor : null);
    if (!mounted) return;
    const { box } = mounted;

    const card = make("div", {
      pointerEvents: "auto",
      boxSizing: "border-box",
      width: `${width}px`,
      maxWidth: "calc(100vw - 32px)",
      // Column layout capped to the room it has: only the list of substitutions
      // scrolls, so the header and the buttons can never be pushed off screen.
      display: "flex",
      flexDirection: "column",
      maxHeight:
        mounted.placement === "anchored"
          ? `${Math.min(560, room)}px`
          : `min(560px, calc(100vh - ${MARGIN * 2}px))`,
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
    close.addEventListener("click", dismiss);
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
      make(
        "div",
        { fontSize: "14px", fontWeight: "650", color: accent, marginBottom: "4px" },
        failed ? "Nothing was pasted" : TITLE[opts.outcome],
      ),
    );

    const count = opts.replacements.reduce((n, r) => n + r.count, 0);
    let summary: string;
    if (failed) {
      summary =
        "AvoPseudo checked your text, but this box refused the write — so nothing was pasted. What you copied is still on your clipboard.";
    } else if (opts.outcome === "pseudonymised") {
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

    if (opts.outcome === "pseudonymised" && !failed) {
      bodyBox.appendChild(
        make(
          "div",
          { marginTop: "6px", color: p.muted, fontSize: "11.5px" },
          "The [LABEL_1a2b] tags now in the box were written by AvoPseudo. They are not part of your text, and the AI did not produce them.",
        ),
      );
    }

    // On a failed write the rules that fired are the useful detail, so show
    // them here too — there is no substitution list to carry that information.
    if (opts.ruleIds.length > 0 && (failed || opts.outcome !== "pseudonymised")) {
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
    // Suppressed on a failed write: those placeholders are not in the box, so
    // listing them as "what was replaced" would point at nothing.
    if (opts.replacements.length > 0 && !failed) {
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

      const applyOriginals = (next: boolean): void => {
        shown = next;
        originalsShown = next;
        toggle.textContent = shown ? "Hide originals" : "Show originals";
        for (const { cell, value } of valueCells) {
          cell.textContent = shown ? value : mask(value);
          cell.style.color = shown ? p.text : p.muted;
        }
      };
      toggle.addEventListener("click", () => applyOriginals(!shown));

      card.appendChild(listBox);

      // Hand the switch out so the popup's reveal button can drive this panel
      // without rebuilding it. Only set once the rows exist — there is nothing
      // to unmask on a warn/block panel.
      panelSetOriginals = applyOriginals;
      if (showOriginals) applyOriginals(true);
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
          // The composer is back to the user's original text — there is
          // nothing pseudonymised left to review, so no badge afterwards, and
          // nothing for the popup's reveal button to reopen either.
          if (lastReview === opts) lastReview = null;
          hidePasteNotice();
          hidePasteBadge();
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
      failed || opts.outcome === "blocked" ? "Understood" : "Got it",
    );
    ok.type = "button";
    ok.addEventListener("click", dismiss);
    actions.appendChild(ok);
    card.appendChild(actions);

    box.appendChild(card);

    requestAnimationFrame(() => {
      card.style.opacity = "1";
      card.style.transform = "translateY(0)";
    });

    escHandler = (e: KeyboardEvent) => {
      if (e.key === "Escape") dismiss();
    };
    window.addEventListener("keydown", escHandler, true);

    // A block — or a paste that never landed — needs an explicit
    // acknowledgement; the rest fades on its own (a pseudonymised paste
    // settles back down to the review badge). A panel the user asked for from
    // the popup also stays: pulling the real values back off the screen a few
    // seconds after they were requested would read as a bug.
    if (opts.outcome !== "blocked" && !failed && !showOriginals) {
      dismissTimer = setTimeout(dismiss, AUTO_DISMISS_MS);
    }
  } catch {
    // Never break the host page.
  }
}

/**
 * Public entry point used by the paste guard. A pseudonymised paste is the
 * common, non-blocking case — instead of interrupting with the full panel
 * every time, show a small persistent review badge in the corner and
 * let the full detail (originals, undo) open on demand. Warn, block and a
 * failed write are rarer and need active attention, so they still show the
 * full panel right away.
 */
export function showPasteNotice(opts: PasteNoticeOptions): void {
  if (opts.outcome === "pseudonymised" && !opts.insertFailed) {
    // Remember it: until the message is sent these placeholders exist nowhere
    // but the composer, which in-page reveal will not touch — so this record is
    // what the popup's reveal button reopens. See `revealPasteReview`.
    if (opts.replacements.length > 0) lastReview = opts;
    showPasteBadge(opts);
  } else {
    openFullNotice(opts);
  }
}

/* ---------------------- reveal, driven from the popup --------------------- */

/** How many individual values a review covers (a value can occur many times). */
function reviewCount(opts: PasteNoticeOptions): number {
  return opts.replacements.reduce((n, r) => n + r.count, 0);
}

/**
 * Show the real values behind the placeholders that are still sitting in the
 * composer, by (re)opening the review panel on them.
 *
 * This is the composer half of the popup's "Reveal real values": `revealInPage`
 * only ever rewrites finished conversation bubbles — it deliberately refuses to
 * touch a textarea or a contenteditable, since editing the box the user is
 * typing in would fight the editor and could send real data by accident. So for
 * a paste that has not been sent yet, reveal would otherwise appear to do
 * nothing at all.
 *
 * Returns the number of values now on show; 0 when there is nothing to review
 * (no pseudonymised paste, or its placeholders have already left the composer).
 */
export function revealPasteReview(): number {
  try {
    const opts = lastReview;
    if (!opts || opts.replacements.length === 0) return 0;
    if (!stillInComposer(opts)) {
      lastReview = null;
      return 0;
    }
    if (panelSetOriginals && document.getElementById(HOST_ID)) {
      // Already open — just unmask, keeping the user's scroll position.
      panelSetOriginals(true);
    } else {
      openFullNotice(opts, true);
      if (!originalsShown) return 0; // mount refused
    }
    return reviewCount(opts);
  } catch {
    return 0;
  }
}

/** Mask the values again in an open review panel. Returns how many were hidden. */
export function hidePasteReview(): number {
  try {
    if (!originalsShown || !panelSetOriginals) return 0;
    const count = lastReview ? reviewCount(lastReview) : 0;
    panelSetOriginals(false);
    return count;
  } catch {
    return 0;
  }
}

/** True while a review panel is showing real values. */
export function isPasteReviewRevealed(): boolean {
  return originalsShown;
}

/** Forget the last review — the originals are back in the box, or gone. */
export function clearPasteReview(): void {
  lastReview = null;
}

/**
 * True while the composer still holds at least one of the placeholders this
 * badge is about.
 *
 * A badge outlives the panel by design, so it can easily outlive its own
 * subject: the moment the user sends the message the composer is emptied, and
 * a badge still offering "undo — paste my original" would have nothing left to
 * put back. When we cannot tell (no anchor, an unreadable box) we keep the
 * badge — silently dropping the user's only route back to the originals is the
 * worse failure.
 */
function stillInComposer(opts: PasteNoticeOptions): boolean {
  const anchor = opts.anchor;
  if (!(anchor instanceof HTMLElement)) return true;
  if (opts.replacements.length === 0) return true;
  if (!anchor.isConnected) return false;
  try {
    // `textContent` is enough to find a placeholder and, unlike `innerText`,
    // does not force a layout — this runs on a timer.
    const text =
      anchor instanceof HTMLTextAreaElement || anchor instanceof HTMLInputElement
        ? anchor.value
        : (anchor.textContent ?? "");
    return opts.replacements.some((r) => text.includes(r.placeholder));
  } catch {
    return true;
  }
}

/** Teardown for the watcher belonging to the currently mounted badge. */
let badgeWatchers: (() => void) | null = null;

/**
 * Keep a mounted badge honest for as long as it lives. Unlike the panel, the
 * badge is not a flash — it can sit there for minutes, and three things can
 * happen to it in that time:
 *
 *  - **its subject leaves.** See `stillInComposer`.
 *  - **the composer resizes.** Scrolling no longer moves the badge (it rides
 *    in the composer's own container), but the offset between the container
 *    and the box does change when the box grows, so re-measure on resize.
 *  - **the site takes our node.** An anchored host lives in the page's own
 *    tree, and a React re-render of that subtree can carry it off. Put it back
 *    rather than silently losing the user's only route to the originals.
 *
 * Returns the function that unwires it.
 */
function watchBadge(mounted: Mount, opts: PasteNoticeOptions): () => void {
  const { host, placement } = mounted;
  const anchor = opts.anchor;
  const container = placement === "anchored" ? host.parentElement : null;
  const live = container !== null && anchor instanceof HTMLElement;

  let frame = 0;
  const remeasure = (): void => {
    if (!live || frame !== 0) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      if (host.isConnected) anchorTo(host, container, anchor as HTMLElement);
    });
  };

  let sizeObserver: ResizeObserver | null = null;
  try {
    if (live && typeof ResizeObserver === "function") {
      sizeObserver = new ResizeObserver(remeasure);
      sizeObserver.observe(anchor as HTMLElement);
      sizeObserver.observe(container);
    }
  } catch {
    sizeObserver = null;
  }

  const staleTimer = window.setInterval(() => {
    if (!stillInComposer(opts)) {
      hidePasteBadge();
      return;
    }
    if (!host.isConnected) {
      showPasteBadge(opts);
      return;
    }
    remeasure();
  }, BADGE_STALE_CHECK_MS);

  return () => {
    window.clearInterval(staleTimer);
    sizeObserver?.disconnect();
    if (frame !== 0) cancelAnimationFrame(frame);
  };
}

/**
 * A compact, persistent pill sitting just above the composer: "N values
 * pseudonymised — review". Stays until dismissed, replaced by the next paste,
 * opened into the full panel, or until the placeholders leave the composer —
 * it is the only way back to the originals once the full panel has closed.
 */
export function showPasteBadge(opts: PasteNoticeOptions): void {
  try {
    hidePastePending();
    // A panel still open from an earlier paste is about to be contradicted by
    // this badge; it must not linger on top of it.
    hidePasteNotice();
    hidePasteBadge();
    // Nothing left to review — e.g. the panel was closed after the message had
    // already been sent.
    if (!stillInComposer(opts)) return;

    const p = palette();
    const accent = accentFor(opts.outcome, p);
    const mounted = createHost(BADGE_ID, opts.anchor);
    if (!mounted) return;
    const { box } = mounted;

    const count = opts.replacements.reduce((n, r) => n + r.count, 0);
    const label = count === 1 ? "1 value pseudonymised" : `${count} values pseudonymised`;

    // A plain container holding two real buttons: a button nested inside a
    // button is invalid, and assistive tech flattens it — which used to leave
    // the × both unannounced and unreachable by keyboard.
    const pill = make("div", {
      pointerEvents: "auto",
      display: "flex",
      alignItems: "stretch",
      background: p.surface,
      color: p.text,
      border: `1px solid ${p.border}`,
      borderTop: `2px solid ${accent}`,
      borderRadius: "999px",
      // Clip each button's hover tint to the rounded shape.
      overflow: "hidden",
      boxShadow: p.shadow,
      font: '12px/1.4 system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
      opacity: "0",
      transform: "translateY(4px)",
      transition: "opacity 160ms ease, transform 160ms ease",
    });

    const review = make("button", {
      display: "flex",
      alignItems: "center",
      gap: "7px",
      padding: "6px 8px 6px 11px",
      border: "none",
      background: "transparent",
      color: "inherit",
      font: "inherit",
      cursor: "pointer",
    });
    review.type = "button";
    review.setAttribute("aria-label", `${label}. Review what AvoPseudo replaced.`);
    wireButtonFeel(review, p.surface, p.surfaceAlt, pill);
    review.appendChild(shield(accent, 14));
    review.appendChild(make("span", { fontWeight: "600" }, label));
    review.appendChild(make("span", { color: p.muted, fontSize: "11px" }, "· review"));
    review.addEventListener("click", () => {
      // The placeholders can have left the box between the last poll and this
      // click; opening a review of nothing would only confuse.
      if (!stillInComposer(opts)) {
        hidePasteBadge();
        return;
      }
      openFullNotice(opts);
    });
    pill.appendChild(review);

    const dismiss = make(
      "button",
      {
        display: "flex",
        alignItems: "center",
        border: "none",
        borderLeft: `1px solid ${p.border}`,
        background: "transparent",
        color: p.muted,
        cursor: "pointer",
        font: "inherit",
        fontSize: "14px",
        lineHeight: "1",
        padding: "0 9px",
      },
      "×",
    );
    dismiss.type = "button";
    dismiss.setAttribute("aria-label", "Dismiss");
    wireButtonFeel(dismiss, "transparent", p.surfaceAlt);
    dismiss.addEventListener("click", () => hidePasteBadge());
    pill.appendChild(dismiss);

    box.appendChild(pill);
    badgeWatchers = watchBadge(mounted, opts);

    requestAnimationFrame(() => {
      pill.style.opacity = "1";
      pill.style.transform = "translateY(0)";
    });
  } catch {
    /* never break the host page */
  }
}

export function hidePasteBadge(): void {
  if (badgeWatchers) {
    badgeWatchers();
    badgeWatchers = null;
  }
  removeById(BADGE_ID);
}

/* ------------------------------ pending pill ------------------------------ */

/**
 * A small pill shown while the on-device model is still looking at the paste,
 * so the composer never just sits there empty without explanation.
 */
export function showPastePending(anchor?: Element | null): void {
  try {
    const p = palette();
    // Same spot the badge will take, so the pill visibly turns into the result
    // rather than jumping across the screen.
    const mounted = createHost(PENDING_ID, anchor);
    if (!mounted) return;

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
    mounted.box.appendChild(pill);
  } catch {
    /* ignore */
  }
}

export function hidePastePending(): void {
  removeById(PENDING_ID);
}

