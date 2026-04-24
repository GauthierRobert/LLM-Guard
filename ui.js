/**
 * LLM Guard -- UI infrastructure (browser-only)
 * Banner notifications, status badge, event logging.
 * No business logic -- only presentation and logging.
 * Not exported for Node.js -- all functions require DOM APIs.
 */
(function () {
  "use strict";

  function showBanner(findings, action, mappingCount, activeLLM, config, attachment) {
    const existing = document.getElementById("llm-guard-banner");
    if (existing) existing.remove();

    const severityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
    const maxSeverity = findings.reduce(
      (max, f) =>
        severityOrder[f.severity] < severityOrder[max] ? f.severity : max,
      "low"
    );

    const colors = {
      critical: { bg: "#501313", border: "#A32D2D", text: "#F7C1C1" },
      high: { bg: "#4A1B0C", border: "#993C1D", text: "#F5C4B3" },
      medium: { bg: "#412402", border: "#854F0B", text: "#FAC775" },
      low: { bg: "#042C53", border: "#185FA5", text: "#B5D4F4" },
    };

    const c =
      action === "ANONYMIZED"
        ? { bg: "#04342C", border: "#0F6E56", text: "#9FE1CB" }
        : colors[maxSeverity];

    const totalPII = findings.reduce((s, f) => s + f.count, 0);
    const types = findings.map((f) => f.type).join(", ");
    const isAttachment = typeof action === "string" && action.startsWith("ATTACHMENT_");

    const banner = document.createElement("div");
    banner.id = "llm-guard-banner";
    banner.setAttribute("style", `
      position: fixed; top: 0; left: 0; right: 0; z-index: 999999;
      background: ${c.bg}; border-bottom: 2px solid ${c.border};
      color: ${c.text}; font-family: system-ui, sans-serif;
      padding: 12px 20px; font-size: 14px; line-height: 1.5;
      display: flex; align-items: center; justify-content: space-between;
      animation: llmGuardSlide 0.3s ease-out;
    `);

    const msgDiv = document.createElement("div");
    msgDiv.setAttribute("style", "flex:1");

    if (action === "ANONYMIZED") {
      const bold = document.createElement("strong");
      bold.textContent = "\u{1F6E1} ANONYMIS\u00c9";
      msgDiv.appendChild(bold);
      msgDiv.appendChild(document.createTextNode(` \u2014 ${mappingCount} donn\u00e9e(s) remplac\u00e9e(s) par des placeholders (${types})`));
    } else if (action === "BLOCKED") {
      const bold = document.createElement("strong");
      bold.textContent = "\u26D4 BLOQU\u00c9";
      msgDiv.appendChild(bold);
      msgDiv.appendChild(document.createTextNode(` \u2014 ${totalPII} donn\u00e9e(s) sensible(s) d\u00e9tect\u00e9e(s) : ${types}`));
      msgDiv.appendChild(document.createElement("br"));
      const em = document.createElement("em");
      em.textContent = "L'envoi a \u00e9t\u00e9 bloqu\u00e9 par la politique de s\u00e9curit\u00e9.";
      msgDiv.appendChild(em);
    } else if (action === "ATTACHMENT_BLOCKED") {
      const bold = document.createElement("strong");
      bold.textContent = "\u{1F4CE} PI\u00c8CE JOINTE BLOQU\u00c9E";
      msgDiv.appendChild(bold);
      msgDiv.appendChild(document.createTextNode(` \u2014 ${totalPII} donn\u00e9e(s) sensible(s) : ${types}`));
    } else if (action === "ATTACHMENT_DETECTED" || action === "ATTACHMENT_PII_DETECTED") {
      const bold = document.createElement("strong");
      bold.textContent = "\u{1F4CE} PI\u00c8CE JOINTE \u2014 PII d\u00e9tect\u00e9";
      msgDiv.appendChild(bold);
      msgDiv.appendChild(document.createTextNode(` \u2014 ${totalPII} donn\u00e9e(s) sensible(s) : ${types}`));
    } else {
      const bold = document.createElement("strong");
      bold.textContent = "\u26A0\uFE0F ATTENTION";
      msgDiv.appendChild(bold);
      msgDiv.appendChild(document.createTextNode(` \u2014 ${totalPII} donn\u00e9e(s) sensible(s) d\u00e9tect\u00e9e(s) : ${types}`));
    }

    if (isAttachment && attachment) {
      const sub = document.createElement("div");
      sub.setAttribute("style", "margin-top:4px;font-size:12px;opacity:0.85");
      const parts = [];
      if (attachment.filename) parts.push(attachment.filename);
      if (attachment.sizeBytes) parts.push(humanBytes(attachment.sizeBytes));
      if (attachment.truncated) parts.push("tronqu\u00e9");
      if (attachment.unavailable) parts.push("extracteur indisponible");
      if (attachment.passwordProtected) parts.push("prot\u00e9g\u00e9 par mot de passe");
      sub.textContent = "Fichier : " + parts.join(" \u00b7 ");
      msgDiv.appendChild(sub);
    }

    const rightDiv = document.createElement("div");
    rightDiv.setAttribute("style", "display:flex;align-items:center;gap:8px;margin-left:16px");

    const llmSpan = document.createElement("span");
    llmSpan.setAttribute("style", "font-size:11px;opacity:0.7");
    llmSpan.textContent = activeLLM.name;

    const closeBtn = document.createElement("button");
    closeBtn.textContent = "Fermer";
    closeBtn.setAttribute("style", `background:none;border:1px solid ${c.border};color:${c.text};padding:4px 12px;border-radius:4px;cursor:pointer;font-size:13px;white-space:nowrap`);
    closeBtn.addEventListener("click", () => banner.remove());

    rightDiv.appendChild(llmSpan);

    if (isAttachment && attachment && attachment.anonymizedText) {
      const copyBtn = document.createElement("button");
      copyBtn.textContent = "Copier le texte anonymis\u00e9";
      copyBtn.setAttribute("style", `background:none;border:1px solid ${c.border};color:${c.text};padding:4px 12px;border-radius:4px;cursor:pointer;font-size:13px;white-space:nowrap`);
      copyBtn.addEventListener("click", async () => {
        try {
          await navigator.clipboard.writeText(attachment.anonymizedText);
          copyBtn.textContent = "\u2713 Copi\u00e9";
          setTimeout(() => { copyBtn.textContent = "Copier le texte anonymis\u00e9"; }, 2000);
        } catch {
          copyBtn.textContent = "\u26A0 \u00c9chec";
        }
      });
      rightDiv.appendChild(copyBtn);
    }

    if (isAttachment && attachment && attachment.sha256) {
      const safeBtn = document.createElement("button");
      safeBtn.textContent = "Marquer comme s\u00fbr";
      safeBtn.setAttribute("style", `background:none;border:1px solid ${c.border};color:${c.text};padding:4px 12px;border-radius:4px;cursor:pointer;font-size:13px;white-space:nowrap`);
      safeBtn.addEventListener("click", () => {
        window.postMessage({
          source: "llm-guard",
          type: "allowlist.addAttachment",
          sha256: attachment.sha256,
          filename: attachment.filename || "",
        }, window.location.origin);
        safeBtn.textContent = "\u2713 Ajout\u00e9";
        safeBtn.disabled = true;
      });
      rightDiv.appendChild(safeBtn);
    }

    rightDiv.appendChild(closeBtn);
    banner.appendChild(msgDiv);
    banner.appendChild(rightDiv);

    if (!document.getElementById("llmGuardStyles")) {
      const style = document.createElement("style");
      style.id = "llmGuardStyles";
      style.textContent = `
        @keyframes llmGuardSlide {
          from { transform: translateY(-100%); opacity: 0; }
          to { transform: translateY(0); opacity: 1; }
        }
      `;
      document.head.appendChild(style);
    }

    document.body.appendChild(banner);

    const persistent = action === "BLOCKED" || action === "ATTACHMENT_BLOCKED";
    if (!persistent) {
      setTimeout(() => {
        if (banner.parentElement) {
          banner.style.transition = "opacity 0.3s";
          banner.style.opacity = "0";
          setTimeout(() => banner.remove(), 300);
        }
      }, config.bannerDuration);
    }
  }

  function humanBytes(n) {
    if (!Number.isFinite(n) || n < 0) return "";
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
    return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  }

  function addStatusBadge(activeLLM, config, onModeChange) {
    const badge = document.createElement("div");
    badge.id = "llm-guard-badge";
    badge.title = `LLM Guard \u2014 ${activeLLM.name} | mode: ${config.mode} (cliquez pour changer)`;
    badge.setAttribute("style", `
      position: fixed; bottom: 16px; right: 16px; z-index: 999998;
      width: 36px; height: 36px; border-radius: 50%;
      background: ${activeLLM.color};
      display: flex; align-items: center; justify-content: center;
      font-size: 14px; cursor: pointer; color: white;
      box-shadow: 0 2px 8px rgba(0,0,0,0.3);
      transition: transform 0.2s;
      font-weight: bold; font-family: system-ui;
    `);
    badge.textContent = activeLLM.name.charAt(0);
    badge.addEventListener("mouseenter", () => {
      badge.style.transform = "scale(1.15)";
    });
    badge.addEventListener("mouseleave", () => {
      badge.style.transform = "scale(1)";
    });
    const MODE_CYCLE = ["anonymize", "visible", "block"];
    const MODE_COLORS = {
      anonymize: activeLLM.color,
      visible: "#7C3AED",
      block: "#A32D2D",
    };
    badge.addEventListener("click", () => {
      const idx = MODE_CYCLE.indexOf(config.mode);
      const newMode = MODE_CYCLE[(idx + 1) % MODE_CYCLE.length];
      config.mode = newMode;
      badge.title = `LLM Guard \u2014 ${activeLLM.name} | mode: ${newMode} (cliquez pour changer)`;
      badge.style.background = MODE_COLORS[newMode] || activeLLM.color;
      if (onModeChange) onModeChange(newMode);
    });

    if (document.body) {
      document.body.appendChild(badge);
    } else {
      document.addEventListener("DOMContentLoaded", () => {
        document.body.appendChild(badge);
      });
    }
  }

  function logEvent(data, activeLLM) {
    const event = {
      timestamp: new Date().toISOString(),
      url: window.location.href,
      llm: activeLLM.name,
      ...data,
    };
    window.postMessage(
      { source: "llm-guard", type: "log", payload: event },
      window.location.origin
    );
    console.log(
      `%c[LLM Guard][${activeLLM.name}]`,
      `color: ${activeLLM.color}; font-weight: bold;`,
      event.action,
      event
    );
  }

  // ── Visible mode: floating Reveal/Hide toggle ────────────────
  // Only rewrites text inside the conversation container for the active LLM;
  // never touches extension chrome or the whole document. Toggles the DOM in
  // place between placeholders (the default in visible mode) and real values.
  //
  // Robustness notes (points of failure addressed):
  //   - revealState (user intent) vs. domShowsOriginals (actual DOM state)
  //     are tracked separately so mode-switches and empty-map clicks never
  //     desync the toggle from what the user actually sees.
  //   - Every DOM op is wrapped in try/catch and logs to console so silent
  //     failures (e.g. shadow-root access, null nodeValue, detached nodes,
  //     TreeWalker mutation races) are visible during triage.
  //   - Shadow DOM is traversed recursively; attributes (title/alt/aria-*/
  //     placeholder) and form field values (textarea/input.value,
  //     contenteditable subtrees) are rewritten too.
  //   - reapply is re-entrant-safe: a lock prevents overlapping rewrites
  //     from the conversation observer clobbering a click-triggered pass.
  //   - Leaving visible mode while originals are shown reverts the DOM
  //     back to placeholders (privacy-critical) instead of just flipping
  //     the state flag.
  let revealState = false;          // user intent: true = show originals
  let domShowsOriginals = false;    // actual DOM state: true = originals visible
  let revealButtonRef = null;
  let rewriteInFlight = false;      // re-entry guard
  // Re-apply hook populated by addRevealToggleButton. Used by the content
  // script's conversation observer to re-enforce the current reveal state
  // whenever the LLM streams new tokens (which would otherwise clobber our
  // in-place DOM rewrite).
  let reapplyRevealFn = null;
  let revertToPlaceholdersFn = null;

  // Attributes that may contain user-visible PII rendered by the LLM site.
  const REWRITABLE_ATTRS = ["title", "alt", "aria-label", "placeholder", "value"];

  function isExtensionChrome(el) {
    // Walk up the parent chain, crossing shadow boundaries, looking for our
    // own UI. Any element inside our banner/badge/reveal button is excluded
    // from rewrites so we never mangle our own chrome.
    let p = el;
    while (p) {
      if (p.nodeType === 1) {
        const id = p.id;
        if (id === "llm-guard-banner" || id === "llm-guard-badge" || id === "llm-guard-reveal") {
          return true;
        }
      }
      const parent = p.parentNode;
      if (parent) { p = parent; continue; }
      const root = p.getRootNode && p.getRootNode();
      if (root && root.host && root.host !== p) { p = root.host; continue; }
      return false;
    }
    return false;
  }

  function addRevealToggleButton({ activeLLM, isVisibleMode, anonymizer }) {
    if (!anonymizer || !anonymizer.anonymizationMap || !anonymizer.reverseMap) {
      console.error("[LLM Guard][reveal] addRevealToggleButton: missing/invalid anonymizer \u2014 reveal disabled");
      return;
    }

    const btn = document.createElement("button");
    btn.id = "llm-guard-reveal";
    btn.type = "button";
    btn.textContent = "\u{1F441} R\u00e9v\u00e9ler les PII";
    btn.setAttribute("aria-pressed", "false");
    btn.setAttribute("style", [
      "position: fixed",
      "bottom: 16px",
      "right: 60px",
      "z-index: 999998",
      "padding: 6px 12px",
      "border-radius: 18px",
      "border: 1px solid #7C3AED",
      "background: #1a1430",
      "color: #e4d7ff",
      "font-family: system-ui, -apple-system, sans-serif",
      "font-size: 12px",
      "font-weight: 600",
      "cursor: pointer",
      "box-shadow: 0 2px 8px rgba(0,0,0,0.3)",
      "display: none",
    ].join(";"));
    revealButtonRef = btn;

    function getConversationRoots() {
      try {
        const sel = activeLLM.conversationSelector || "main";
        const nodes = document.querySelectorAll(sel);
        if (nodes.length > 0) return Array.from(nodes);
        console.warn("[LLM Guard][reveal] conversation selector matched nothing, falling back to body:", sel);
      } catch (err) {
        console.error("[LLM Guard][reveal] getConversationRoots: bad selector", activeLLM.conversationSelector, err);
      }
      return document.body ? [document.body] : [];
    }

    // Collect text nodes from a root, recursively descending into shadow
    // roots. Captures nodes before mutation so iteration isn't perturbed by
    // the rewrite itself (or by concurrent streaming mutations).
    function collectTextNodes(root, out) {
      if (!root) return;
      try {
        if (root.nodeType === 1 && isExtensionChrome(root)) return;
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
          acceptNode(node) {
            return isExtensionChrome(node.parentNode) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT;
          },
        });
        let n;
        while ((n = walker.nextNode())) out.push(n);
      } catch (err) {
        console.error("[LLM Guard][reveal] collectTextNodes: walker failed", err);
      }
      // Shadow DOM: TreeWalker doesn't cross shadow boundaries, so we
      // descend manually. Closed shadow roots are unreachable by design.
      try {
        const hosts = root.querySelectorAll ? root.querySelectorAll("*") : [];
        for (const host of hosts) {
          if (host.shadowRoot && !isExtensionChrome(host)) {
            collectTextNodes(host.shadowRoot, out);
          }
        }
      } catch (err) {
        console.error("[LLM Guard][reveal] collectTextNodes: shadow traversal failed", err);
      }
    }

    function collectAttrTargets(root, out) {
      if (!root || !root.querySelectorAll) return;
      try {
        const selector = REWRITABLE_ATTRS.map((a) => `[${a}]`).join(",");
        const els = root.querySelectorAll(selector);
        for (const el of els) {
          if (!isExtensionChrome(el)) out.push(el);
        }
      } catch (err) {
        console.error("[LLM Guard][reveal] collectAttrTargets failed", err);
      }
      try {
        const all = root.querySelectorAll ? root.querySelectorAll("*") : [];
        for (const host of all) {
          if (host.shadowRoot && !isExtensionChrome(host)) {
            collectAttrTargets(host.shadowRoot, out);
          }
        }
      } catch (err) {
        console.error("[LLM Guard][reveal] collectAttrTargets: shadow traversal failed", err);
      }
    }

    function collectFormFields(root, out) {
      if (!root || !root.querySelectorAll) return;
      try {
        const els = root.querySelectorAll(
          'textarea, input[type="text"], input[type="search"], input:not([type]), [contenteditable="true"], [contenteditable=""]'
        );
        for (const el of els) {
          if (!isExtensionChrome(el)) out.push(el);
        }
      } catch (err) {
        console.error("[LLM Guard][reveal] collectFormFields failed", err);
      }
      try {
        const all = root.querySelectorAll ? root.querySelectorAll("*") : [];
        for (const host of all) {
          if (host.shadowRoot && !isExtensionChrome(host)) {
            collectFormFields(host.shadowRoot, out);
          }
        }
      } catch (err) {
        console.error("[LLM Guard][reveal] collectFormFields: shadow traversal failed", err);
      }
    }

    function applyReplacements(text, entries) {
      if (typeof text !== "string" || text.length === 0) return { text, changed: false };
      let out = text;
      let changed = false;
      for (const [needle, replacement] of entries) {
        if (!needle || out.indexOf(needle) === -1) continue;
        try {
          out = out.split(needle).join(replacement);
          changed = true;
        } catch (err) {
          console.error("[LLM Guard][reveal] applyReplacements split/join failed", { needle, err });
        }
      }
      return { text: out, changed };
    }

    // Core rewrite pass. `forward=true` swaps placeholders\u2192originals
    // (reveal), `forward=false` swaps originals\u2192placeholders (hide).
    function rewriteText(root, forward) {
      const forwardMap = anonymizer.anonymizationMap;
      const reverseMap = anonymizer.reverseMap;
      if (!forwardMap || !reverseMap) {
        console.error("[LLM Guard][reveal] rewriteText: anonymizer maps missing");
        return 0;
      }
      if (forwardMap.size === 0) return 0;

      const sourceMap = forward ? forwardMap : reverseMap;
      // Sort by key length DESC so longer matches win (e.g. an email
      // placeholder doesn't get partially eaten by a shorter name match).
      const entries = Array.from(sourceMap.entries()).sort((a, b) => b[0].length - a[0].length);
      let changes = 0;

      // 1. Text nodes (including shadow DOM descendants).
      const textNodes = [];
      collectTextNodes(root, textNodes);
      for (const node of textNodes) {
        try {
          const val = node.nodeValue;
          if (typeof val !== "string" || val.length === 0) continue;
          const res = applyReplacements(val, entries);
          if (res.changed) { node.nodeValue = res.text; changes++; }
        } catch (err) {
          console.error("[LLM Guard][reveal] rewriteText: text node update failed", err);
        }
      }

      // 2. Attributes (title/alt/aria-label/placeholder/value on elements).
      const attrTargets = [];
      collectAttrTargets(root, attrTargets);
      for (const el of attrTargets) {
        for (const attr of REWRITABLE_ATTRS) {
          try {
            if (!el.hasAttribute || !el.hasAttribute(attr)) continue;
            const val = el.getAttribute(attr);
            const res = applyReplacements(val, entries);
            if (res.changed) { el.setAttribute(attr, res.text); changes++; }
          } catch (err) {
            console.error("[LLM Guard][reveal] rewriteText: attr update failed", { attr, err });
          }
        }
      }

      // 3. Form field live .value (textarea/input). Contenteditable children
      // are already covered by the text-node pass above. Uses the native
      // setter so React-controlled inputs see the change.
      const formFields = [];
      collectFormFields(root, formFields);
      for (const el of formFields) {
        try {
          const tag = el.tagName;
          if (tag !== "TEXTAREA" && tag !== "INPUT") continue;
          const val = el.value;
          const res = applyReplacements(val, entries);
          if (!res.changed) continue;
          const proto = tag === "TEXTAREA"
            ? (window.HTMLTextAreaElement && window.HTMLTextAreaElement.prototype)
            : (window.HTMLInputElement && window.HTMLInputElement.prototype);
          const desc = proto && Object.getOwnPropertyDescriptor(proto, "value");
          if (desc && desc.set) desc.set.call(el, res.text);
          else el.value = res.text;
          changes++;
        } catch (err) {
          console.error("[LLM Guard][reveal] rewriteText: form field update failed", err);
        }
      }

      return changes;
    }

    function rewriteAllRoots(forward) {
      if (rewriteInFlight) return 0;
      rewriteInFlight = true;
      let total = 0;
      try {
        const roots = getConversationRoots();
        if (roots.length === 0) {
          console.warn("[LLM Guard][reveal] rewriteAllRoots: no roots to rewrite");
        }
        for (const r of roots) {
          try {
            total += rewriteText(r, forward) || 0;
          } catch (err) {
            console.error("[LLM Guard][reveal] rewriteAllRoots: per-root rewrite failed", err);
          }
        }
      } finally {
        rewriteInFlight = false;
      }
      return total;
    }

    function setButtonAppearance(revealed) {
      if (!revealButtonRef) return;
      revealButtonRef.textContent = revealed
        ? "\u{1F441}\u200d\u{1F5E8} Masquer les PII"
        : "\u{1F441} R\u00e9v\u00e9ler les PII";
      revealButtonRef.setAttribute("aria-pressed", revealed ? "true" : "false");
      revealButtonRef.style.background = revealed ? "#3b1a6e" : "#1a1430";
    }

    btn.addEventListener("click", () => {
      try {
        if (!isVisibleMode()) {
          console.warn("[LLM Guard][reveal] click ignored: not in visible mode");
          return;
        }
        if (anonymizer.anonymizationMap.size === 0) {
          // No mappings yet \u2014 flipping state would just confuse the user.
          console.info("[LLM Guard][reveal] click ignored: no PII mappings to toggle");
          return;
        }
        const nextState = !revealState;
        const changes = rewriteAllRoots(nextState);
        revealState = nextState;
        domShowsOriginals = nextState;
        setButtonAppearance(revealState);
        console.info(`[LLM Guard][reveal] toggled reveal=${revealState} (rewrote ${changes} target(s))`);
      } catch (err) {
        console.error("[LLM Guard][reveal] click handler failed", err);
      }
    });

    // Publish the reapply hook. content.js calls this from a conversation
    // observer so streaming tokens don't clobber the current reveal state,
    // and so the user's own message bubble (rendered by the LLM site from
    // raw input) gets rewritten to placeholders in visible mode.
    reapplyRevealFn = () => {
      try {
        if (!isVisibleMode()) return;
        if (anonymizer.anonymizationMap.size === 0) return;
        rewriteAllRoots(revealState);
        domShowsOriginals = revealState;
      } catch (err) {
        console.error("[LLM Guard][reveal] reapply failed", err);
      }
    };

    // When leaving visible mode we must force the DOM back to placeholders
    // if the user had revealed originals \u2014 otherwise a mode-switch leaks
    // real PII in the rendered conversation until the next scroll/refresh.
    revertToPlaceholdersFn = () => {
      try {
        if (!domShowsOriginals) return;
        const changes = rewriteAllRoots(false);
        domShowsOriginals = false;
        console.info(`[LLM Guard][reveal] reverted DOM to placeholders on mode exit (${changes} change(s))`);
      } catch (err) {
        console.error("[LLM Guard][reveal] revertToPlaceholders failed", err);
      }
    };

    function mount() {
      try {
        if (document.body && !document.getElementById("llm-guard-reveal")) {
          document.body.appendChild(btn);
        }
        updateRevealButton(isVisibleMode());
      } catch (err) {
        console.error("[LLM Guard][reveal] mount failed", err);
      }
    }
    if (document.body) mount();
    else document.addEventListener("DOMContentLoaded", mount);
  }

  // Re-mount the reveal button if an SPA removed it, and re-enforce the
  // current reveal state. Called from content.js on conversation mutations.
  function reapplyRevealState() {
    try {
      if (revealButtonRef && document.body && !document.body.contains(revealButtonRef)) {
        document.body.appendChild(revealButtonRef);
      }
      if (typeof reapplyRevealFn === "function") reapplyRevealFn();
    } catch (err) {
      console.error("[LLM Guard][reveal] reapplyRevealState failed", err);
    }
  }

  function updateRevealButton(show) {
    if (!revealButtonRef) return;
    try {
      revealButtonRef.style.display = show ? "inline-block" : "none";
      if (!show) {
        // Privacy-critical: if the user had revealed originals and is now
        // leaving visible mode, the DOM must be swept back to placeholders
        // before we reset our state flag \u2014 otherwise reveal\u2192mode-switch\u2192
        // mode-switch-back desyncs the toggle from the actual DOM.
        if (typeof revertToPlaceholdersFn === "function") {
          revertToPlaceholdersFn();
        }
        revealState = false;
        revealButtonRef.textContent = "\u{1F441} R\u00e9v\u00e9ler les PII";
        revealButtonRef.setAttribute("aria-pressed", "false");
        revealButtonRef.style.background = "#1a1430";
      }
    } catch (err) {
      console.error("[LLM Guard][reveal] updateRevealButton failed", err);
    }
  }

  // Browser only -- all functions require DOM APIs
  if (typeof window !== "undefined") {
    window.__llmGuard = window.__llmGuard || {};
    window.__llmGuard.ui = { showBanner, addStatusBadge, logEvent, addRevealToggleButton, updateRevealButton, reapplyRevealState };
  }
})();
