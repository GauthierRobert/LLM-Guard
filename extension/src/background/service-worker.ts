/**
 * Module service worker.
 *
 * Owns persistence (logs + aggregate stats in chrome.storage.local, config in
 * chrome.storage.sync), maintains the toolbar badge, and answers config/stats/
 * logs queries from the bridge and the popup/options pages.
 */

import {
  CONFIG_STORAGE_KEY,
  DEFAULT_CONFIG,
  LOG_STORAGE_KEY,
  MAX_LOG_ENTRIES,
  RULES_STORAGE_KEY,
  RULES_MAX_BYTES,
  STATS_STORAGE_KEY,
  type DetectionAction,
  type DetectionEvent,
  type GuardConfig,
  type RuntimeMessage,
  type SetRulesResponse,
} from "@/shared/messages";
import { DEFAULT_RULES_YAML } from "@/core/rules/defaults";
import { parseRulesYaml } from "@/core/rules/parse";

const BADGE_RED = "#dc2626";
const BADGE_BLUE = "#2563eb";
const RESET_ALARM = "reset-badge";

/** Aggregate, append-only counters. */
interface GuardStats {
  totals: Record<DetectionAction, number>;
  /** Per-day buckets keyed by YYYY-MM-DD. */
  daily: Record<string, Record<DetectionAction, number>>;
}

function emptyActionCounts(): Record<DetectionAction, number> {
  return { anonymized: 0, blocked: 0, warned: 0, clean: 0 };
}

function emptyStats(): GuardStats {
  return { totals: emptyActionCounts(), daily: {} };
}

function todayKey(ts: number): string {
  const d = new Date(ts);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/* ------------------------------ storage I/O ------------------------------ */

async function getConfig(): Promise<GuardConfig> {
  const stored = await chrome.storage.sync.get(CONFIG_STORAGE_KEY);
  return (stored[CONFIG_STORAGE_KEY] as GuardConfig | undefined) ?? DEFAULT_CONFIG;
}

async function getRulesYaml(): Promise<string> {
  const stored = await chrome.storage.local.get(RULES_STORAGE_KEY);
  return (stored[RULES_STORAGE_KEY] as string | undefined) ?? DEFAULT_RULES_YAML;
}

/** Validate size + syntax, then persist the rules YAML. */
async function setRulesYaml(yaml: string): Promise<SetRulesResponse> {
  const bytes = new Blob([yaml]).size;
  if (bytes > RULES_MAX_BYTES) {
    return {
      ok: false,
      errors: [
        `Rules are too large (${bytes} bytes; limit ${RULES_MAX_BYTES}). Trim them or remove comments.`,
      ],
    };
  }
  const parsed = parseRulesYaml(yaml);
  if (!parsed.ok) return { ok: false, errors: parsed.errors };
  try {
    await chrome.storage.local.set({ [RULES_STORAGE_KEY]: yaml });
    return { ok: true };
  } catch (err) {
    return { ok: false, errors: [`Could not save: ${(err as Error).message}`] };
  }
}

async function getLogs(): Promise<DetectionEvent[]> {
  const stored = await chrome.storage.local.get(LOG_STORAGE_KEY);
  return (stored[LOG_STORAGE_KEY] as DetectionEvent[] | undefined) ?? [];
}

async function getStats(): Promise<GuardStats> {
  const stored = await chrome.storage.local.get(STATS_STORAGE_KEY);
  const value = stored[STATS_STORAGE_KEY] as Partial<GuardStats> | undefined;
  if (!value) return emptyStats();
  return {
    totals: { ...emptyActionCounts(), ...value.totals },
    daily: value.daily ?? {},
  };
}

/* -------------------------------- badge ---------------------------------- */

async function refreshBadge(stats: GuardStats): Promise<void> {
  const today = stats.daily[todayKey(Date.now())] ?? emptyActionCounts();
  const handled = today.anonymized + today.blocked;
  await chrome.action.setBadgeText({ text: handled > 0 ? String(handled) : "" });
  await chrome.action.setBadgeBackgroundColor({
    color: today.blocked > 0 ? BADGE_RED : BADGE_BLUE,
  });
}

async function clearBadge(): Promise<void> {
  await chrome.action.setBadgeText({ text: "" });
}

/* ----------------------------- detection sink ---------------------------- */

async function recordDetection(event: DetectionEvent): Promise<void> {
  // Logs: prepend newest, cap length.
  const logs = await getLogs();
  logs.unshift(event);
  if (logs.length > MAX_LOG_ENTRIES) logs.length = MAX_LOG_ENTRIES;

  // Stats: bump totals + per-day bucket.
  const stats = await getStats();
  const key = todayKey(event.ts);
  const day = stats.daily[key] ?? emptyActionCounts();
  stats.totals[event.action] += 1;
  day[event.action] += 1;
  stats.daily[key] = day;

  await chrome.storage.local.set({
    [LOG_STORAGE_KEY]: logs,
    [STATS_STORAGE_KEY]: stats,
  });
  await refreshBadge(stats);
}

/* ------------------------------- lifecycle ------------------------------- */

chrome.runtime.onInstalled.addListener(() => {
  void (async () => {
    const syncStored = await chrome.storage.sync.get(CONFIG_STORAGE_KEY);
    if (syncStored[CONFIG_STORAGE_KEY] === undefined) {
      await chrome.storage.sync.set({ [CONFIG_STORAGE_KEY]: DEFAULT_CONFIG });
    }
    const localStored = await chrome.storage.local.get(RULES_STORAGE_KEY);
    if (localStored[RULES_STORAGE_KEY] === undefined) {
      await chrome.storage.local.set({ [RULES_STORAGE_KEY]: DEFAULT_RULES_YAML });
    }
    chrome.alarms.create(RESET_ALARM, { periodInMinutes: 24 * 60 });
  })();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === RESET_ALARM) void clearBadge();
});

/* ------------------------------- messaging ------------------------------- */

chrome.runtime.onMessage.addListener(
  (message: RuntimeMessage, _sender, sendResponse): boolean => {
    switch (message.kind) {
      case "detection":
        // Fire-and-forget; no response expected.
        void recordDetection(message.payload);
        return false;

      case "get-config":
        void getConfig().then(sendResponse);
        return true;

      case "set-config":
        void chrome.storage.sync
          .set({ [CONFIG_STORAGE_KEY]: message.payload })
          .then(() => sendResponse({ ok: true }));
        return true;

      case "get-rules":
        void getRulesYaml().then((yaml) => sendResponse({ yaml }));
        return true;

      case "set-rules":
        void setRulesYaml(message.payload.yaml).then(sendResponse);
        return true;

      case "reset-rules":
        void chrome.storage.local
          .set({ [RULES_STORAGE_KEY]: DEFAULT_RULES_YAML })
          .then(() => sendResponse({ ok: true, yaml: DEFAULT_RULES_YAML }));
        return true;

      case "get-stats":
        void getStats().then(sendResponse);
        return true;

      case "get-logs":
        void getLogs().then(sendResponse);
        return true;

      case "clear-logs":
        void (async () => {
          await chrome.storage.local.set({
            [LOG_STORAGE_KEY]: [],
            [STATS_STORAGE_KEY]: emptyStats(),
          });
          await clearBadge();
          sendResponse({ ok: true });
        })();
        return true;

      default:
        return false;
    }
  },
);
