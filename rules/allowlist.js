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

  /**
   * Check if a text match should be exempted from PII detection.
   * @param {string} matchedText - The detected PII text
   * @param {string} piiType - The type of PII detected (e.g., "Email", "Téléphone FR")
   * @returns {boolean} true if the match should be skipped
   */
  function isAllowlisted(matchedText, piiType) {
    const allRules = [...DEFAULT_ALLOWLIST, ...companyAllowlist, ...customAllowlist];
    for (const rule of allRules) {
      if (rule.pattern instanceof RegExp) {
        if (rule.pattern.test(matchedText)) return true;
      } else if (typeof rule.pattern === "string") {
        if (matchedText.toLowerCase().includes(rule.pattern.toLowerCase())) return true;
      }
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

  // Auto-load company whitelist if available (company-rules.js loads before this file)
  if (typeof window !== "undefined" && window.__llmGuard && window.__llmGuard.companyConfig) {
    loadCompanyAllowlist(window.__llmGuard.companyConfig.whitelist);
  }

  // Browser (Chrome MAIN world)
  if (typeof window !== "undefined") {
    window.__llmGuard = window.__llmGuard || {};
    window.__llmGuard.allowlist = { isAllowlisted, loadAllowlist, loadCompanyAllowlist, DEFAULT_ALLOWLIST };
  }

  // Node.js (tests)
  if (typeof module !== "undefined" && module.exports) {
    module.exports = { isAllowlisted, loadAllowlist, loadCompanyAllowlist, DEFAULT_ALLOWLIST };
  }
})();
