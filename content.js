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
  const { maskPII, levenshtein, normalize, sha256Hex } = window.__llmGuard.utils;
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
    maxMapSize: 5000,
    layer4: { enabled: false, presidioUrl: "" },
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

  // Sync mode + layer4 config from storage via bridge
  window.addEventListener("message", (evt) => {
    if (evt.source !== window) return;
    if (evt.data?.source !== "llm-guard-bridge") return;

    if (evt.data.type === "modeUpdate") {
      const m = evt.data.mode;
      if (m === "anonymize" || m === "block") CONFIG.mode = m;
      const badge = document.getElementById("llm-guard-badge");
      if (badge) {
        badge.title = `LLM Guard — ${ACTIVE_LLM.name} | mode: ${CONFIG.mode} (cliquez pour changer)`;
        badge.style.background = CONFIG.mode === "block" ? "#A32D2D" : ACTIVE_LLM.color;
      }
    }

    if (evt.data.type === "layer4Update") {
      const next = evt.data.layer4 || {};
      const urlChanged = next.presidioUrl !== CONFIG.layer4.presidioUrl;
      CONFIG.layer4 = {
        enabled: !!next.enabled,
        presidioUrl: next.presidioUrl || "",
      };
      // Force re-init on next scan if URL changed or toggle flipped
      if (urlChanged) layer4Instance = null;
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
    onOverflow: (size) => {
      console.warn(`[LLM Guard] Anonymization map exceeded ${CONFIG.maxMapSize} entries; oldest mappings evicted. De-anonymization of old turns may fail.`);
      logEvent({ action: "MAP_OVERFLOW", mappingsCount: size }, ACTIVE_LLM);
    },
  });

  function anonymizeText(text) { return anonymizer.anonymize(text); }
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

  // ─── Layer 4: Local NLP (Presidio) ───────────────────────────
  let layer4Instance = null;
  let layer4InitPromise = null;

  async function getLayer4() {
    if (!CONFIG.layer4.enabled || !CONFIG.layer4.presidioUrl) return null;
    if (layer4Instance?.activeClassifier) return layer4Instance;
    if (layer4InitPromise) return layer4InitPromise;
    const factory = window.__llmGuard?.layer4?.Layer4Classifier;
    if (!factory) return null;
    layer4InitPromise = (async () => {
      const inst = new factory({
        presidioUrl: CONFIG.layer4.presidioUrl,
        enableBrowserNLP: false,
      });
      await inst.init();
      layer4Instance = inst;
      layer4InitPromise = null;
      return inst.activeClassifier ? inst : null;
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
          type: r.type,
          severity: r.severity || "medium",
          count: 1,
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

  // ─── Scanner (all layers active) ─────────────────────────────
  async function scanForPII(text) {
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

    // Layer 4: Local NLP (Presidio) — opt-in, configured in options page
    if (CONFIG.layer4.enabled) {
      findings.push(...(await scanLayer4(text)));
    }

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
      } catch { /* non-fatal */ }

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
        anonymizedText: scan.text ? anonymizeText(scan.text).anonymized : "",
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
      ensureAttachmentScan(f).catch(() => {});
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
            ensureAttachmentScan(f).catch(() => {});
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
          }).catch(() => {});
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

  console.log(
    `%c[LLM Guard] Actif sur ${ACTIVE_LLM.name} (mode: ${CONFIG.mode})`,
    `color: ${ACTIVE_LLM.color}; font-weight: bold; font-size: 13px;`
  );
})();
