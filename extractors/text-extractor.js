/**
 * LLM Guard — Plain text extractor.
 * Handles text/*, application/json, application/xml, and CSV files.
 * Reads up to `maxChars` characters; anything beyond is truncated and flagged.
 */
(function () {
  "use strict";

  const TEXT_MIME_RE = /^(text\/|application\/(json|xml|x-ndjson|x-yaml|csv))/i;
  const TEXT_EXT_RE = /\.(txt|md|csv|tsv|log|json|xml|yml|yaml|ini|env|html?|js|ts|py|sh|sql|conf)$/i;

  function canHandle(file) {
    if (!file) return false;
    if (file.type && TEXT_MIME_RE.test(file.type)) return true;
    if (file.name && TEXT_EXT_RE.test(file.name)) return true;
    return false;
  }

  async function extract(file, { maxChars = 200_000 } = {}) {
    const raw = await file.text();
    const truncated = raw.length > maxChars;
    return {
      text: truncated ? raw.slice(0, maxChars) : raw,
      truncated,
      kind: "text",
    };
  }

  const extractor = { id: "text", canHandle, extract };

  if (typeof window !== "undefined") {
    window.__llmGuard = window.__llmGuard || {};
    window.__llmGuard.extractors = window.__llmGuard.extractors || {};
    window.__llmGuard.extractors.text = extractor;
  }

  if (typeof module !== "undefined" && module.exports) {
    module.exports = extractor;
  }
})();
