/**
 * LLM Guard v2 — Content Script
 * Multi-LLM (ChatGPT, Claude, Gemini, Copilot)
 * + Anonymisation automatique des PII
 * + Dé-anonymisation dans les réponses
 */

(function () {
  "use strict";

  // ─── Détection du LLM courant ────────────────────────────────
  const LLM_PROFILES = {
    chatgpt: {
      name: "ChatGPT",
      hostMatch: /chatgpt\.com|chat\.openai\.com/,
      endpointMatch: /\/conversation/,
      extractPrompt: extractChatGPTPrompt,
      injectAnonymized: injectChatGPTAnonymized,
      color: "#10A37F",
    },
    claude: {
      name: "Claude",
      hostMatch: /claude\.ai/,
      endpointMatch: /\/api\/.*(chat|completion|message|conversation)/,
      extractPrompt: extractClaudePrompt,
      injectAnonymized: injectClaudeAnonymized,
      color: "#D97706",
    },
    gemini: {
      name: "Gemini",
      hostMatch: /gemini\.google\.com/,
      endpointMatch: /\/generate|\/stream|BardChatUi/,
      extractPrompt: extractGeminiPrompt,
      injectAnonymized: injectGeminiAnonymized,
      color: "#4285F4",
    },
    copilot: {
      name: "Copilot",
      hostMatch: /copilot\.microsoft\.com/,
      endpointMatch: /\/api\/conversation|\/sydney/,
      extractPrompt: extractCopilotPrompt,
      injectAnonymized: injectCopilotAnonymized,
      color: "#0078D4",
    },
  };

  const currentHost = window.location.hostname;
  const ACTIVE_LLM = Object.values(LLM_PROFILES).find((p) =>
    p.hostMatch.test(currentHost)
  );

  if (!ACTIVE_LLM) return;

  // ─── Configuration ───────────────────────────────────────────
  const CONFIG = {
    // "anonymize" = remplace les PII par des placeholders
    // "warn" = affiche un bandeau mais laisse passer tel quel
    // "block" = empêche l'envoi
    mode: "anonymize",

    bannerDuration: 8000,
  };

  // ─── Détecteurs PII ──────────────────────────────────────────
  const PII_PATTERNS = [
    {
      name: "Email",
      regex: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,
      severity: "high",
      placeholder: "[EMAIL_§]",
    },
    {
      name: "Téléphone FR",
      regex: /(?:\+33|0)\s*[1-9](?:[\s.-]*\d{2}){4}/g,
      severity: "high",
      placeholder: "[TEL_§]",
    },
    {
      name: "Téléphone international",
      regex: /\+\d{1,3}[\s.-]?\d{4,14}/g,
      severity: "medium",
      placeholder: "[TEL_INTL_§]",
    },
    {
      name: "IBAN",
      regex: /\b[A-Z]{2}\d{2}\s?[\dA-Z]{4}\s?[\dA-Z]{4}\s?[\dA-Z]{4}\s?[\dA-Z]{0,4}\s?[\dA-Z]{0,4}\s?[\dA-Z]{0,4}\b/g,
      severity: "critical",
      placeholder: "[IBAN_§]",
    },
    {
      name: "Carte bancaire",
      regex: /\b(?:\d{4}[\s-]?){3}\d{4}\b/g,
      severity: "critical",
      placeholder: "[CB_§]",
    },
    {
      name: "Numéro SS",
      regex: /\b[12]\s?\d{2}\s?\d{2}\s?\d{2}\s?\d{3}\s?\d{3}\s?\d{2}\b/g,
      severity: "critical",
      placeholder: "[NSS_§]",
    },
    {
      name: "Adresse IP",
      regex: /\b(?:\d{1,3}\.){3}\d{1,3}\b/g,
      severity: "low",
      placeholder: "[IP_§]",
    },
    {
      name: "Date de naissance",
      regex: /\b(?:0[1-9]|[12]\d|3[01])[\/.-](?:0[1-9]|1[0-2])[\/.-](?:19|20)\d{2}\b/g,
      severity: "medium",
      placeholder: "[DATE_§]",
    },
    {
      name: "Domaine interne",
      regex: /\b[a-zA-Z0-9-]+\.(?:internal|local|corp|intranet|lan)\b/gi,
      severity: "medium",
      placeholder: "[DOMAIN_§]",
    },
    {
      name: "Mot de passe",
      regex: /(?:password|mot de passe|mdp|pwd)\s*[:=]\s*\S+/gi,
      severity: "critical",
      placeholder: "[PASSWORD_§]",
    },
    {
      name: "Nom de personne FR",
      regex: /\b(?:M\.|Mme|Mlle|Dr|Pr)\s+[A-ZÉÈÊËÀÂÔÛÙÏÎ][a-zéèêëàâôûùïîç]+(?:\s+[A-ZÉÈÊËÀÂÔÛÙÏÎ][a-zéèêëàâôûùïîç]+){1,2}\b/g,
      severity: "high",
      placeholder: "[PERSONNE_§]",
    },
    {
      name: "Adresse postale FR",
      regex: /\b\d{1,4}\s+(?:rue|avenue|boulevard|place|impasse|allée|chemin|route)\s+[A-Za-zÀ-ÿ\s-]{3,40}\b/gi,
      severity: "high",
      placeholder: "[ADRESSE_§]",
    },
  ];

  const SENSITIVE_KEYWORDS = [
    "salaire", "rémunération", "bulletin de paie", "fiche de paie",
    "dossier médical", "diagnostic", "pathologie", "casier judiciaire",
    "orientation sexuelle", "religion", "opinion politique",
    "appartenance syndicale", "données biométriques",
    "numéro de sécurité sociale", "NIR", "secret professionnel",
    "confidentiel", "NDA",
  ];

  // ─── Anonymisation ───────────────────────────────────────────
  // Stocke les mappings pour dé-anonymiser les réponses
  let anonymizationMap = new Map(); // placeholder → valeur originale
  let reverseMap = new Map(); // valeur originale → placeholder

  function anonymizeText(text) {
    let result = text;
    const newMap = new Map();
    const newReverse = new Map();
    let globalCounter = 0;

    for (const pattern of PII_PATTERNS) {
      // Reset regex state
      const regex = new RegExp(pattern.regex.source, pattern.regex.flags);
      let match;
      while ((match = regex.exec(result)) !== null) {
        const original = match[0];

        // Réutiliser un placeholder existant pour la même valeur
        if (newReverse.has(original)) continue;

        globalCounter++;
        const placeholder = pattern.placeholder.replace("§", globalCounter);
        newMap.set(placeholder, original);
        newReverse.set(original, placeholder);
      }
    }

    // Remplacer les valeurs par les placeholders (du plus long au plus court)
    const sortedEntries = [...newReverse.entries()].sort(
      (a, b) => b[0].length - a[0].length
    );
    for (const [original, placeholder] of sortedEntries) {
      result = result.split(original).join(placeholder);
    }

    // Mettre à jour les maps globales
    anonymizationMap = new Map([...anonymizationMap, ...newMap]);
    reverseMap = new Map([...reverseMap, ...newReverse]);

    return { anonymized: result, mappings: newMap, changed: newMap.size > 0 };
  }

  function deanonymizeText(text) {
    let result = text;
    for (const [placeholder, original] of anonymizationMap) {
      result = result.split(placeholder).join(original);
    }
    return result;
  }

  // ─── Scanner (pour warn/block mode) ──────────────────────────
  function scanForPII(text) {
    const findings = [];
    for (const pattern of PII_PATTERNS) {
      const regex = new RegExp(pattern.regex.source, pattern.regex.flags);
      const matches = text.match(regex);
      if (matches) {
        findings.push({
          type: pattern.name,
          severity: pattern.severity,
          count: matches.length,
          samples: matches.slice(0, 3).map(maskPII),
        });
      }
    }
    const lowerText = text.toLowerCase();
    const foundKeywords = SENSITIVE_KEYWORDS.filter((kw) =>
      lowerText.includes(kw.toLowerCase())
    );
    if (foundKeywords.length > 0) {
      findings.push({
        type: "Mot-clé sensible RGPD",
        severity: "medium",
        count: foundKeywords.length,
        samples: foundKeywords.slice(0, 3),
      });
    }
    return findings;
  }

  function maskPII(value) {
    if (value.length <= 4) return "****";
    return value.slice(0, 2) + "****" + value.slice(-2);
  }

  // ─── Extraction du prompt par LLM ────────────────────────────
  function extractChatGPTPrompt(body) {
    try {
      const data = typeof body === "string" ? JSON.parse(body) : body;
      if (data.messages && Array.isArray(data.messages)) {
        return data.messages
          .filter((m) => m.author?.role === "user" || m.role === "user")
          .map((m) => {
            if (m.content?.parts) return m.content.parts.join(" ");
            if (typeof m.content === "string") return m.content;
            return "";
          })
          .join("\n");
      }
      return JSON.stringify(data);
    } catch { return typeof body === "string" ? body : ""; }
  }

  function extractClaudePrompt(body) {
    try {
      const data = typeof body === "string" ? JSON.parse(body) : body;
      // Claude envoie : { prompt: "...", messages: [...] } ou { content: "..." }
      if (data.prompt) return data.prompt;
      if (data.messages) {
        return data.messages
          .filter((m) => m.role === "user" || m.role === "human")
          .map((m) => {
            if (typeof m.content === "string") return m.content;
            if (Array.isArray(m.content)) {
              return m.content
                .filter((c) => c.type === "text")
                .map((c) => c.text)
                .join(" ");
            }
            return "";
          })
          .join("\n");
      }
      return JSON.stringify(data);
    } catch { return typeof body === "string" ? body : ""; }
  }

  function extractGeminiPrompt(body) {
    try {
      const data = typeof body === "string" ? JSON.parse(body) : body;
      // Gemini a plusieurs formats, on essaie les plus courants
      if (data.contents) {
        return data.contents
          .filter((c) => c.role === "user")
          .flatMap((c) => c.parts || [])
          .map((p) => p.text || "")
          .join("\n");
      }
      // Fallback : chercher tout champ texte
      return JSON.stringify(data);
    } catch { return typeof body === "string" ? body : ""; }
  }

  function extractCopilotPrompt(body) {
    try {
      const data = typeof body === "string" ? JSON.parse(body) : body;
      if (data.messages) {
        return data.messages
          .filter((m) => m.author === "user" || m.role === "user")
          .map((m) => m.text || m.content || "")
          .join("\n");
      }
      return JSON.stringify(data);
    } catch { return typeof body === "string" ? body : ""; }
  }

  // ─── Injection du body anonymisé par LLM ─────────────────────
  function injectChatGPTAnonymized(body, anonymized) {
    try {
      const data = typeof body === "string" ? JSON.parse(body) : body;
      if (data.messages) {
        for (const m of data.messages) {
          if (m.author?.role === "user" || m.role === "user") {
            if (m.content?.parts) {
              m.content.parts = m.content.parts.map(() => anonymized);
            } else if (typeof m.content === "string") {
              m.content = anonymized;
            }
          }
        }
      }
      return JSON.stringify(data);
    } catch { return body; }
  }

  function injectClaudeAnonymized(body, anonymized) {
    try {
      const data = typeof body === "string" ? JSON.parse(body) : body;
      if (data.prompt) {
        data.prompt = anonymized;
      }
      if (data.messages) {
        for (const m of data.messages) {
          if (m.role === "user" || m.role === "human") {
            if (typeof m.content === "string") {
              m.content = anonymized;
            } else if (Array.isArray(m.content)) {
              for (const c of m.content) {
                if (c.type === "text") c.text = anonymized;
              }
            }
          }
        }
      }
      return JSON.stringify(data);
    } catch { return body; }
  }

  function injectGeminiAnonymized(body, anonymized) {
    try {
      const data = typeof body === "string" ? JSON.parse(body) : body;
      if (data.contents) {
        for (const c of data.contents) {
          if (c.role === "user" && c.parts) {
            c.parts = c.parts.map((p) =>
              p.text ? { ...p, text: anonymized } : p
            );
          }
        }
      }
      return JSON.stringify(data);
    } catch { return body; }
  }

  function injectCopilotAnonymized(body, anonymized) {
    try {
      const data = typeof body === "string" ? JSON.parse(body) : body;
      if (data.messages) {
        for (const m of data.messages) {
          if (m.author === "user" || m.role === "user") {
            if (m.text) m.text = anonymized;
            if (m.content) m.content = anonymized;
          }
        }
      }
      return JSON.stringify(data);
    } catch { return body; }
  }

  // ─── UI : Bandeau d'alerte ───────────────────────────────────
  function showBanner(findings, action, mappingCount) {
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

    // Mode anonymize → couleur teal (succès)
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

    let message = "";
    if (action === "ANONYMIZED") {
      message = `<strong>\u{1F6E1} ANONYMISÉ</strong> — ${mappingCount} donnée(s) remplacée(s) par des placeholders (${types})`;
    } else if (action === "BLOCKED") {
      message = `<strong>\u26D4 BLOQUÉ</strong> — ${totalPII} donnée(s) sensible(s) détectée(s) : ${types}<br><em>L'envoi a été bloqué par la politique de sécurité.</em>`;
    } else {
      message = `<strong>\u26A0\uFE0F ATTENTION</strong> — ${totalPII} donnée(s) sensible(s) détectée(s) : ${types}`;
    }

    banner.innerHTML = `
      <div style="flex:1">${message}</div>
      <div style="display:flex;align-items:center;gap:8px;margin-left:16px">
        <span style="font-size:11px;opacity:0.7">${ACTIVE_LLM.name}</span>
        <button onclick="this.closest('#llm-guard-banner').remove()" style="
          background: none; border: 1px solid ${c.border}; color: ${c.text};
          padding: 4px 12px; border-radius: 4px; cursor: pointer; font-size: 13px;
          white-space: nowrap;
        ">Fermer</button>
      </div>
    `;

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
      }, CONFIG.bannerDuration);
    }
  }

  // ─── Journalisation ──────────────────────────────────────────
  function logEvent(data) {
    const event = {
      timestamp: new Date().toISOString(),
      url: window.location.href,
      llm: ACTIVE_LLM.name,
      ...data,
    };
    window.postMessage(
      { source: "llm-guard", type: "log", payload: event },
      "*"
    );
    console.log(
      `%c[LLM Guard][${ACTIVE_LLM.name}]`,
      `color: ${ACTIVE_LLM.color}; font-weight: bold;`,
      event.action,
      event
    );
  }

  // ─── Monkey-patch fetch ──────────────────────────────────────
  const originalFetch = window.fetch;

  window.fetch = async function (input, init) {
    const url =
      typeof input === "string"
        ? input
        : input instanceof Request
          ? input.url
          : String(input);

    const method =
      init?.method || (input instanceof Request ? input.method : "GET");

    const isTarget =
      method.toUpperCase() === "POST" && ACTIVE_LLM.endpointMatch.test(url);

    if (!isTarget) {
      return originalFetch.apply(this, arguments);
    }

    // Extraire le body
    let bodyText = "";
    let fetchArgs = [input, init];
    try {
      if (init?.body) {
        if (typeof init.body === "string") {
          bodyText = init.body;
        } else if (init.body instanceof Blob) {
          bodyText = await init.body.text();
        } else if (init.body instanceof ReadableStream) {
          const [s1, s2] = init.body.tee();
          bodyText = await new Response(s1).text();
          init = { ...init, body: s2 };
          fetchArgs = [input, init];
        }
      } else if (input instanceof Request) {
        const cloned = input.clone();
        bodyText = await cloned.text();
        // Rebuild pour pouvoir modifier le body
        fetchArgs = [input.clone(), init];
      }
    } catch (e) {
      console.warn("[LLM Guard] Erreur lecture body:", e);
    }

    const promptText = ACTIVE_LLM.extractPrompt(bodyText);
    const findings = scanForPII(promptText);

    if (findings.length === 0) {
      logEvent({
        action: "CLEAN",
        endpoint: url,
        promptLength: promptText.length,
        findings: [],
        promptPreview: promptText.slice(0, 80) + (promptText.length > 80 ? "..." : ""),
      });
      return originalFetch.apply(this, fetchArgs);
    }

    const hasCritical = findings.some((f) => f.severity === "critical");

    // ── Mode BLOCK ──
    if (CONFIG.mode === "block" || (CONFIG.mode === "warn" && hasCritical)) {
      showBanner(findings, "BLOCKED", 0);
      logEvent({ action: "BLOCKED", endpoint: url, findings });
      return new Response(
        JSON.stringify({ error: "Bloqué par LLM Guard — données sensibles détectées." }),
        { status: 403, headers: { "Content-Type": "application/json" } }
      );
    }

    // ── Mode ANONYMIZE ──
    if (CONFIG.mode === "anonymize") {
      const { anonymized, mappings, changed } = anonymizeText(promptText);

      if (changed) {
        // Reconstruire le body avec le texte anonymisé
        const newBody = ACTIVE_LLM.injectAnonymized(bodyText, anonymized);
        fetchArgs = [url, { ...init, body: newBody }];

        showBanner(findings, "ANONYMIZED", mappings.size);
        logEvent({
          action: "ANONYMIZED",
          endpoint: url,
          promptLength: promptText.length,
          findings,
          mappingsCount: mappings.size,
          anonymizedPreview: anonymized.slice(0, 100) + "...",
        });

        return originalFetch.apply(this, fetchArgs);
      }
    }

    // ── Mode WARN ──
    showBanner(findings, "PII_DETECTED", 0);
    logEvent({
      action: "PII_DETECTED",
      endpoint: url,
      promptLength: promptText.length,
      findings,
      promptPreview: promptText.slice(0, 80) + "...",
    });

    return originalFetch.apply(this, fetchArgs);
  };

  // ─── Badge visuel ────────────────────────────────────────────
  function addStatusBadge() {
    const badge = document.createElement("div");
    badge.id = "llm-guard-badge";
    badge.title = `LLM Guard actif — ${ACTIVE_LLM.name} (mode: ${CONFIG.mode})`;
    badge.setAttribute("style", `
      position: fixed; bottom: 16px; right: 16px; z-index: 999998;
      width: 36px; height: 36px; border-radius: 50%;
      background: ${ACTIVE_LLM.color}; 
      display: flex; align-items: center; justify-content: center;
      font-size: 14px; cursor: pointer; color: white;
      box-shadow: 0 2px 8px rgba(0,0,0,0.3);
      transition: transform 0.2s;
      font-weight: bold; font-family: system-ui;
    `);
    badge.textContent = ACTIVE_LLM.name.charAt(0);
    badge.addEventListener("mouseenter", () => {
      badge.style.transform = "scale(1.15)";
    });
    badge.addEventListener("mouseleave", () => {
      badge.style.transform = "scale(1)";
    });

    if (document.body) {
      document.body.appendChild(badge);
    } else {
      document.addEventListener("DOMContentLoaded", () => {
        document.body.appendChild(badge);
      });
    }
  }

  addStatusBadge();
  console.log(
    `%c[LLM Guard] Actif sur ${ACTIVE_LLM.name} (mode: ${CONFIG.mode})`,
    `color: ${ACTIVE_LLM.color}; font-weight: bold; font-size: 13px;`
  );
})();
