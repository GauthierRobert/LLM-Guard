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
