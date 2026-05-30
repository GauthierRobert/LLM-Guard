/**
 * Thin Promise wrapper around chrome.runtime.sendMessage for the UI pages.
 * Every page talks to the service worker exclusively through these helpers.
 */
import type {
  DetectionEvent,
  GuardConfig,
  RevealResponse,
  RuntimeMessage,
  SetRulesResponse,
} from "@/shared/messages";

/** Shape of one day's aggregate counters returned by `get-stats`. */
export interface StatsBucket {
  anonymized: number;
  blocked: number;
  warned: number;
  clean: number;
  total: number;
}

/**
 * Stats payload from the service worker. Keyed by ISO date (YYYY-MM-DD).
 * Unknown/legacy shapes are tolerated by the readers below.
 */
export interface GuardStats {
  byDay?: Record<string, Partial<StatsBucket>>;
}

function send<T>(message: RuntimeMessage): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response: T) => {
      const err = chrome.runtime.lastError;
      if (err) {
        reject(new Error(err.message));
        return;
      }
      resolve(response);
    });
  });
}

export function getConfig(): Promise<GuardConfig> {
  return send<GuardConfig>({ kind: "get-config" });
}

export function setConfig(payload: GuardConfig): Promise<{ ok: true }> {
  return send<{ ok: true }>({ kind: "set-config", payload });
}

export function getStats(): Promise<GuardStats> {
  return send<GuardStats>({ kind: "get-stats" });
}

export function getLogs(): Promise<DetectionEvent[]> {
  return send<DetectionEvent[]>({ kind: "get-logs" });
}

export function clearLogs(): Promise<{ ok: true }> {
  return send<{ ok: true }>({ kind: "clear-logs" });
}

export function getRules(): Promise<{ yaml: string }> {
  return send<{ yaml: string }>({ kind: "get-rules" });
}

export function setRules(yaml: string): Promise<SetRulesResponse> {
  return send<SetRulesResponse>({ kind: "set-rules", payload: { yaml } });
}

export function resetRules(): Promise<{ ok: true; yaml: string }> {
  return send<{ ok: true; yaml: string }>({ kind: "reset-rules" });
}

/**
 * Send a reveal/hide command to the active tab's content script. Resolves with
 * the result, or a not-ok result when the tab is not a supported LLM page.
 */
export function sendReveal(reveal: boolean): Promise<RevealResponse> {
  return new Promise<RevealResponse>((resolve) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tabId = tabs[0]?.id;
      if (tabId === undefined) {
        resolve({ ok: false, reveal: false, replaced: 0 });
        return;
      }
      chrome.tabs.sendMessage(tabId, { kind: "reveal", reveal }, (response: RevealResponse) => {
        if (chrome.runtime.lastError || !response) {
          resolve({ ok: false, reveal: false, replaced: 0 });
          return;
        }
        resolve(response);
      });
    });
  });
}

/** Local date key (YYYY-MM-DD) used to index the per-day stats bucket. */
export function todayKey(date: Date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

const EMPTY_BUCKET: StatsBucket = {
  anonymized: 0,
  blocked: 0,
  warned: 0,
  clean: 0,
  total: 0,
};

/** Reads today's bucket defensively, defaulting any missing counter to 0. */
export function bucketForToday(stats: GuardStats | null | undefined): StatsBucket {
  const raw = stats?.byDay?.[todayKey()];
  if (!raw) return { ...EMPTY_BUCKET };
  return {
    anonymized: raw.anonymized ?? 0,
    blocked: raw.blocked ?? 0,
    warned: raw.warned ?? 0,
    clean: raw.clean ?? 0,
    total: raw.total ?? 0,
  };
}
