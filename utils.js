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

  async function sha256Hex(data) {
    const cryptoObj = (typeof globalThis !== "undefined" && globalThis.crypto) || null;
    if (!cryptoObj?.subtle?.digest) return "";
    const buf = data instanceof ArrayBuffer
      ? data
      : ArrayBuffer.isView(data)
        ? data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength)
        : new TextEncoder().encode(String(data)).buffer;
    const digest = await cryptoObj.subtle.digest("SHA-256", buf);
    return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
  }

  function fnv1aHex(str) {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619) >>> 0;
    }
    return h.toString(16).padStart(8, "0");
  }

  /**
   * Minimal Map-based LRU. Cheaper than a linked list and good enough for
   * the handful of hundred-entry caches we need. `get` re-inserts to refresh
   * recency; `set` evicts the oldest key when capacity is hit.
   */
  function createLRU(capacity) {
    const cap = Math.max(1, capacity | 0);
    const map = new Map();
    return {
      get(key) {
        if (!map.has(key)) return undefined;
        const val = map.get(key);
        map.delete(key);
        map.set(key, val);
        return val;
      },
      set(key, val) {
        if (map.has(key)) map.delete(key);
        map.set(key, val);
        if (map.size > cap) {
          const oldest = map.keys().next().value;
          map.delete(oldest);
        }
      },
      has(key) { return map.has(key); },
      get size() { return map.size; },
      clear() { map.clear(); },
    };
  }

  function formatBytes(n) {
    if (!Number.isFinite(n) || n < 0) return "";
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
    return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  }

  // Browser (Chrome MAIN world)
  if (typeof window !== "undefined") {
    window.__llmGuard = window.__llmGuard || {};
    window.__llmGuard.utils = { levenshtein, normalize, maskPII, getMaxSeverity, deduplicateFindings, sha256Hex, formatBytes, fnv1aHex, createLRU };
  }

  // Node.js (tests)
  if (typeof module !== "undefined" && module.exports) {
    module.exports = { levenshtein, normalize, maskPII, getMaxSeverity, deduplicateFindings, sha256Hex, formatBytes, fnv1aHex, createLRU };
  }
})();
