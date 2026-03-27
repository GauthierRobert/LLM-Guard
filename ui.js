/**
 * LLM Guard -- UI infrastructure (browser-only)
 * Banner notifications, status badge, event logging.
 * No business logic -- only presentation and logging.
 * Not exported for Node.js -- all functions require DOM APIs.
 */
(function () {
  "use strict";

  function showBanner(findings, action, mappingCount, activeLLM, config) {
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
    } else {
      const bold = document.createElement("strong");
      bold.textContent = "\u26A0\uFE0F ATTENTION";
      msgDiv.appendChild(bold);
      msgDiv.appendChild(document.createTextNode(` \u2014 ${totalPII} donn\u00e9e(s) sensible(s) d\u00e9tect\u00e9e(s) : ${types}`));
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

    if (action !== "BLOCKED") {
      setTimeout(() => {
        if (banner.parentElement) {
          banner.style.transition = "opacity 0.3s";
          banner.style.opacity = "0";
          setTimeout(() => banner.remove(), 300);
        }
      }, config.bannerDuration);
    }
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
    badge.addEventListener("click", () => {
      const newMode = config.mode === "block" ? "anonymize" : "block";
      config.mode = newMode;
      badge.title = `LLM Guard \u2014 ${activeLLM.name} | mode: ${newMode} (cliquez pour changer)`;
      badge.style.background = newMode === "block" ? "#A32D2D" : activeLLM.color;
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

  // Browser only -- all functions require DOM APIs
  if (typeof window !== "undefined") {
    window.__llmGuard = window.__llmGuard || {};
    window.__llmGuard.ui = { showBanner, addStatusBadge, logEvent };
  }
})();
