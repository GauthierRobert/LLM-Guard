/**
 * LLM Guard -- Allowlist / Exemptions
 * Patterns and domains that should skip PII scanning.
 * Users can add entries via chrome.storage (popup UI).
 */
(function () {
  "use strict";

  // Default allowlist — these are never flagged
  const DEFAULT_ALLOWLIST = [
    // Example: company domains that are safe to mention
    // { type: "domain", pattern: "example.com" },
    // { type: "email", pattern: /.*@example\.com/i },
    // { type: "keyword", pattern: "safe-project-name" },
  ];

  let companyAllowlist = [];
  let customAllowlist = [];

  /**
   * Parse allowlist entries, converting isRegex entries to RegExp objects.
   */
  function parseEntries(entries) {
    return (entries || []).map((entry) => {
      if (entry.isRegex) {
        try {
          return { type: entry.type, pattern: new RegExp(entry.pattern, "i") };
        } catch {
          return { type: entry.type, pattern: entry.pattern };
        }
      }
      return { type: entry.type, pattern: entry.pattern };
    });
  }

  // Rules that threw when tested are disabled for the rest of the session so
  // subsequent `isAllowlisted` calls don't re-throw in the hot path. We keep
  // the Set keyed by the rule object so a storage reload (which rebuilds the
  // rule objects via `parseEntries`) automatically clears the blacklist.
  const disabledRules = new WeakSet();

  function testRule(rule, matchedText) {
    if (disabledRules.has(rule)) return false;
    try {
      if (rule.pattern instanceof RegExp) {
        return rule.pattern.test(matchedText);
      }
      if (typeof rule.pattern === "string") {
        return matchedText.toLowerCase().includes(rule.pattern.toLowerCase());
      }
      return false;
    } catch (err) {
      disabledRules.add(rule);
      try {
        console.warn(
          "[LLM Guard] allowlist rule threw and was disabled for this session:",
          { type: rule.type, pattern: String(rule.pattern), error: err && err.message }
        );
      } catch { /* console missing — non-fatal */ }
      return false;
    }
  }

  /**
   * Check if a text match should be exempted from PII detection.
   * @param {string} matchedText - The detected PII text
   * @param {string} piiType - The type of PII detected (e.g., "Email", "Téléphone FR")
   * @returns {boolean} true if the match should be skipped
   */
  function isAllowlisted(matchedText, piiType) {
    const allRules = [...DEFAULT_ALLOWLIST, ...companyAllowlist, ...customAllowlist];
    for (const rule of allRules) {
      if (testRule(rule, matchedText)) return true;
    }
    return false;
  }

  /**
   * Load company whitelist from build-time config.
   */
  function loadCompanyAllowlist(entries) {
    companyAllowlist = parseEntries(entries);
  }

  /**
   * Update custom allowlist from chrome.storage.
   * Called on startup and when storage changes.
   */
  function loadAllowlist(entries) {
    customAllowlist = parseEntries(entries);
  }

  /**
   * Check whether a previously-scanned attachment was marked safe.
   * The "mark safe" action in the banner stores an entry of the form
   * `{ type: "attachment", pattern: "<sha256>" }`.
   */
  function isAttachmentAllowlisted(sha256, filename) {
    const allRules = [...DEFAULT_ALLOWLIST, ...companyAllowlist, ...customAllowlist];
    for (const rule of allRules) {
      if (rule.type !== "attachment") continue;
      if (disabledRules.has(rule)) continue;
      try {
        if (rule.pattern instanceof RegExp) {
          if (rule.pattern.test(sha256) || (filename && rule.pattern.test(filename))) return true;
        } else if (typeof rule.pattern === "string") {
          if (rule.pattern === sha256) return true;
          if (filename && rule.pattern.toLowerCase() === String(filename).toLowerCase()) return true;
        }
      } catch (err) {
        disabledRules.add(rule);
        try {
          console.warn(
            "[LLM Guard] attachment allowlist rule threw and was disabled:",
            { pattern: String(rule.pattern), error: err && err.message }
          );
        } catch { /* non-fatal */ }
      }
    }
    return false;
  }

  // Auto-load company whitelist if available (company-rules.js loads before this file)
  if (typeof window !== "undefined" && window.__llmGuard && window.__llmGuard.companyConfig) {
    loadCompanyAllowlist(window.__llmGuard.companyConfig.whitelist);
  }

  // Browser (Chrome MAIN world)
  if (typeof window !== "undefined") {
    window.__llmGuard = window.__llmGuard || {};
    window.__llmGuard.allowlist = { isAllowlisted, isAttachmentAllowlisted, loadAllowlist, loadCompanyAllowlist, DEFAULT_ALLOWLIST };
  }

  // Node.js (tests)
  if (typeof module !== "undefined" && module.exports) {
    module.exports = { isAllowlisted, isAttachmentAllowlisted, loadAllowlist, loadCompanyAllowlist, DEFAULT_ALLOWLIST };
  }
})();
