/**
 * LLM Guard -- Pure utility functions
 * No business logic, no side effects, no DOM access.
 */
(function () {
  "use strict";

  function levenshtein(a, b) {
    const m = a.length, n = b.length;
    const dp = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
    for (let i = 0; i <= m; i++) dp[i][0] = i;
    for (let j = 0; j <= n; j++) dp[0][j] = j;
    for (let i = 1; i <= m; i++) {
      for (let j = 1; j <= n; j++) {
        dp[i][j] = Math.min(
          dp[i - 1][j] + 1,
          dp[i][j - 1] + 1,
          dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
        );
      }
    }
    return dp[m][n];
  }

  function normalize(text) {
    return text
      .toLowerCase()
      .replace(/0/g, "o")
      .replace(/1/g, "i")
      .replace(/3/g, "e")
      .replace(/4/g, "a")
      .replace(/5/g, "s")
      .replace(/7/g, "t")
      .replace(/@/g, "a")
      .replace(/\$/g, "s")
      .replace(/!/g, "i")
      .replace(/[\s.\-_*]+/g, "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "");
  }

  function maskPII(value) {
    if (value.length <= 4) return "****";
    return value.slice(0, 2) + "****" + value.slice(-2);
  }

  function getMaxSeverity(findings) {
    const order = { critical: 4, high: 3, medium: 2, low: 1 };
    return findings.reduce((max, f) => {
      return order[f.severity] > order[max] ? f.severity : max;
    }, "low");
  }

  function deduplicateFindings(findings) {
    const seen = new Set();
    return findings.filter((f) => {
      const key = `${f.type}:${(f.matches || []).join(",")}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  // Browser (Chrome MAIN world)
  if (typeof window !== "undefined") {
    window.__llmGuard = window.__llmGuard || {};
    window.__llmGuard.utils = { levenshtein, normalize, maskPII, getMaxSeverity, deduplicateFindings };
  }

  // Node.js (tests)
  if (typeof module !== "undefined" && module.exports) {
    module.exports = { levenshtein, normalize, maskPII, getMaxSeverity, deduplicateFindings };
  }
})();
