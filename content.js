/**
 * LLM Guard v2 — Content Script
 * Multi-LLM (ChatGPT, Claude, Gemini, Copilot)
 * + Anonymisation automatique des PII
 * + Dé-anonymisation dans les réponses
 */

(function () {
  "use strict";

  // ─── Shared modules (loaded by manifest before this file) ──
  const { PII_PATTERNS } = window.__llmGuard.patterns;
  const { SENSITIVE_KEYWORDS } = window.__llmGuard.keywords;
  const { maskPII, levenshtein, normalize } = window.__llmGuard.utils;
  const { showBanner, addStatusBadge, logEvent } = window.__llmGuard.ui;
  const { CONTEXT_RULES } = window.__llmGuard.contextRules;
  const { SENSITIVE_KEYWORDS_CATEGORIZED } = window.__llmGuard.keywordsCategorized;
  const { extractPrompt, injectAnonymized, LLM_ADAPTERS } = window.__llmGuard.adapters;
  const { isAllowlisted } = window.__llmGuard.allowlist;
  const companyConfig = (window.__llmGuard.companyConfig) || { whitelist: [], blacklist: [], blacklistRegex: [] };

  // ─── Détection du LLM courant ────────────────────────────────
  const LLM_PROFILES = {
    chatgpt: {
      name: "ChatGPT",
      hostMatch: /chatgpt\.com|chat\.openai\.com/,
      endpointMatch: /\/conversation/,
      adapter: LLM_ADAPTERS.chatgpt,
      color: "#10A37F",
    },
    claude: {
      name: "Claude",
      hostMatch: /claude\.ai/,
      endpointMatch: /\/api\/.*(chat|completion|message|conversation)/,
      adapter: LLM_ADAPTERS.claude,
      color: "#D97706",
    },
    gemini: {
      name: "Gemini",
      hostMatch: /gemini\.google\.com/,
      endpointMatch: /\/generate|\/stream|BardChatUi/,
      adapter: LLM_ADAPTERS.gemini,
      color: "#4285F4",
    },
    copilot: {
      name: "Copilot",
      hostMatch: /copilot\.microsoft\.com/,
      endpointMatch: /\/api\/conversation|\/sydney/,
      adapter: LLM_ADAPTERS.copilot,
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
    mode: "anonymize",
    bannerDuration: 8000,
    maxMapSize: 500,
  };

  // Sync mode from storage via bridge
  window.addEventListener("message", (evt) => {
    if (evt.source !== window) return;
    if (evt.data?.source !== "llm-guard-bridge" || evt.data?.type !== "modeUpdate") return;
    const m = evt.data.mode;
    if (m === "anonymize" || m === "block") CONFIG.mode = m;
    const badge = document.getElementById("llm-guard-badge");
    if (badge) {
      badge.title = `LLM Guard — ${ACTIVE_LLM.name} | mode: ${CONFIG.mode} (cliquez pour changer)`;
      badge.style.background = CONFIG.mode === "block" ? "#A32D2D" : ACTIVE_LLM.color;
    }
  });

  window.postMessage({ source: "llm-guard", type: "getMode" }, window.location.origin);

  // ─── Anonymisation ───────────────────────────────────────────
  let anonymizationMap = new Map();
  let reverseMap = new Map();

  function trimMap(map, maxSize) {
    if (map.size <= maxSize) return;
    const excess = map.size - maxSize;
    const iter = map.keys();
    for (let i = 0; i < excess; i++) {
      map.delete(iter.next().value);
    }
  }

  function anonymizeText(text) {
    let result = text;
    const newMap = new Map();
    const newReverse = new Map();
    let globalCounter = 0;

    for (const pattern of PII_PATTERNS) {
      const regex = new RegExp(pattern.regex.source, pattern.regex.flags);
      let match;
      while ((match = regex.exec(result)) !== null) {
        const original = match[0];
        if (newReverse.has(original)) continue;
        if (isAllowlisted(original, pattern.name)) continue;

        globalCounter++;
        const placeholder = pattern.placeholder.replace("§", globalCounter);
        newMap.set(placeholder, original);
        newReverse.set(original, placeholder);
      }
    }

    const sortedEntries = [...newReverse.entries()].sort(
      (a, b) => b[0].length - a[0].length
    );
    for (const [original, placeholder] of sortedEntries) {
      result = result.split(original).join(placeholder);
    }

    anonymizationMap = new Map([...anonymizationMap, ...newMap]);
    reverseMap = new Map([...reverseMap, ...newReverse]);
    trimMap(anonymizationMap, CONFIG.maxMapSize);
    trimMap(reverseMap, CONFIG.maxMapSize);

    return { anonymized: result, mappings: newMap, changed: newMap.size > 0 };
  }

  function deanonymizeText(text) {
    let result = text;
    for (const [placeholder, original] of anonymizationMap) {
      result = result.split(placeholder).join(original);
    }
    return result;
  }

  // ─── Layer 3: Contextual scanning ────────────────────────────
  function scanContextual(text) {
    const findings = [];
    for (const rule of CONTEXT_RULES) {
      const indicators = Object.entries(rule).filter(
        ([k, v]) => k.endsWith("Indicators") && v instanceof RegExp
      );
      const allMatch = indicators.every(([, regex]) => regex.test(text));
      if (allMatch) {
        const evidence = indicators.map(([key, regex]) => {
          const match = text.match(regex);
          return { indicator: key.replace("Indicators", ""), match: match?.[0] };
        });
        findings.push({
          type: rule.name,
          severity: rule.severity,
          count: 1,
          samples: evidence.map((e) => e.match).filter(Boolean),
        });
      }
    }
    return findings;
  }

  // ─── Layer 2: Fuzzy keyword scanning ─────────────────────────
  function scanFuzzyKeywords(text) {
    const findings = [];
    const normalizedText = normalize(text);
    const words = text.toLowerCase().split(/\s+/);

    const allCategorizedKeywords = [...SENSITIVE_KEYWORDS_CATEGORIZED, ...companyConfig.blacklist];
    for (const kw of allCategorizedKeywords) {
      const normalizedKw = normalize(kw.term);

      if (normalizedText.includes(normalizedKw)) {
        findings.push({
          type: `Mot-clé: ${kw.term}`,
          severity: "medium",
          count: 1,
          samples: [kw.term],
        });
        continue;
      }

      if (!kw.term.includes(" ") && kw.term.length >= 5) {
        const threshold = kw.term.length <= 6 ? 1 : 2;
        for (const word of words) {
          const normalizedWord = normalize(word);
          if (Math.abs(normalizedWord.length - normalizedKw.length) > 2) continue;
          const distance = levenshtein(normalizedWord, normalizedKw);
          if (distance > 0 && distance <= threshold) {
            findings.push({
              type: `Mot-clé (approx): ${kw.term}`,
              severity: "low",
              count: 1,
              samples: [word],
            });
            break;
          }
        }
      }
    }
    return findings;
  }

  // ─── Scanner (all layers active) ─────────────────────────────
  function scanForPII(text) {
    const findings = [];

    // Layer 1: Regex
    for (const pattern of PII_PATTERNS) {
      const regex = new RegExp(pattern.regex.source, pattern.regex.flags);
      const matches = text.match(regex);
      if (matches) {
        const filtered = matches.filter((m) => !isAllowlisted(m, pattern.name));
        if (filtered.length > 0) {
          findings.push({
            type: pattern.name,
            severity: pattern.severity,
            count: filtered.length,
            samples: filtered.slice(0, 3).map(maskPII),
          });
        }
      }
    }

    // Layer 1.5: Simple keywords
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

    // Layer 1.6: Company blacklist regex patterns
    for (const entry of companyConfig.blacklistRegex) {
      try {
        const regex = new RegExp(entry.pattern, "gi");
        const matches = text.match(regex);
        if (matches && matches.length > 0) {
          findings.push({
            type: `Blacklist: ${entry.category}`,
            severity: entry.severity || "high",
            count: matches.length,
            samples: matches.slice(0, 3),
          });
        }
      } catch { /* skip invalid regex */ }
    }

    // Layer 2: Fuzzy keywords (includes company blacklist terms)
    findings.push(...scanFuzzyKeywords(text));

    // Layer 3: Contextual rules
    findings.push(...scanContextual(text));

    return findings;
  }

  // ─── Monkey-patch fetch ──────────────────────────────────────
  window.__originalFetch = window.fetch;
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

    // Extract body
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
        fetchArgs = [input.clone(), init];
      }
    } catch (e) {
      console.warn("[LLM Guard] Erreur lecture body:", e);
    }

    // Use generic adapter for prompt extraction
    const promptText = extractPrompt(bodyText, ACTIVE_LLM.adapter);
    const findings = scanForPII(promptText);

    if (findings.length === 0) {
      logEvent({
        action: "CLEAN",
        endpoint: url,
        promptLength: promptText.length,
        findings: [],
        promptPreview: promptText.slice(0, 80) + (promptText.length > 80 ? "..." : ""),
      }, ACTIVE_LLM);
      const response = await originalFetch.apply(this, fetchArgs);
      return wrapResponseForDeanonymization(response);
    }

    const hasCritical = findings.some((f) => f.severity === "critical");

    // ── Mode BLOCK ──
    if (CONFIG.mode === "block" || (CONFIG.mode === "warn" && hasCritical)) {
      showBanner(findings, "BLOCKED", 0, ACTIVE_LLM, CONFIG);
      logEvent({ action: "BLOCKED", endpoint: url, findings }, ACTIVE_LLM);
      return new Response(
        JSON.stringify({ error: "Bloqué par LLM Guard — données sensibles détectées." }),
        { status: 403, headers: { "Content-Type": "application/json" } }
      );
    }

    // ── Mode ANONYMIZE ──
    if (CONFIG.mode === "anonymize") {
      const { anonymized, mappings, changed } = anonymizeText(promptText);

      if (changed) {
        const newBody = injectAnonymized(bodyText, anonymized, ACTIVE_LLM.adapter);
        fetchArgs = [url, { ...init, body: newBody }];

        showBanner(findings, "ANONYMIZED", mappings.size, ACTIVE_LLM, CONFIG);
        logEvent({
          action: "ANONYMIZED",
          endpoint: url,
          promptLength: promptText.length,
          findings,
          mappingsCount: mappings.size,
          anonymizedPreview: anonymized.slice(0, 100) + "...",
        }, ACTIVE_LLM);

        const response = await originalFetch.apply(this, fetchArgs);
        return wrapResponseForDeanonymization(response);
      }
    }

    // ── Mode WARN ──
    showBanner(findings, "PII_DETECTED", 0, ACTIVE_LLM, CONFIG);
    logEvent({
      action: "PII_DETECTED",
      endpoint: url,
      promptLength: promptText.length,
      findings,
      promptPreview: promptText.slice(0, 80) + "...",
    }, ACTIVE_LLM);

    return originalFetch.apply(this, fetchArgs);
  };

  // ─── Response de-anonymization ───────────────────────────────
  // Wraps the LLM response to replace placeholders back to original values.
  // Only applies if we have active anonymization mappings.
  function wrapResponseForDeanonymization(response) {
    if (anonymizationMap.size === 0) return response;

    const originalBody = response.body;
    if (!originalBody) return response;

    const reader = originalBody.getReader();
    const decoder = new TextDecoder();
    const encoder = new TextEncoder();

    const stream = new ReadableStream({
      async pull(controller) {
        const { done, value } = await reader.read();
        if (done) {
          controller.close();
          return;
        }
        const text = decoder.decode(value, { stream: true });
        const restored = deanonymizeText(text);
        controller.enqueue(encoder.encode(restored));
      },
    });

    return new Response(stream, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  }

  // ─── Badge visuel ────────────────────────────────────────────
  addStatusBadge(ACTIVE_LLM, CONFIG, (newMode) => {
    window.postMessage({ source: "llm-guard", type: "setMode", mode: newMode }, window.location.origin);
  });

  console.log(
    `%c[LLM Guard] Actif sur ${ACTIVE_LLM.name} (mode: ${CONFIG.mode})`,
    `color: ${ACTIVE_LLM.color}; font-weight: bold; font-size: 13px;`
  );
})();
