/**
 * Cross-context messaging contract.
 *
 *   MAIN world (main-world.ts)  ──window.postMessage──▶  ISOLATED (bridge.ts)
 *   ISOLATED (bridge.ts)        ──chrome.runtime──────▶  service-worker.ts
 *   service-worker.ts           ──chrome.runtime──────▶  bridge.ts ─postMessage▶ MAIN
 *
 * The MAIN world cannot touch chrome.* APIs, so the bridge owns storage and
 * relays config + detection events both ways.
 */

import type { Severity } from "./types";

/** Namespace tag on every window.postMessage payload, to filter page noise. */
export const GUARD_NS = "__LLM_GUARD__" as const;

export type GuardMode = "anonymize" | "block" | "warn";

export interface GuardConfig {
  enabled: boolean;
  mode: GuardMode;
}

export const DEFAULT_CONFIG: GuardConfig = {
  enabled: true,
  mode: "anonymize",
};

/** chrome.storage.sync key holding the GuardConfig. */
export const CONFIG_STORAGE_KEY = "guard_config" as const;
/** chrome.storage.local key holding the rolling activity log. */
export const LOG_STORAGE_KEY = "guard_logs" as const;
/** chrome.storage.local key holding aggregate stats. */
export const STATS_STORAGE_KEY = "guard_stats" as const;
/** Max number of activity-log entries retained by the service worker. */
export const MAX_LOG_ENTRIES = 500;

export type DetectionAction = "anonymized" | "blocked" | "warned" | "clean";

/** Per-type roll-up of what was found in one intercepted request. */
export interface FindingSummary {
  type: string;
  severity: Severity;
  count: number;
}

/** Emitted by the MAIN world whenever a prompt is intercepted. */
export interface DetectionEvent {
  /** LLM service id, e.g. "chatgpt". */
  service: string;
  /** Hostname only — never the full URL (privacy). */
  host: string;
  mode: GuardMode;
  action: DetectionAction;
  findings: FindingSummary[];
  /** Total sensitive values handled in this request. */
  total: number;
  ts: number;
}

/* ----------------------------- wire messages ----------------------------- */

/** MAIN → ISOLATED: a detection happened, please persist + badge it. */
export interface DetectionMessage {
  ns: typeof GUARD_NS;
  kind: "detection";
  payload: DetectionEvent;
}

/** MAIN → ISOLATED: page just booted, send me the current config. */
export interface ConfigRequestMessage {
  ns: typeof GUARD_NS;
  kind: "config-request";
}

/** ISOLATED → MAIN: here is the current/updated config. */
export interface ConfigMessage {
  ns: typeof GUARD_NS;
  kind: "config";
  payload: GuardConfig;
}

export type GuardMessage = DetectionMessage | ConfigRequestMessage | ConfigMessage;

/** Type guard for window.postMessage handlers. */
export function isGuardMessage(data: unknown): data is GuardMessage {
  return (
    typeof data === "object" &&
    data !== null &&
    (data as { ns?: unknown }).ns === GUARD_NS &&
    typeof (data as { kind?: unknown }).kind === "string"
  );
}

/* ------------------ runtime messages (bridge ⇄ service worker) ------------ */

export type RuntimeMessage =
  | { kind: "detection"; payload: DetectionEvent }
  | { kind: "get-config" }
  | { kind: "set-config"; payload: GuardConfig }
  | { kind: "get-stats" }
  | { kind: "get-logs" }
  | { kind: "clear-logs" };
