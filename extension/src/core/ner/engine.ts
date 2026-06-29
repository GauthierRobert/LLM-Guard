/**
 * transformers.js NER engine — the actual model wrapper.
 *
 * Runs ONLY in a context with the extension's (relaxed) CSP and a persistent
 * lifetime: the offscreen document on Chrome, the background script on Firefox
 * (see host.ts). It must NOT be imported by the service worker statically — on
 * Chrome the SW talks to the offscreen page instead, so engine + the multi-MB
 * model code never bloat the worker bundle.
 *
 * The model + WASM are fetched from the HuggingFace / jsdelivr CDNs on first use
 * and cached by the browser (allowed via the extension_pages CSP in the
 * manifest). For a fully-offline build, bundle the model and flip the env flags.
 */

import { pipeline, env } from "@huggingface/transformers";
import type { NerEntity } from "./types";

env.allowLocalModels = false;
env.allowRemoteModels = true;

// MV3 forbids remotely-hosted scripts, so onnxruntime-web must load its runtime
// (.mjs loader + .wasm) from inside the extension. vite.config copies those into
// `/ort`; point ORT there. Single-threaded because extension pages aren't
// cross-origin isolated (no SharedArrayBuffer).
const ortWasm = env.backends?.onnx?.wasm;
if (ortWasm && typeof chrome !== "undefined" && chrome.runtime?.getURL) {
  ortWasm.wasmPaths = chrome.runtime.getURL("ort/");
  ortWasm.numThreads = 1;
}

/** Loosely-typed token-classification pipeline (avoids transformers' deep generics). */
type NerPipeline = (text: string, options?: Record<string, unknown>) => Promise<unknown>;

/** Token-classification models cap at ~512 tokens; chunk long prompts well under that. */
const MAX_CHARS_PER_CHUNK = 1200;

let pipePromise: Promise<NerPipeline> | null = null;
let loadedModel: string | null = null;

/** Load (once) and reuse the pipeline for a given model id. */
function getPipeline(model: string): Promise<NerPipeline> {
  if (pipePromise && loadedModel === model) return pipePromise;
  loadedModel = model;
  pipePromise = pipeline("token-classification", model, {
    dtype: "q8",
  }) as unknown as Promise<NerPipeline>;
  return pipePromise;
}

interface RawEntity {
  entity_group?: unknown;
  entity?: unknown;
  word?: unknown;
  start?: unknown;
  end?: unknown;
  score?: unknown;
}

function toEntities(raw: unknown, offset: number, chunkText: string): NerEntity[] {
  const list = Array.isArray(raw) ? raw : [raw];
  const out: NerEntity[] = [];
  for (const item of list as RawEntity[]) {
    if (!item || typeof item !== "object") continue;
    const group = String(item.entity_group ?? item.entity ?? "").replace(/^[BI]-/, "");
    const word = String(item.word ?? "").replace(/^##/, "").trim();
    if (!group) continue;

    let start = Number(item.start ?? NaN);
    let end = Number(item.end ?? NaN);
    // Some tokenizers/aggregations omit char offsets — fall back to locating the
    // word in the chunk so the entity isn't silently dropped.
    if ((!Number.isFinite(start) || !Number.isFinite(end) || end <= start) && word) {
      const idx = chunkText.indexOf(word);
      if (idx >= 0) {
        start = idx;
        end = idx + word.length;
      }
    }
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) continue;

    out.push({
      entity: group,
      value: word || chunkText.slice(start, end),
      start: start + offset,
      end: end + offset,
      score: Number(item.score ?? 0),
    });
  }
  return out;
}

/** Split text into <=MAX_CHARS_PER_CHUNK windows, preferring whitespace breaks. */
function chunk(text: string): Array<{ text: string; offset: number }> {
  if (text.length <= MAX_CHARS_PER_CHUNK) return [{ text, offset: 0 }];
  const chunks: Array<{ text: string; offset: number }> = [];
  let i = 0;
  while (i < text.length) {
    let end = Math.min(i + MAX_CHARS_PER_CHUNK, text.length);
    if (end < text.length) {
      const ws = text.lastIndexOf(" ", end);
      if (ws > i + MAX_CHARS_PER_CHUNK / 2) end = ws;
    }
    chunks.push({ text: text.slice(i, end), offset: i });
    i = end;
  }
  return chunks;
}

/**
 * Detect named entities in `text` using `model`. Resolves to [] on any error
 * (the caller must never break the page over a model failure).
 */
export async function detectEntities(text: string, model: string): Promise<NerEntity[]> {
  if (!text || !text.trim()) return [];
  try {
    const ner = await getPipeline(model);
    const results: NerEntity[] = [];
    for (const c of chunk(text)) {
      const raw = await ner(c.text, { aggregation_strategy: "simple" });
      results.push(...toEntities(raw, c.offset, c.text));
    }
    return results;
  } catch (err) {
    console.warn("[AvoPseudo] NER inference failed:", err);
    return [];
  }
}
