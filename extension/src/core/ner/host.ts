/**
 * NER host — where the model physically runs, abstracted for both browsers.
 *
 * Called from the service worker (`ner-detect` handler). Picks the host at
 * runtime by feature-detecting `chrome.offscreen`:
 *   - Chrome:  create/reuse a hidden offscreen document and message it.
 *   - Firefox: no offscreen API → dynamically import the engine and run it in
 *     the (persistent) background script. The dynamic import keeps the model
 *     code out of the worker bundle on Chrome, where it's never executed.
 */

import type { NerEntity } from "./types";

/** SW → offscreen request. */
export interface OffscreenNerRequest {
  target: "offscreen";
  kind: "ner-run";
  text: string;
  model: string;
}

/** offscreen → SW response. */
export interface OffscreenNerResponse {
  ok: boolean;
  entities: NerEntity[];
  error?: string;
}

const OFFSCREEN_URL = "src/background/offscreen.html";

interface OffscreenApi {
  hasDocument?: () => Promise<boolean>;
  createDocument: (opts: { url: string; reasons: string[]; justification: string }) => Promise<void>;
  Reason?: { WORKERS?: string };
}

function offscreenApi(): OffscreenApi | null {
  const api = (chrome as unknown as { offscreen?: OffscreenApi }).offscreen;
  return api ?? null;
}

let creating: Promise<void> | null = null;

async function ensureOffscreen(api: OffscreenApi): Promise<void> {
  if (api.hasDocument && (await api.hasDocument())) return;
  if (!creating) {
    creating = api
      .createDocument({
        url: OFFSCREEN_URL,
        reasons: [api.Reason?.WORKERS ?? "WORKERS"],
        justification: "Run the on-device NER model (WASM/WebGPU) off the service worker.",
      })
      .catch((err: unknown) => {
        // A racing create yields "Only a single offscreen document may be created" — benign.
        if (!String(err).includes("single offscreen")) throw err;
      })
      .finally(() => {
        creating = null;
      });
  }
  await creating;
}

/**
 * Detect entities in `text` with `model`. Always resolves (never rejects) — on
 * any failure it returns [] so the calling fetch path is never broken.
 */
export async function detectViaHost(text: string, model: string): Promise<NerEntity[]> {
  try {
    const api = offscreenApi();
    if (api) {
      await ensureOffscreen(api);
      const req: OffscreenNerRequest = { target: "offscreen", kind: "ner-run", text, model };
      const resp = (await chrome.runtime.sendMessage(req)) as OffscreenNerResponse | undefined;
      return resp?.ok ? resp.entities : [];
    }
    // Firefox: run in the background script itself.
    const { detectEntities } = await import("./engine");
    return await detectEntities(text, model);
  } catch (err) {
    console.warn("[AvoPseudo] NER host failed:", err);
    return [];
  }
}
