/**
 * LLM Guard — Image OCR extractor (lazy-loaded tesseract.js wrapper).
 *
 * Vendor files expected at vendor/tesseract/tesseract.min.js and the
 * language data blobs at vendor/tesseract/lang-data/{eng,fra}.traineddata(.gz).
 * See vendor/tesseract/README.md for drop-in instructions. If vendor files
 * are missing, images are skipped and logged as UNSCANNED_ATTACHMENT rather
 * than blocking the user.
 */
(function () {
  "use strict";

  const IMAGE_MIME_RE = /^image\/(png|jpeg|jpg|webp|bmp|gif|tiff)$/i;
  const IMAGE_EXT_RE = /\.(png|jpe?g|webp|bmp|gif|tiff?)$/i;

  let tesseractLib = null;
  let loadPromise = null;
  let loadFailed = false;
  let worker = null;

  function canHandle(file) {
    if (!file) return false;
    if (file.type && IMAGE_MIME_RE.test(file.type)) return true;
    if (file.name && IMAGE_EXT_RE.test(file.name)) return true;
    return false;
  }

  function runtimeUrl(path) {
    if (typeof chrome !== "undefined" && chrome.runtime?.getURL) {
      return chrome.runtime.getURL(path);
    }
    return "/" + path;
  }

  async function load() {
    if (tesseractLib) return tesseractLib;
    if (loadFailed) return null;
    if (loadPromise) return loadPromise;

    loadPromise = (async () => {
      try {
        await new Promise((resolve, reject) => {
          const script = document.createElement("script");
          script.src = runtimeUrl("vendor/tesseract/tesseract.min.js");
          script.onload = resolve;
          script.onerror = () => reject(new Error("tesseract.min.js failed to load"));
          (document.head || document.documentElement).appendChild(script);
        });
        if (!window.Tesseract) throw new Error("Tesseract global missing after load");
        tesseractLib = window.Tesseract;
        return tesseractLib;
      } catch (err) {
        console.warn("[LLM Guard] tesseract.js unavailable; image attachments will not be OCR'd.", err?.message || err);
        loadFailed = true;
        return null;
      }
    })();
    return loadPromise;
  }

  async function getWorker(langs) {
    if (worker) return worker;
    const lib = await load();
    if (!lib) return null;
    worker = await lib.createWorker(langs, 1, {
      workerPath: runtimeUrl("vendor/tesseract/worker.min.js"),
      corePath: runtimeUrl("vendor/tesseract/tesseract-core.wasm.js"),
      langPath: runtimeUrl("vendor/tesseract/lang-data"),
      cacheMethod: "write",
    });
    return worker;
  }

  async function extract(file, { maxChars = 200_000, langs = ["eng", "fra"] } = {}) {
    const w = await getWorker(langs);
    if (!w) return { text: "", truncated: false, kind: "image", unavailable: true };

    const { data } = await w.recognize(file);
    const raw = String(data?.text || "");
    const truncated = raw.length > maxChars;
    return {
      text: truncated ? raw.slice(0, maxChars) : raw,
      truncated,
      kind: "image",
      confidence: data?.confidence,
    };
  }

  const extractor = { id: "image", canHandle, extract, _load: load };

  if (typeof window !== "undefined") {
    window.__llmGuard = window.__llmGuard || {};
    window.__llmGuard.extractors = window.__llmGuard.extractors || {};
    window.__llmGuard.extractors.image = extractor;
  }

  if (typeof module !== "undefined" && module.exports) {
    module.exports = extractor;
  }
})();
