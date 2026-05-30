/**
 * Popup dashboard: master switch, manual reveal button, today's stats and a
 * short recent-activity feed. All DOM is built with createElement + textContent.
 */
import type {
  DetectionAction,
  DetectionEvent,
  GuardConfig,
} from "@/shared/messages";
import { DEFAULT_CONFIG } from "@/shared/messages";
import {
  bucketForToday,
  getConfig,
  getLogs,
  getStats,
  sendReveal,
  setConfig,
} from "@/popup/messaging";

const ACTION_LABEL: Record<DetectionAction, string> = {
  anonymized: "Anonymized",
  blocked: "Blocked",
  warned: "Warned",
  clean: "Clean",
};

let config: GuardConfig = { ...DEFAULT_CONFIG };
let revealed = false;

function byId<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} missing`);
  return el as T;
}

/** Compact relative time, e.g. "now", "2m ago", "3h ago", "5d ago". */
function relativeTime(ts: number): string {
  const secs = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (secs < 45) return "now";
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function prettyService(service: string): string {
  if (!service) return "Unknown";
  return service.charAt(0).toUpperCase() + service.slice(1);
}

function reflectConfig(): void {
  byId<HTMLInputElement>("enabled").checked = config.enabled;
}

function reflectReveal(): void {
  const btn = byId<HTMLButtonElement>("reveal-toggle");
  btn.textContent = revealed ? "Hide real values" : "Reveal real values";
  btn.classList.toggle("is-revealed", revealed);
}

async function loadStats(): Promise<void> {
  const stats = await getStats().catch(() => null);
  const bucket = bucketForToday(stats);
  byId("stat-anonymized").textContent = String(bucket.anonymized);
  byId("stat-blocked").textContent = String(bucket.blocked);
  byId("stat-total").textContent = String(bucket.total);
}

function findingsLine(event: DetectionEvent): string {
  if (event.findings.length === 0) return "No sensitive data";
  return event.findings.map((f) => `${f.type}×${f.count}`).join(" · ");
}

function renderActivityRow(event: DetectionEvent): HTMLLIElement {
  const li = document.createElement("li");
  li.className = "activity-item";

  const top = document.createElement("div");
  top.className = "activity-top";

  const service = document.createElement("span");
  service.className = "activity-service";
  service.textContent = prettyService(event.service);

  const badge = document.createElement("span");
  badge.className = `badge badge-${event.action}`;
  badge.textContent = ACTION_LABEL[event.action];

  const time = document.createElement("time");
  time.className = "activity-time";
  time.dateTime = new Date(event.ts).toISOString();
  time.textContent = relativeTime(event.ts);

  top.append(service, badge, time);

  const findings = document.createElement("p");
  findings.className = "activity-findings";
  findings.textContent = findingsLine(event);

  li.append(top, findings);
  return li;
}

async function loadActivity(): Promise<void> {
  const list = byId<HTMLUListElement>("activity");
  list.replaceChildren();

  const logs = await getLogs().catch((): DetectionEvent[] => []);
  const recent = logs
    .slice()
    .sort((a, b) => b.ts - a.ts)
    .slice(0, 10);

  if (recent.length === 0) {
    const empty = document.createElement("li");
    empty.className = "empty-state";
    empty.textContent = "No activity yet. You're all set.";
    list.append(empty);
    return;
  }

  for (const event of recent) list.append(renderActivityRow(event));
}

async function persistAndRefresh(): Promise<void> {
  await setConfig(config).catch(() => undefined);
  reflectConfig();
  await Promise.all([loadStats(), loadActivity()]);
}

function wireControls(): void {
  byId<HTMLInputElement>("enabled").addEventListener("change", (e) => {
    config = { ...config, enabled: (e.target as HTMLInputElement).checked };
    void persistAndRefresh();
  });

  const revealBtn = byId<HTMLButtonElement>("reveal-toggle");
  const hint = byId<HTMLParagraphElement>("reveal-hint");
  revealBtn.addEventListener("click", () => {
    revealBtn.disabled = true;
    void sendReveal(!revealed)
      .then((res) => {
        if (!res.ok) {
          hint.textContent = "Open a supported AI chat tab to reveal values.";
          return;
        }
        revealed = res.reveal;
        reflectReveal();
        hint.textContent = revealed
          ? `Showing ${res.replaced} real value${res.replaced === 1 ? "" : "s"} in the page.`
          : "Behavior is set by your organization's rules.";
      })
      .finally(() => {
        revealBtn.disabled = false;
      });
  });

  byId<HTMLButtonElement>("open-options").addEventListener("click", () => {
    chrome.runtime.openOptionsPage();
  });
}

async function init(): Promise<void> {
  wireControls();
  config = await getConfig().catch(() => ({ ...DEFAULT_CONFIG }));
  reflectConfig();
  reflectReveal();
  await Promise.all([loadStats(), loadActivity()]);
}

document.addEventListener("DOMContentLoaded", () => void init());
