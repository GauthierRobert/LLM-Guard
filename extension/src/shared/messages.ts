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
import { DEFAULT_NER_CONFIG, type NerConfig, type NerEntity } from "@/core/ner/types";

/** Namespace tag on every window.postMessage payload, to filter page noise. */
export const GUARD_NS = "__LLM_GUARD__" as const;

/**
 * Master config. Behavior is decided by the DPO's rules, not a global mode —
 * this carries the on/off switch, where the guard hooks in, and the NER-layer
 * settings.
 */
export interface GuardConfig {
  enabled: boolean;
  /**
   * v5 primary guard: pseudonymise text the moment it is pasted into a chat
   * composer (Ctrl/⌘+V, right-click Paste, on-screen paste buttons).
   */
  pasteGuard: boolean;
  /**
   * v4 behaviour, kept as an opt-in safety net: also scan the prompt when it is
   * sent, by intercepting the outgoing request. Off by default — the paste
   * guard is the one users see and understand.
   */
  guardOnSend: boolean;
  /** On-device Named-Entity-Recognition layer (see core/ner). */
  ner: NerConfig;
}

export const DEFAULT_CONFIG: GuardConfig = {
  enabled: true,
  pasteGuard: true,
  guardOnSend: false,
  ner: DEFAULT_NER_CONFIG,
};

/**
 * Fill in any key missing from a stored config (older installs predate
 * `pasteGuard` / `guardOnSend` / `ner`). Shared by every context that reads it.
 */
export function withConfigDefaults(raw: Partial<GuardConfig> | undefined): GuardConfig {
  return {
    enabled: raw?.enabled ?? DEFAULT_CONFIG.enabled,
    pasteGuard: raw?.pasteGuard ?? DEFAULT_CONFIG.pasteGuard,
    guardOnSend: raw?.guardOnSend ?? DEFAULT_CONFIG.guardOnSend,
    ner: raw?.ner ?? DEFAULT_CONFIG.ner,
  };
}

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
/**
 * chrome.storage.local key remembering which bundled default last seeded the
 * rules. When the stored rules still equal this value the DPO never customized
 * them, so an extension update may safely re-seed with the new bundled default.
 */
export const RULES_SEEDED_KEY = "guard_rules_seeded_yaml" as const;
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

/** Where the guard caught the data. */
export type DetectionSource = "paste" | "send";

/** Emitted by the MAIN world whenever text is intercepted. */
export interface DetectionEvent {
  /** LLM service id, e.g. "chatgpt". */
  service: string;
  /** Hostname only — never the full URL (privacy). */
  host: string;
  action: DetectionAction;
  findings: FindingSummary[];
  /** Total sensitive values handled. */
  total: number;
  /** Absent on events recorded before v5 (all of which were "send"). */
  source?: DetectionSource;
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

/** MAIN → ISOLATED: please run NER on this text (relayed to the SW/host). */
export interface NerRequestMessage {
  ns: typeof GUARD_NS;
  kind: "ner-request";
  payload: { id: string; text: string };
}

/** ISOLATED → MAIN: NER result for an earlier request id. */
export interface NerResultMessage {
  ns: typeof GUARD_NS;
  kind: "ner-result";
  payload: { id: string; entities: NerEntity[] };
}

export type GuardMessage =
  | DetectionMessage
  | ConfigRequestMessage
  | ConfigMessage
  | RulesMessage
  | RevealMessage
  | RevealResultMessage
  | NerRequestMessage
  | NerResultMessage;

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
  | { kind: "clear-logs" }
  | { kind: "ner-detect"; payload: { text: string } };

/** Reply shape for ner-detect. */
export type NerDetectResponse = { ok: boolean; entities: NerEntity[] };

/** Reply shape for set-rules. */
export type SetRulesResponse = { ok: true } | { ok: false; errors: string[] };

/* --------------------- tab messages (popup → content) --------------------- */

/** popup → active tab (received by the ISOLATED bridge). */
export type TabMessage = { kind: "reveal"; reveal: boolean };

/** Reply shape for the reveal tab message. */
export type RevealResponse = { ok: boolean; reveal: boolean; replaced: number };

/** Re-export so callers don't reach into core for the action union. */
export type { RuleAction };
