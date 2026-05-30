/**
 * LLM Guard — Attachment scanner.
 *
 * Entry point used by content.js (and tests). Given a File (or Blob with a
 * filename), picks an extractor, pulls out the text, and returns a stable
 * envelope describing the scan — the caller is responsible for running the
 * text through scanForPII() and applying the user's mode.
 *
 * Design goals:
 *   - No knowledge of PII rules or UI. Pure extraction + metadata.
 *   - Graceful degradation. If a vendor library is missing (pdf.js / tesseract.js),
 *     return `{ unavailable: true, reason: "..." }` instead of throwing.
 *   - Deterministic for tests — accepts an `extractors` override so test files
 *     can swap in stubs without touching the globals.
 */
(function () {
  "use strict";

  const DEFAULT_MAX_SIZE = 20 * 1024 * 1024;   // 20 MB
  const DEFAULT_MAX_CHARS = 200_000;

  /**
   * @typedef {Object} ScanOptions
   * @property {number} [maxSizeBytes] Hard cap on file size. Oversized files
   *   return `{ truncated: true, unavailable: true, reason: "size" }`.
   * @property {number} [maxChars] Max extracted chars.
   * @property {{pdf: boolean, image: boolean, text: boolean}} [types]
   *   Per-type enable toggles. Disabled types return `{ skipped: true }`.
   * @property {Object<string, {canHandle:Function, extract:Function}>} [extractors]
   *   Override the extractor registry (tests).
   */

  /**
   * @param {File|Blob & {name?: string}} file
   * @param {ScanOptions} [opts]
   */
  async function scanAttachment(file, opts = {}) {
    const maxSizeBytes = opts.maxSizeBytes ?? DEFAULT_MAX_SIZE;
    const maxChars = opts.maxChars ?? DEFAULT_MAX_CHARS;
    const types = opts.types || { pdf: true, image: true, text: true };
    const registry = opts.extractors || getGlobalExtractors();

    const meta = buildMeta(file);

    if (!file || typeof file.arrayBuffer !== "function") {
      return { ...meta, text: "", skipped: true, reason: "not-a-file" };
    }

    if (meta.sizeBytes > maxSizeBytes) {
      return { ...meta, text: "", truncated: true, unavailable: true, reason: "size" };
    }

    const extractor = pickExtractor(registry, file);
    if (!extractor) {
      return { ...meta, text: "", skipped: true, reason: "unsupported-type" };
    }
    if (types[extractor.id] === false) {
      return { ...meta, text: "", skipped: true, reason: "type-disabled", extractorId: extractor.id };
    }

    let result;
    try {
      result = await extractor.extract(file, { maxChars });
    } catch (err) {
      return {
        ...meta,
        text: "",
        skipped: true,
        reason: "extract-error",
        error: String(err?.message || err),
        extractorId: extractor.id,
      };
    }

    return {
      ...meta,
      text: result.text || "",
      truncated: !!result.truncated,
      unavailable: !!result.unavailable,
      passwordProtected: !!result.passwordProtected,
      extractorId: extractor.id,
      kind: result.kind || extractor.id,
      pages: result.pages,
      confidence: result.confidence,
    };
  }

  function pickExtractor(registry, file) {
    // Priority: text (cheap) → pdf → image. Callers that want a different
    // order can pass their own registry in opts.extractors.
    const order = ["text", "pdf", "image"];
    for (const id of order) {
      const ex = registry[id];
      if (ex && ex.canHandle(file)) return ex;
    }
    return null;
  }

  function buildMeta(file) {
    return {
      filename: (file && file.name) || "",
      mimeType: (file && file.type) || "",
      sizeBytes: (file && typeof file.size === "number") ? file.size : 0,
    };
  }

  function getGlobalExtractors() {
    if (typeof window !== "undefined" && window.__llmGuard?.extractors) {
      return window.__llmGuard.extractors;
    }
    return {};
  }

  /**
   * Convenience for the content script: given a fetch/XHR body, return any
   * File/Blob values ready to be scanned. Yields objects with `.name` so the
   * scanner can log filenames.
   */
  function collectFiles(body) {
    const out = [];
    if (!body) return out;
    if (typeof File !== "undefined" && body instanceof File) {
      out.push(body);
      return out;
    }
    if (typeof Blob !== "undefined" && body instanceof Blob) {
      // Bare blob without name — wrap so downstream code has a stable shape.
      out.push(Object.assign(body, { name: body.name || "attachment.bin" }));
      return out;
    }
    if (typeof FormData !== "undefined" && body instanceof FormData) {
      try {
        for (const [, value] of body.entries()) {
          if ((typeof File !== "undefined" && value instanceof File) ||
              (typeof Blob !== "undefined" && value instanceof Blob)) {
            out.push(value);
          }
        }
      } catch {
        /* FormData not iterable in this environment */
      }
    }
    return out;
  }

  const api = { scanAttachment, collectFiles };

  if (typeof window !== "undefined") {
    window.__llmGuard = window.__llmGuard || {};
    window.__llmGuard.attachmentScanner = api;
  }

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})();
