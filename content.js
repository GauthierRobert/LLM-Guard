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
  const { maskPII, levenshtein, normalize, sha256Hex, fnv1aHex, createLRU } = window.__llmGuard.utils;
  const { showBanner, addStatusBadge, logEvent } = window.__llmGuard.ui;
  const { CONTEXT_RULES } = window.__llmGuard.contextRules;
  const { SENSITIVE_KEYWORDS_CATEGORIZED } = window.__llmGuard.keywordsCategorized;
  const { extractPrompt, injectAnonymized, LLM_ADAPTERS } = window.__llmGuard.adapters;
  const { isAllowlisted, isAttachmentAllowlisted } = window.__llmGuard.allowlist;
  const attachmentScanner = window.__llmGuard.attachmentScanner;
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
    mistral: {
      name: "Mistral",
      hostMatch: /chat\.mistral\.ai/,
      endpointMatch: /\/api\/(chat|conversation|completion)/i,
      adapter: LLM_ADAPTERS.mistral,
      color: "#FA5018",
      composerSelector: 'textarea[placeholder], div[contenteditable="true"]',
      conversationSelector: "main",
    },
    perplexity: {
      name: "Perplexity",
      hostMatch: /(^|\.)perplexity\.ai$/,
      endpointMatch: /\/rest\/sse\/perplexity_ask|\/api\/(save_ask|new_ask|search)/i,
      adapter: LLM_ADAPTERS.perplexity,
      color: "#20B8CD",
      composerSelector: 'textarea[placeholder*="Ask"], textarea',
      conversationSelector: "main",
    },
    deepseek: {
      name: "DeepSeek",
      hostMatch: /chat\.deepseek\.com/,
      endpointMatch: /\/api\/v\d+\/chat\/completion/i,
      adapter: LLM_ADAPTERS.deepseek,
      color: "#4D6BFE",
      composerSelector: 'textarea#chat-input, textarea',
      conversationSelector: "main",
    },
    grok: {
      name: "Grok",
      hostMatch: /(^|\.)grok\.com$|(^|\.)x\.ai$/,
      endpointMatch: /\/rest\/app-chat\/conversations|\/api\/(rpc|chat|conversation)/i,
      adapter: LLM_ADAPTERS.grok,
      color: "#1DA1F2",
      composerSelector: 'textarea[placeholder], div[contenteditable="true"]',
      conversationSelector: "main",
    },
  };

  // Composer + conversation selectors for the 4 original LLMs. Used by the
  // "visible" mode — must match the DOM node where the user types and where
  // assistant messages are rendered.
  LLM_PROFILES.chatgpt.composerSelector = '#prompt-textarea, textarea[data-id]';
  LLM_PROFILES.chatgpt.conversationSelector = 'main';
  LLM_PROFILES.claude.composerSelector = 'div[contenteditable="true"].ProseMirror, textarea';
  LLM_PROFILES.claude.conversationSelector = 'main';
  LLM_PROFILES.gemini.composerSelector = 'rich-textarea .ql-editor, div[contenteditable="true"]';
  LLM_PROFILES.gemini.conversationSelector = '#chat-history, main';
  LLM_PROFILES.copilot.composerSelector = '#userInput, textarea';
  LLM_PROFILES.copilot.conversationSelector = 'main';

  const currentHost = window.location.hostname;
  const ACTIVE_LLM = Object.values(LLM_PROFILES).find((p) =>
    p.hostMatch.test(currentHost)
  );

  if (!ACTIVE_LLM) return;

  // ─── Configuration ───────────────────────────────────────────
  const CONFIG = {
    mode: "anonymize",
    bannerDuration: 8000,
    maxMapSize: 5000,
    layer4: { enabled: false, presidioUrl: "", usePresidioAnonymizer: false },
    attachment: {
      enabled: true,
      mode: "inherit",
      maxSizeBytes: 20 * 1024 * 1024,
      maxChars: 200_000,
      types: { pdf: true, image: true, text: true },
    },
  };

  // Upload endpoints per LLM. Any POST/PUT matching one of these URL regexes
  // is inspected for File/Blob/FormData bodies even if the endpoint isn't the
  // normal prompt endpoint. The DOM-level hook is the happy path — this is
  // the safety net.
  const UPLOAD_URL_PATTERNS = [
    /\/backend-api\/files/i,
    /files\.oaiusercontent\.com/i,
    /\/api\/organizations\/[^/]+\/(upload|files)/i,
    /uploads?\.google\.com|upload\.googleusercontent\.com/i,
    /\/upload\/drive\/v3\/files/i,
    /blob\.core\.windows\.net/i,
  ];

  // Pending Presidio proxy requests: reqId → {resolve, reject, timer}
  const presidioRequestMap = new Map();
  let _presidioReqSeq = 0;

  // Sync mode + layer4 config from storage via bridge; also handles Presidio proxy responses.
  window.addEventListener("message", (evt) => {
    if (evt.source !== window) return;
    if (evt.data?.source !== "llm-guard-bridge") return;

    if (evt.data.type === "presidio.response") {
      const prom = presidioRequestMap.get(evt.data.reqId);
      if (!prom) return;
      presidioRequestMap.delete(evt.data.reqId);
      clearTimeout(prom.timer);
      // Resolve with the full envelope (including error) so callers can
      // distinguish HOST_PERMISSION_MISSING from network failures without
      // parsing Error.message strings.
      prom.resolve({ ok: !!evt.data.ok, data: evt.data.data, error: evt.data.error || null });
      return;
    }

    if (evt.data.type === "modeUpdate") {
      const m = evt.data.mode;
      if (m === "anonymize" || m === "block" || m === "visible") CONFIG.mode = m;
      const badge = document.getElementById("llm-guard-badge");
      if (badge) {
        badge.title = `LLM Guard — ${ACTIVE_LLM.name} | mode: ${CONFIG.mode} (cliquez pour changer)`;
        const bg = CONFIG.mode === "block" ? "#A32D2D"
          : CONFIG.mode === "visible" ? "#7C3AED"
          : ACTIVE_LLM.color;
        badge.style.background = bg;
      }
      // Ensure the reveal toggle button reflects the current mode.
      if (window.__llmGuard.ui.updateRevealButton) {
        window.__llmGuard.ui.updateRevealButton(CONFIG.mode === "visible");
      }
    }

    if (evt.data.type === "layer4Update") {
      const next = evt.data.layer4 || {};
      // Trim trailing slash so concatenating `/health`/`/analyze` never
      // produces `//health` (Presidio responds 404 on the double slash).
      const nextUrl = (next.presidioUrl || "").replace(/\/+$/, "");
      const urlChanged = nextUrl !== CONFIG.layer4.presidioUrl;
      const enabledChanged = !!next.enabled !== CONFIG.layer4.enabled;
      CONFIG.layer4 = {
        enabled: !!next.enabled,
        presidioUrl: nextUrl,
        usePresidioAnonymizer: !!next.usePresidioAnonymizer,
      };
      // Force re-init on next scan if URL changed or toggle flipped
      if (urlChanged) layer4Instance = null;
      if (urlChanged || enabledChanged) invalidateScanCache();
    }

    if (evt.data.type === "attachmentConfigUpdate") {
      const next = evt.data.attachment || {};
      CONFIG.attachment = {
        enabled: next.enabled !== false,
        mode: next.mode || "inherit",
        maxSizeBytes: Number.isFinite(next.maxSizeBytes) ? next.maxSizeBytes : CONFIG.attachment.maxSizeBytes,
        maxChars: Number.isFinite(next.maxChars) ? next.maxChars : CONFIG.attachment.maxChars,
        types: { ...CONFIG.attachment.types, ...(next.types || {}) },
      };
    }
  });

  window.postMessage({ source: "llm-guard", type: "getMode" }, window.location.origin);

  // ─── Anonymisation ───────────────────────────────────────────
  // Shared engine from anonymizer.js — see that file for the fix notes
  // on cross-prompt placeholder collisions and stream chunk-boundary loss.
  const anonymizer = window.__llmGuard.anonymizer.createAnonymizer({
    patterns: PII_PATTERNS,
    isAllowlisted,
    maxMapSize: CONFIG.maxMapSize,
    placeholderStrategy: "hashed",
    onOverflow: (size) => {
      console.warn(`[LLM Guard] Anonymization map exceeded ${CONFIG.maxMapSize} entries; oldest mappings evicted. De-anonymization of old turns may fail.`);
      logEvent({ action: "MAP_OVERFLOW", mappingsCount: size }, ACTIVE_LLM);
    },
  });

  // Per-session counters for Presidio NER placeholders ([PERSON_1], [ORG_2]…).
  // Never reset so placeholders stay unique across prompts within a session.
  const presidioEntityCounters = {};

  // Apply Presidio NER to find entities the regex engine missed, then register
  // them in the shared anonymizationMap so deanonymize() can reverse them.
  // Operates on locallyAnonymized (already regex-cleaned) but uses spans from
  // originalText so indices are correct.
  async function applyPresidioAnonymizer(locallyAnonymized, originalText) {
    const inst = await getLayer4();
    if (!inst?.analyzeSpans) return locallyAnonymized;

    const spans = await inst.analyzeSpans(originalText);
    if (!spans.length) return locallyAnonymized;

    // Longest spans first to avoid nested-replacement ordering issues
    spans.sort((a, b) => (b.end - b.start) - (a.end - a.start));

    let result = locallyAnonymized;
    for (const span of spans) {
      const original = originalText.slice(span.start, span.end).trim();
      if (!original || anonymizer.reverseMap.has(original)) continue;

      const type = (span.entity_type || "PII").toUpperCase();
      presidioEntityCounters[type] = (presidioEntityCounters[type] || 0) + 1;
      const placeholder = `[${type}_${presidioEntityCounters[type]}]`;

      anonymizer.registerExternalMapping(placeholder, original);
      result = result.split(original).join(placeholder);
    }
    return result;
  }

  async function anonymizeText(text) {
    const result = anonymizer.anonymize(text);
    if (CONFIG.layer4.enabled && CONFIG.layer4.usePresidioAnonymizer) {
      const further = await applyPresidioAnonymizer(result.anonymized, text);
      if (further !== result.anonymized) {
        return { anonymized: further, mappings: result.mappings, changed: true };
      }
    }
    return result;
  }

  function deanonymizeText(text) { return anonymizer.deanonymize(text); }

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
  // Two-pass: first an exact-substring sweep (O(n·k) where n = text length,
  // k = keyword count), then Levenshtein on word tokens. We skip the
  // expensive fuzzy pass once the text exceeds FUZZY_MAX_CHARS — the exact
  // pass still runs so we don't silently drop detections on large pastes.
  const FUZZY_MAX_CHARS = 50_000;

  function scanFuzzyKeywords(text) {
    const findings = [];
    const normalizedText = normalize(text);

    const allCategorizedKeywords = [...SENSITIVE_KEYWORDS_CATEGORIZED, ...companyConfig.blacklist];

    // Pre-filter: only keywords eligible for fuzzy (single word, ≥5 chars).
    // Doing this once avoids re-testing the predicate per-word-per-keyword.
    const fuzzyEligible = allCategorizedKeywords
      .filter((kw) => !kw.term.includes(" ") && kw.term.length >= 5)
      .map((kw) => ({
        term: kw.term,
        normalizedKw: normalize(kw.term),
        threshold: kw.term.length <= 6 ? 1 : 2,
      }));

    for (const kw of allCategorizedKeywords) {
      const normalizedKw = normalize(kw.term);
      if (normalizedText.includes(normalizedKw)) {
        findings.push({
          type: `Mot-clé: ${kw.term}`,
          severity: "medium",
          count: 1,
          samples: [kw.term],
        });
      }
    }

    // Skip the O(n·m) Levenshtein pass on huge payloads — the exact-match
    // sweep above already caught direct hits, so the cost of fuzzy isn't
    // worth 1-2s of main-thread latency on a 100KB paste.
    if (text.length > FUZZY_MAX_CHARS || fuzzyEligible.length === 0) return findings;

    const words = text.toLowerCase().split(/\s+/);
    const matchedTerms = new Set(findings.map((f) => f.type.replace(/^Mot-clé(?: \(approx\))?: /, "")));

    for (const { term, normalizedKw, threshold } of fuzzyEligible) {
      if (matchedTerms.has(term)) continue; // already hit exact pass
      for (const word of words) {
        const normalizedWord = normalize(word);
        if (Math.abs(normalizedWord.length - normalizedKw.length) > 2) continue;
        const distance = levenshtein(normalizedWord, normalizedKw, threshold);
        if (distance > 0 && distance <= threshold) {
          findings.push({
            type: `Mot-clé (approx): ${term}`,
            severity: "low",
            count: 1,
            samples: [word],
          });
          break;
        }
      }
    }
    return findings;
  }

  // ─── Layer 4: Presidio proxy ─────────────────────────────────
  // All HTTP calls are routed through the background service worker via
  // bridge.js so the page's Content Security Policy cannot block them.
  let layer4Instance = null;
  let layer4InitPromise = null;

  const PRESIDIO_ENTITIES = [
    "PERSON", "PHONE_NUMBER", "EMAIL_ADDRESS", "IBAN_CODE", "CREDIT_CARD",
    "LOCATION", "NRP", "MEDICAL_LICENSE", "ORGANIZATION", "DATE_TIME", "IP_ADDRESS",
  ];

  function presidioFetch(url, body, method) {
    const reqId = `pres-${++_presidioReqSeq}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        presidioRequestMap.delete(reqId);
        reject(new Error("Presidio proxy timeout"));
      }, 5000);
      presidioRequestMap.set(reqId, { resolve, reject, timer });
      window.postMessage(
        { source: "llm-guard", type: "presidio.fetch", reqId, url, body: body || null, method: method || "GET" },
        window.location.origin
      );
    });
  }

  function mapPresidioType(t) {
    return { PERSON: "Nom de personne", PHONE_NUMBER: "Téléphone", EMAIL_ADDRESS: "Email",
      IBAN_CODE: "IBAN", CREDIT_CARD: "Carte bancaire", LOCATION: "Lieu",
      NRP: "Nationalité/Religion/Politique", ORGANIZATION: "Organisation",
      DATE_TIME: "Date", IP_ADDRESS: "Adresse IP" }[t] || t;
  }

  function mapPresidioSeverity(t) {
    return { PERSON: "high", PHONE_NUMBER: "high", EMAIL_ADDRESS: "high",
      IBAN_CODE: "critical", CREDIT_CARD: "critical", LOCATION: "medium",
      NRP: "high", ORGANIZATION: "medium", DATE_TIME: "low", IP_ADDRESS: "low" }[t] || "medium";
  }

  function createPresidioProxy(analyzerUrl) {
    let _ready = false;
    const base = analyzerUrl.replace(/\/+$/, "");
    return {
      get ready() { return _ready; },
      async init() {
        try {
          const resp = await presidioFetch(`${base}/health`);
          _ready = !!resp.ok;
          if (_ready) {
            console.log("[LLM Guard] Presidio connecté (proxy background)");
          } else if (resp.error === "HOST_PERMISSION_MISSING") {
            console.warn(
              "[LLM Guard] Presidio: permission d'accès non accordée pour " + base +
              ". Ouvrez la page Options et cliquez « Tester » pour autoriser."
            );
          } else {
            console.warn("[LLM Guard] Presidio non accessible:", resp.error || "inconnu");
          }
        } catch (err) {
          _ready = false;
          console.warn("[LLM Guard] Presidio non accessible:", err?.message || err);
        }
      },
      async classify(text) {
        if (!_ready) return [];
        try {
          const resp = await presidioFetch(`${base}/analyze`,
            { text, language: "fr", entities: PRESIDIO_ENTITIES, score_threshold: 0.6 }, "POST");
          if (!resp.ok || !Array.isArray(resp.data)) {
            if (resp.error) console.warn("[LLM Guard] Presidio /analyze failed:", resp.error);
            return [];
          }
          return resp.data.map(r => ({
            layer: "presidio", type: mapPresidioType(r.entity_type),
            severity: mapPresidioSeverity(r.entity_type), confidence: r.score,
            matches: [text.slice(r.start, r.end)], start: r.start, end: r.end,
          }));
        } catch (err) {
          console.warn("[LLM Guard] Presidio classify error:", err?.message || err);
          return [];
        }
      },
      async analyzeSpans(text) {
        if (!_ready) return [];
        try {
          const resp = await presidioFetch(`${base}/analyze`,
            { text, language: "fr", entities: PRESIDIO_ENTITIES, score_threshold: 0.6 }, "POST");
          if (!resp.ok && resp.error) console.warn("[LLM Guard] Presidio /analyze failed:", resp.error);
          return (resp.ok && Array.isArray(resp.data)) ? resp.data : [];
        } catch (err) {
          console.warn("[LLM Guard] Presidio analyzeSpans error:", err?.message || err);
          return [];
        }
      },
    };
  }

  async function getLayer4() {
    if (!CONFIG.layer4.enabled || !CONFIG.layer4.presidioUrl) return null;
    if (layer4Instance?.ready) return layer4Instance;
    if (layer4InitPromise) return layer4InitPromise;
    // Always clear layer4InitPromise on settle so a transient Presidio outage
    // doesn't permanently block re-init on the next scan.
    layer4InitPromise = (async () => {
      try {
        const proxy = createPresidioProxy(CONFIG.layer4.presidioUrl);
        await proxy.init();
        layer4Instance = proxy.ready ? proxy : null;
        return layer4Instance;
      } finally {
        layer4InitPromise = null;
      }
    })();
    return layer4InitPromise;
  }

  async function scanLayer4(text) {
    const inst = await getLayer4();
    if (!inst) return [];
    try {
      const raw = await inst.classify(text);
      const findings = [];
      for (const r of raw) {
        const sample = (r.matches && r.matches[0]) || "";
        if (sample && isAllowlisted(sample, r.type)) continue;
        findings.push({
          type: r.type, severity: r.severity || "medium", count: 1,
          samples: r.matches ? r.matches.map(maskPII) : [],
          layer: r.layer || "layer4",
        });
      }
      return findings;
    } catch (err) {
      console.warn("[LLM Guard] Layer 4 scan failed:", err?.message || err);
      return [];
    }
  }

  // ─── Detection cache ─────────────────────────────────────────
  // Short-circuits the full pipeline when the same prompt is scanned twice
  // in quick succession. Typical triggers: a user clicks Send twice, the
  // site retries a failed request, or a streaming UI resubmits the prompt.
  // Cleared when layer4 or attachment config changes — those are the only
  // config knobs that affect findings.
  const scanCache = createLRU(200);
  const cacheKey = (text) => fnv1aHex(text) + ":" + fnv1aHex(text.length + "|" + (CONFIG.layer4.enabled ? 1 : 0));
  function invalidateScanCache() { scanCache.clear(); }

  // Pre-compiled Layer 1 regexes — recompiling per scan was the hot path for
  // large prompts. Patterns are data, so the underlying RegExp objects are
  // safe to share across calls as long as we don't rely on lastIndex state
  // (we use text.match(), which resets it).
  const COMPILED_PII_PATTERNS = PII_PATTERNS.map((p) => ({
    ...p,
    compiledRegex: new RegExp(p.regex.source, p.regex.flags),
  }));

  // Context gate for SIRET/SIREN: the underlying 9/14-digit regex with Luhn
  // still accepts ~10% of random numbers. Only promote the match if one of
  // the French business-ID keywords sits within 40 chars on either side.
  // This kills the dominant false-positive class (phone numbers, order IDs,
  // timestamps) without losing real business-ID mentions.
  const BUSINESS_CONTEXT_REGEX = /(SIREN|SIRET|RCS|SARL|SASU?|SA\b|EURL|SNC|SCI|SCOP|TVA|immatricul|soci[ée]t[ée]|entreprise|registre du commerce|num[ée]ro d'entreprise)/i;
  function hasBusinessContext(text, matchIndex, matchLen) {
    const start = Math.max(0, matchIndex - 40);
    const end = Math.min(text.length, matchIndex + matchLen + 40);
    return BUSINESS_CONTEXT_REGEX.test(text.slice(start, end));
  }

  // ─── Scanner (all layers active) ─────────────────────────────
  // Wraps each layer in an error boundary so a single bug (e.g. a malformed
  // company regex, an unexpected text encoding, a Presidio outage) degrades
  // gracefully instead of silently killing the whole pipeline. If any layer
  // throws, we log it and continue with the other layers. Callers check
  // `scanResult.layerErrors` to warn the user when detection is partial.
  async function scanForPII(text) {
    const key = cacheKey(text);
    const cached = scanCache.get(key);
    if (cached) return cached.map((f) => ({ ...f, cached: true }));

    const findings = [];
    const layerErrors = [];

    // Layer 1: Regex. `pattern.validate` is an optional post-match hook that
    // drops structurally-plausible but semantically invalid matches (Luhn,
    // octet bounds, reserved example domains, etc.).
    try {
      for (const pattern of COMPILED_PII_PATTERNS) {
        const matches = text.match(pattern.compiledRegex);
        if (!matches) continue;
        const isBusinessId = pattern.name === "SIREN" || pattern.name === "SIRET";
        const filtered = matches.filter((m) => {
          if (isAllowlisted(m, pattern.name)) return false;
          if (typeof pattern.validate === "function" && !pattern.validate(m)) return false;
          if (isBusinessId) {
            const idx = text.indexOf(m);
            if (idx < 0 || !hasBusinessContext(text, idx, m.length)) return false;
          }
          return true;
        });
        if (filtered.length > 0) {
          findings.push({
            type: pattern.name,
            severity: pattern.severity,
            count: filtered.length,
            samples: filtered.slice(0, 3).map(maskPII),
          });
        }
      }
    } catch (err) {
      console.warn("[LLM Guard] Layer 1 regex scan failed:", err?.message || err);
      layerErrors.push({ layer: 1, error: String(err?.message || err) });
    }

    // Layer 1.5: Simple keywords
    try {
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
    } catch (err) {
      console.warn("[LLM Guard] Layer 1.5 keyword scan failed:", err?.message || err);
      layerErrors.push({ layer: 1.5, error: String(err?.message || err) });
    }

    // Layer 1.6: Company blacklist regex patterns
    try {
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
        } catch { /* skip invalid regex (per-entry) */ }
      }
    } catch (err) {
      console.warn("[LLM Guard] Layer 1.6 blacklist scan failed:", err?.message || err);
      layerErrors.push({ layer: 1.6, error: String(err?.message || err) });
    }

    // Layer 2: Fuzzy keywords (includes company blacklist terms)
    try {
      findings.push(...scanFuzzyKeywords(text));
    } catch (err) {
      console.warn("[LLM Guard] Layer 2 fuzzy scan failed:", err?.message || err);
      layerErrors.push({ layer: 2, error: String(err?.message || err) });
    }

    // Layer 3: Contextual rules
    try {
      findings.push(...scanContextual(text));
    } catch (err) {
      console.warn("[LLM Guard] Layer 3 contextual scan failed:", err?.message || err);
      layerErrors.push({ layer: 3, error: String(err?.message || err) });
    }

    // Layer 4: Local NLP (Presidio) — opt-in, configured in options page
    if (CONFIG.layer4.enabled) {
      try {
        findings.push(...(await scanLayer4(text)));
      } catch (err) {
        console.warn("[LLM Guard] Layer 4 scan failed:", err?.message || err);
        layerErrors.push({ layer: 4, error: String(err?.message || err) });
      }
    }

    if (layerErrors.length > 0) {
      // Mark the first finding (or synthesize a marker) so the banner can
      // warn the user that detection was partial. Don't cache failures so
      // a transient error resolves on the next scan.
      findings.__layerErrors = layerErrors;
      return findings;
    }

    scanCache.set(key, findings);
    return findings;
  }

  // ─── Attachment handling ─────────────────────────────────────
  // WeakMap so GC can reclaim entries once the File goes out of scope.
  const attachmentScanCache = new WeakMap();

  function resolveAttachmentMode() {
    const m = CONFIG.attachment.mode;
    if (m === "block" || m === "warn") return m;
    // inherit: map global mode. "anonymize" => block (binary can't be anonymized in place).
    return CONFIG.mode === "block" || CONFIG.mode === "anonymize" ? "block" : "warn";
  }

  async function ensureAttachmentScan(file) {
    if (!attachmentScanner || !CONFIG.attachment.enabled) return null;
    const cached = attachmentScanCache.get(file);
    if (cached) return cached;

    const promise = (async () => {
      const scan = await attachmentScanner.scanAttachment(file, {
        maxSizeBytes: CONFIG.attachment.maxSizeBytes,
        maxChars: CONFIG.attachment.maxChars,
        types: CONFIG.attachment.types,
      });

      let sha256 = "";
      try {
        const buf = await file.arrayBuffer();
        sha256 = await sha256Hex(buf);
      } catch (err) {
        console.warn(`[LLM Guard] sha256 hash failed for ${file?.name || "unknown file"}:`, err?.message || err);
      }

      const allowlisted = sha256 && isAttachmentAllowlisted(sha256, scan.filename);
      const findings = (!allowlisted && scan.text) ? await scanForPII(scan.text) : [];

      return {
        sha256,
        allowlisted,
        filename: scan.filename,
        mimeType: scan.mimeType,
        sizeBytes: scan.sizeBytes,
        extractorId: scan.extractorId,
        truncated: !!scan.truncated,
        unavailable: !!scan.unavailable,
        passwordProtected: !!scan.passwordProtected,
        skipped: !!scan.skipped,
        reason: scan.reason,
        extractedChars: (scan.text || "").length,
        findings,
        anonymizedText: scan.text ? (await anonymizeText(scan.text)).anonymized : "",
      };
    })();

    attachmentScanCache.set(file, promise);
    return promise;
  }

  async function scanAttachmentsForRequest(files) {
    const results = [];
    for (const f of files) {
      try {
        const r = await ensureAttachmentScan(f);
        if (r) results.push(r);
      } catch (err) {
        console.warn("[LLM Guard] attachment scan error:", err?.message || err);
      }
    }
    return results;
  }

  /**
   * Decide what to do with a request that carries attachments.
   * Returns `{ block: boolean, results }` — when `block` is true the caller
   * should short-circuit the upload with a 403-style response.
   */
  async function handleAttachmentRequest(files, url) {
    const results = await scanAttachmentsForRequest(files);
    if (results.length === 0) return { block: false, results };

    const anyFindings = results.some((r) => r.findings.length > 0);
    const anyUnscanned = results.some((r) => r.unavailable || r.passwordProtected);

    if (!anyFindings && !anyUnscanned) {
      for (const r of results) {
        logEvent({
          action: "ATTACHMENT_CLEAN",
          endpoint: url,
          findings: [],
          attachment: attachmentLogPayload(r),
        }, ACTIVE_LLM);
      }
      return { block: false, results };
    }

    const mode = resolveAttachmentMode();
    const shouldBlock = mode === "block" && anyFindings;
    const primary = results.find((r) => r.findings.length > 0) || results[0];
    const combinedFindings = results.flatMap((r) => r.findings);

    showBanner(combinedFindings, shouldBlock ? "ATTACHMENT_BLOCKED" : "ATTACHMENT_DETECTED", 0, ACTIVE_LLM, CONFIG, {
      filename: primary.filename,
      sizeBytes: primary.sizeBytes,
      mimeType: primary.mimeType,
      truncated: primary.truncated,
      unavailable: primary.unavailable,
      passwordProtected: primary.passwordProtected,
      anonymizedText: primary.anonymizedText,
      sha256: primary.sha256,
    });

    for (const r of results) {
      logEvent({
        action: shouldBlock ? "ATTACHMENT_BLOCKED" : (r.findings.length > 0 ? "ATTACHMENT_PII_DETECTED" : "ATTACHMENT_UNSCANNED"),
        endpoint: url,
        findings: r.findings,
        attachment: attachmentLogPayload(r),
      }, ACTIVE_LLM);
    }

    return { block: shouldBlock, results };
  }

  function attachmentLogPayload(r) {
    return {
      sha256: r.sha256 || "",
      mimeType: r.mimeType || "",
      sizeBytes: r.sizeBytes || 0,
      extractedChars: r.extractedChars || 0,
      truncated: !!r.truncated,
      extractorId: r.extractorId || null,
      unavailable: !!r.unavailable,
      passwordProtected: !!r.passwordProtected,
    };
  }

  function looksLikeUploadUrl(url) {
    if (!url) return false;
    return UPLOAD_URL_PATTERNS.some((re) => re.test(url));
  }

  // ─── DOM hooks: pre-scan files as soon as the user attaches them ──
  function prescanFiles(fileList) {
    if (!fileList || !fileList.length) return;
    if (!CONFIG.attachment.enabled) return;
    for (const f of fileList) {
      // Kick off scans eagerly — results land in the WeakMap for the
      // fetch/XHR patches to pick up when the site actually uploads.
      ensureAttachmentScan(f).catch((err) => {
        console.warn(`[LLM Guard] prescan failed for ${f?.name || "unknown file"}:`, err?.message || err);
      });
    }
  }

  document.addEventListener("change", (e) => {
    const t = e.target;
    if (t && t.tagName === "INPUT" && t.type === "file") {
      prescanFiles(t.files);
    }
  }, true);

  document.addEventListener("paste", (e) => {
    const items = e.clipboardData?.files;
    if (items && items.length) prescanFiles(items);
  }, true);

  document.addEventListener("drop", (e) => {
    const items = e.dataTransfer?.files;
    if (items && items.length) prescanFiles(items);
  }, true);

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

    // ── Attachment upload branch ──
    if (CONFIG.attachment.enabled && attachmentScanner && init?.body) {
      const files = attachmentScanner.collectFiles(init.body);
      if (files.length > 0 || looksLikeUploadUrl(url)) {
        // Collect files from Request body if it's wrapped
        const result = await handleAttachmentRequest(files, url);
        if (result.block) {
          return new Response(
            JSON.stringify({ error: "Bloqué par LLM Guard — pièce jointe contenant des données sensibles." }),
            { status: 403, headers: { "Content-Type": "application/json" } }
          );
        }
      }
    }

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
    const findings = await scanForPII(promptText);

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

    // ── Mode ANONYMIZE / VISIBLE ──
    // Both modes anonymize the outgoing body identically; they differ only in
    // how the response is rendered (see wrapResponseForDeanonymization and
    // the "visible" gate below).
    if (CONFIG.mode === "anonymize" || CONFIG.mode === "visible") {
      const { anonymized, mappings, changed } = await anonymizeText(promptText);

      if (changed) {
        const newBody = injectAnonymized(bodyText, anonymized, ACTIVE_LLM.adapter);
        fetchArgs = [url, { ...init, body: newBody }];

        showBanner(findings, "ANONYMIZED", mappings.size, ACTIVE_LLM, CONFIG);
        logEvent({
          action: "ANONYMIZED",
          endpoint: url,
          mode: CONFIG.mode,
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

  // ─── XHR wrapper (upload safety net) ─────────────────────────
  // Some LLMs (notably Gemini Drive uploads) use XMLHttpRequest instead of
  // fetch. We enforce block mode only when a pre-scan result is already in
  // the cache — XHR.send() is effectively synchronous so we can't await a
  // scan without breaking page semantics. Cache hits come from the DOM hook.
  const OriginalXHR = window.XMLHttpRequest;
  if (OriginalXHR && OriginalXHR.prototype) {
    const originalSend = OriginalXHR.prototype.send;
    OriginalXHR.prototype.send = function (body) {
      if (CONFIG.attachment.enabled && attachmentScanner && body) {
        const files = attachmentScanner.collectFiles(body);
        for (const f of files) {
          const cached = attachmentScanCache.get(f);
          if (!cached) {
            // No pre-scan: kick one off for telemetry; can't block this send.
            ensureAttachmentScan(f).catch((err) => {
              console.warn(`[LLM Guard] XHR late-scan failed for ${f?.name || "unknown file"}:`, err?.message || err);
            });
            continue;
          }
          cached.then((r) => {
            if (r && r.findings.length > 0) {
              const mode = resolveAttachmentMode();
              const action = mode === "block" ? "ATTACHMENT_BLOCKED" : "ATTACHMENT_PII_DETECTED";
              showBanner(r.findings, action, 0, ACTIVE_LLM, CONFIG, {
                filename: r.filename,
                sizeBytes: r.sizeBytes,
                mimeType: r.mimeType,
                truncated: r.truncated,
                anonymizedText: r.anonymizedText,
                sha256: r.sha256,
              });
              logEvent({
                action,
                endpoint: this.__llmGuardUrl || "",
                findings: r.findings,
                attachment: attachmentLogPayload(r),
              }, ACTIVE_LLM);
              if (mode === "block") {
                try { this.abort(); } catch { /* already sent */ }
              }
            }
          }).catch((err) => {
            console.warn("[LLM Guard] XHR post-scan error:", err?.message || err);
          });
        }
      }
      return originalSend.apply(this, arguments);
    };

    const originalOpen = OriginalXHR.prototype.open;
    OriginalXHR.prototype.open = function (method, url) {
      this.__llmGuardUrl = url;
      return originalOpen.apply(this, arguments);
    };
  }

  // ─── Response de-anonymization ───────────────────────────────
  // Buffers across chunks so a placeholder split across a boundary
  // (e.g. "[EMA" | "IL_1]") is still restored. The buffering rule lives
  // in anonymizer.js (makeStreamDeanonymizer).
  function wrapResponseForDeanonymization(response) {
    // In "visible" mode the user opted into seeing placeholders in the
    // rendered response — the reveal button does the restore on demand.
    if (CONFIG.mode === "visible") return response;
    if (anonymizer.anonymizationMap.size === 0) return response;

    const originalBody = response.body;
    if (!originalBody) return response;

    const reader = originalBody.getReader();
    const decoder = new TextDecoder();
    const encoder = new TextEncoder();
    const streamDeanon = anonymizer.makeStreamDeanonymizer();

    const stream = new ReadableStream({
      async pull(controller) {
        const { done, value } = await reader.read();
        if (done) {
          const trailing = decoder.decode();
          const emit = (trailing ? streamDeanon.push(trailing) : "") + streamDeanon.flush();
          if (emit.length > 0) controller.enqueue(encoder.encode(emit));
          controller.close();
          return;
        }
        const emit = streamDeanon.push(decoder.decode(value, { stream: true }));
        if (emit.length > 0) controller.enqueue(encoder.encode(emit));
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

  // ─── Visible mode: composer pre-send anonymization ──────────
  // Replace PII in the composer DOM node with placeholders right before the
  // user submits, so they see [EMAIL_1] etc. The fetch intercept is idempotent
  // on placeholders, so no double-encoding.
  function rewriteComposerWithPlaceholders() {
    if (CONFIG.mode !== "visible") return;
    const selector = ACTIVE_LLM.composerSelector;
    if (!selector) return;
    const nodes = document.querySelectorAll(selector);
    for (const el of nodes) {
      const isTextarea = el.tagName === "TEXTAREA" || el.tagName === "INPUT";
      const value = isTextarea ? el.value : el.innerText;
      if (!value || !value.trim()) continue;
      // Use the synchronous regex anonymizer directly (skip the async
      // Presidio augmentation). The composer rewrite fires during Enter /
      // Send-click capture-phase handlers and must complete before the
      // framework reads the value, so any `await` races the submit. The
      // outgoing fetch intercept still runs the full async pipeline for
      // the wire payload — this pass is only for what the user sees.
      const { anonymized, changed } = anonymizer.anonymize(value);
      if (!changed) continue;
      if (isTextarea) {
        // React-controlled inputs: use the native setter so the change event
        // propagates through React's synthetic handler.
        const setter = Object.getOwnPropertyDescriptor(
          el.tagName === "TEXTAREA" ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype,
          "value"
        )?.set;
        if (setter) setter.call(el, anonymized);
        else el.value = anonymized;
        el.dispatchEvent(new Event("input", { bubbles: true }));
      } else {
        el.innerText = anonymized;
        el.dispatchEvent(new Event("input", { bubbles: true }));
      }
    }
  }

  // Hook submit paths: Enter key on the composer, and Send button click.
  document.addEventListener("keydown", (e) => {
    if (CONFIG.mode !== "visible") return;
    if (e.key !== "Enter" || e.shiftKey || e.isComposing) return;
    const target = e.target;
    if (!target || !target.matches) return;
    if (target.matches(ACTIVE_LLM.composerSelector || "textarea")) {
      rewriteComposerWithPlaceholders();
    }
  }, true);

  document.addEventListener("click", (e) => {
    if (CONFIG.mode !== "visible") return;
    const btn = e.target && e.target.closest && e.target.closest('button[type="submit"], button[aria-label*="Send" i], button[data-testid*="send" i], button[aria-label*="Envoyer" i]');
    if (btn) rewriteComposerWithPlaceholders();
  }, true);

  // React/Vue/Angular often re-render controlled inputs milliseconds after
  // we write a placeholder, rolling back our value before the fetch fires.
  // A focused MutationObserver on the composer subtree re-applies the
  // placeholders whenever the framework mutates the field. Scoped to the
  // composer selector so we don't observe the whole document (costly) and
  // only active in visible mode.
  let composerObserver = null;
  let composerObserverReschedule = null;
  function ensureComposerObserver() {
    if (CONFIG.mode !== "visible") {
      if (composerObserver) {
        composerObserver.disconnect();
        composerObserver = null;
      }
      return;
    }
    if (composerObserver) return;
    const selector = ACTIVE_LLM.composerSelector;
    if (!selector) return;
    const target = document.querySelector(selector);
    if (!target) {
      // Not mounted yet — try again shortly. Backoff once to avoid thrashing.
      if (!composerObserverReschedule) {
        composerObserverReschedule = setTimeout(() => {
          composerObserverReschedule = null;
          ensureComposerObserver();
        }, 1000);
      }
      return;
    }
    let pending = false;
    composerObserver = new MutationObserver(() => {
      if (pending) return;
      pending = true;
      // Coalesce bursts (one re-render can fire 10+ mutations) so we only
      // run the rewrite once per animation frame.
      requestAnimationFrame(() => {
        pending = false;
        rewriteComposerWithPlaceholders();
      });
    });
    composerObserver.observe(target, {
      childList: true,
      characterData: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["value"],
    });
  }
  ensureComposerObserver();
  // Re-check periodically: single-page apps mount/unmount the composer on
  // route changes. 2s is slow enough to be negligible and fast enough that
  // users don't notice the gap after navigation.
  setInterval(ensureComposerObserver, 2000);

  // ─── Visible mode: floating Reveal/Hide button ──────────────
  if (window.__llmGuard.ui.addRevealToggleButton) {
    window.__llmGuard.ui.addRevealToggleButton({
      activeLLM: ACTIVE_LLM,
      isVisibleMode: () => CONFIG.mode === "visible",
      anonymizer,
    });
  }

  // ─── Visible mode: conversation observer ────────────────────
  // Without continuous re-application, two things break in visible mode:
  //  1. LLM streaming writes new tokens into existing text nodes, clobbering
  //     any placeholder→original rewrite the user triggered via the reveal
  //     button. After a few tokens the DOM "un-reveals" itself.
  //  2. The user's own message bubble is rendered by the LLM site from raw
  //     input (not from our anonymized wire payload), so it keeps showing
  //     real PII even though visible mode promises placeholders.
  // The observer below runs on every conversation mutation and calls the
  // ui helper, which re-applies the current reveal state (hide by default,
  // show when the user has toggled reveal on).
  let conversationObserver = null;
  let conversationReapplyScheduled = false;
  function ensureConversationObserver() {
    if (CONFIG.mode !== "visible") {
      if (conversationObserver) {
        conversationObserver.disconnect();
        conversationObserver = null;
      }
      return;
    }
    if (conversationObserver) return;
    const sel = ACTIVE_LLM.conversationSelector || "main";
    const target = document.querySelector(sel) || document.body;
    if (!target) return;
    conversationObserver = new MutationObserver(() => {
      if (conversationReapplyScheduled) return;
      conversationReapplyScheduled = true;
      // Coalesce streaming bursts — one token can fire many mutations.
      requestAnimationFrame(() => {
        conversationReapplyScheduled = false;
        if (window.__llmGuard.ui.reapplyRevealState) {
          window.__llmGuard.ui.reapplyRevealState();
        }
      });
    });
    conversationObserver.observe(target, {
      childList: true,
      characterData: true,
      subtree: true,
    });
  }
  ensureConversationObserver();
  setInterval(ensureConversationObserver, 2000);

  console.log(
    `%c[LLM Guard] Actif sur ${ACTIVE_LLM.name} (mode: ${CONFIG.mode})`,
    `color: ${ACTIVE_LLM.color}; font-weight: bold; font-size: 13px;`
  );
})();
