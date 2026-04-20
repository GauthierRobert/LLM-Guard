/**
 * LLM Guard — PDF extractor (lazy-loaded pdf.js wrapper).
 *
 * Vendor files expected at chrome-extension://<id>/vendor/pdfjs/pdf.mjs and
 * vendor/pdfjs/pdf.worker.mjs. See vendor/pdfjs/README.md for drop-in
 * instructions — the extension works without them (attachment scans for
 * PDFs will be skipped and logged as UNSCANNED_ATTACHMENT).
 */
(function () {
  "use strict";

  const PDF_MIME = "application/pdf";
  let pdfjsLib = null;
  let loadPromise = null;
  let loadFailed = false;

  function canHandle(file) {
    if (!file) return false;
    if (file.type === PDF_MIME) return true;
    if (file.name && /\.pdf$/i.test(file.name)) return true;
    return false;
  }

  async function load() {
    if (pdfjsLib) return pdfjsLib;
    if (loadFailed) return null;
    if (loadPromise) return loadPromise;

    loadPromise = (async () => {
      try {
        const url = typeof chrome !== "undefined" && chrome.runtime?.getURL
          ? chrome.runtime.getURL("vendor/pdfjs/pdf.mjs")
          : "/vendor/pdfjs/pdf.mjs";
        const mod = await import(/* @vite-ignore */ url);
        const lib = mod.default || mod;
        if (lib.GlobalWorkerOptions && !lib.GlobalWorkerOptions.workerSrc) {
          lib.GlobalWorkerOptions.workerSrc = typeof chrome !== "undefined" && chrome.runtime?.getURL
            ? chrome.runtime.getURL("vendor/pdfjs/pdf.worker.mjs")
            : "/vendor/pdfjs/pdf.worker.mjs";
        }
        pdfjsLib = lib;
        return lib;
      } catch (err) {
        console.warn("[LLM Guard] pdf.js unavailable; PDF attachments will not be scanned.", err?.message || err);
        loadFailed = true;
        return null;
      }
    })();
    return loadPromise;
  }

  async function extract(file, { maxChars = 200_000 } = {}) {
    const lib = await load();
    if (!lib) {
      return { text: "", truncated: false, kind: "pdf", unavailable: true };
    }

    const buf = await file.arrayBuffer();
    let doc;
    try {
      doc = await lib.getDocument({ data: new Uint8Array(buf) }).promise;
    } catch (err) {
      const msg = String(err?.message || err);
      if (/password/i.test(msg)) {
        return { text: "", truncated: false, kind: "pdf", passwordProtected: true };
      }
      throw err;
    }

    let text = "";
    let truncated = false;
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      const pageText = content.items.map((item) => item.str).join(" ");
      text += pageText + "\n";
      if (text.length >= maxChars) {
        text = text.slice(0, maxChars);
        truncated = true;
        break;
      }
    }
    return { text, truncated, kind: "pdf", pages: doc.numPages };
  }

  const extractor = { id: "pdf", canHandle, extract, _load: load };

  if (typeof window !== "undefined") {
    window.__llmGuard = window.__llmGuard || {};
    window.__llmGuard.extractors = window.__llmGuard.extractors || {};
    window.__llmGuard.extractors.pdf = extractor;
  }

  if (typeof module !== "undefined" && module.exports) {
    module.exports = extractor;
  }
})();
