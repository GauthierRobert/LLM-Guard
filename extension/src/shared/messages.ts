/**
 * Cross-context messaging contract.
 *
 *   MAIN world (main-world.ts)  ──window.postMessage──▶  ISOLATED (bridge.ts)
 *   ISOLATED (bridge.ts)        ──chrome.runtime──────▶  service-worker.ts
 *   service-worker.ts           ──chrome.runtime──────▶  bridge.ts ─postMessage▶ MAIN
 *   popup ──chrome.tabs.sendMessage──▶ bridge.ts ─postMessage▶ MAIN  (reveal)
 *
 * The MAIN world cannot touch chrome.* APIs, so the bridge owns storage and
 * relays config, rules, detections and reveal commands both ways.
 */

import type { Severity } from "./types";
import type { RuleAction } from "@/core/rules/types";

/** Namespace tag on every window.postMessage payload, to filter page noise. */
export const GUARD_NS = "__LLM_GUARD__" as const;

/**
 * Master config. Behavior is decided by the DPO's rules, not a global mode —
 * this only carries the on/off switch.
 */
export interface GuardConfig {
  enabled: boolean;
}

export const DEFAULT_CONFIG: GuardConfig = {
  enabled: true,
};

/** chrome.storage.sync key holding the GuardConfig. */
export const CONFIG_STORAGE_KEY = "guard_config" as const;
/**
 * chrome.storage.local key holding the DPO rules YAML (a string).
 *
 * Stored in `local`, NOT `sync`: chrome.storage.sync caps each item at ~8KB
 * (QUOTA_BYTES_PER_ITEM) and the bundled default ruleset already exceeds that.
 * `local` allows multiple MB per item, so the rules can grow freely.
 */
export const RULES_STORAGE_KEY = "guard_rules_yaml" as const;
/** chrome.storage.local key holding the rolling activity log. */
export const LOG_STORAGE_KEY = "guard_logs" as const;
/** chrome.storage.local key holding aggregate stats. */
export const STATS_STORAGE_KEY = "guard_stats" as const;
/** Max number of activity-log entries retained by the service worker. */
export const MAX_LOG_ENTRIES = 500;
/**
 * Sanity cap on the rules YAML size. Stored in chrome.storage.local (multi-MB
 * quota), so this only guards against pathological pastes, not the sync limit.
 */
export const RULES_MAX_BYTES = 256 * 1024;

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

/** MAIN → ISOLATED: page just booted, send me the current config + rules. */
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

/** ISOLATED → MAIN: here is the current/updated rules YAML. */
export interface RulesMessage {
  ns: typeof GUARD_NS;
  kind: "rules";
  payload: { yaml: string };
}

/** ISOLATED → MAIN: user clicked reveal/hide in the popup. */
export interface RevealMessage {
  ns: typeof GUARD_NS;
  kind: "reveal";
  payload: { reveal: boolean };
}

/** MAIN → ISOLATED: reveal/hide completed (relayed back to the popup). */
export interface RevealResultMessage {
  ns: typeof GUARD_NS;
  kind: "reveal-result";
  payload: { reveal: boolean; replaced: number; ok: boolean };
}

export type GuardMessage =
  | DetectionMessage
  | ConfigRequestMessage
  | ConfigMessage
  | RulesMessage
  | RevealMessage
  | RevealResultMessage;

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
  | { kind: "get-rules" }
  | { kind: "set-rules"; payload: { yaml: string } }
  | { kind: "reset-rules" }
  | { kind: "get-stats" }
  | { kind: "get-logs" }
  | { kind: "clear-logs" };

/** Reply shape for set-rules. */
export type SetRulesResponse = { ok: true } | { ok: false; errors: string[] };

/* --------------------- tab messages (popup → content) --------------------- */

/** popup → active tab (received by the ISOLATED bridge). */
export type TabMessage = { kind: "reveal"; reveal: boolean };

/** Reply shape for the reveal tab message. */
export type RevealResponse = { ok: boolean; reveal: boolean; replaced: number };

/** Re-export so callers don't reach into core for the action union. */
export type { RuleAction };
