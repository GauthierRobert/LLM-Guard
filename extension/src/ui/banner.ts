/**
 * In-page toast banner. Runs in the MAIN world at document_start, so it must
 * cope with a not-yet-ready DOM and must never throw onto the host page.
 *
 * Security: built exclusively from createElement + textContent + el.style.*.
 * No innerHTML, ever.
 */

type Tone = "info" | "warn" | "danger";

const CONTAINER_ID = "__llm-guard-toast";
const ACCENT: Record<Tone, string> = {
  info: "#2563eb",
  warn: "#d97706",
  danger: "#dc2626",
};

let dismissTimer: ReturnType<typeof setTimeout> | null = null;

function mountRoot(): HTMLElement | null {
  return document.body ?? document.documentElement ?? null;
}

export function showBanner(opts: { message: string; tone: Tone }): void {
  try {
    const root = mountRoot();
    if (!root) return;

    const accent = ACCENT[opts.tone] ?? ACCENT.info;

    // Reuse / replace a single container so toasts don't stack.
    const existing = document.getElementById(CONTAINER_ID);
    if (existing) existing.remove();
    if (dismissTimer !== null) {
      clearTimeout(dismissTimer);
      dismissTimer = null;
    }

    const container = document.createElement("div");
    container.id = CONTAINER_ID;
    const s = container.style;
    s.position = "fixed";
    s.top = "16px";
    s.right = "16px";
    s.zIndex = "2147483647";
    s.maxWidth = "320px";
    s.boxSizing = "border-box";
    s.padding = "10px 14px";
    s.borderRadius = "8px";
    s.borderLeft = `4px solid ${accent}`;
    s.background = "#111827";
    s.color = "#f9fafb";
    s.font = "13px/1.4 system-ui, -apple-system, Segoe UI, Roboto, sans-serif";
    s.boxShadow = "0 4px 14px rgba(0,0,0,0.35)";
    s.opacity = "0";
    s.transition = "opacity 200ms ease";
    s.pointerEvents = "none";

    const label = document.createElement("div");
    const ls = label.style;
    ls.fontSize = "11px";
    ls.fontWeight = "600";
    ls.letterSpacing = "0.04em";
    ls.textTransform = "uppercase";
    ls.color = accent;
    ls.marginBottom = "2px";
    label.textContent = "AvoPseudo";

    const body = document.createElement("div");
    body.textContent = opts.message;

    container.appendChild(label);
    container.appendChild(body);
    root.appendChild(container);

    // Fade in on next frame.
    requestAnimationFrame(() => {
      container.style.opacity = "1";
    });

    // Auto-dismiss after ~5s with a fade-out.
    dismissTimer = setTimeout(() => {
      const el = document.getElementById(CONTAINER_ID);
      if (!el) return;
      el.style.opacity = "0";
      setTimeout(() => {
        el.remove();
      }, 250);
      dismissTimer = null;
    }, 5000);
  } catch {
    // Never break the host page.
  }
}
