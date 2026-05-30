/**
 * Options page: master enable toggle, the DPO rules editor (load / save /
 * validate / reset), the static list of supported services, and a "clear
 * activity & stats" action. All DOM is built with createElement + textContent.
 */
import type { GuardConfig } from "@/shared/messages";
import { DEFAULT_CONFIG } from "@/shared/messages";
import {
  clearLogs,
  getConfig,
  getRules,
  resetRules,
  setConfig,
  setRules,
} from "@/popup/messaging";

const SERVICES: readonly string[] = [
  "ChatGPT",
  "Claude",
  "Gemini",
  "Copilot",
  "Mistral",
  "Perplexity",
  "DeepSeek",
  "Grok",
];

let config: GuardConfig = { ...DEFAULT_CONFIG };

function byId<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} missing`);
  return el as T;
}

function reflectConfig(): void {
  byId<HTMLInputElement>("enabled").checked = config.enabled;
}

function renderServices(): void {
  const list = byId<HTMLUListElement>("services");
  list.replaceChildren();
  for (const name of SERVICES) {
    const li = document.createElement("li");
    li.className = "service";

    const dot = document.createElement("span");
    dot.className = "service-dot";
    dot.setAttribute("aria-hidden", "true");

    const label = document.createElement("span");
    label.className = "service-name";
    label.textContent = name;

    li.append(dot, label);
    list.append(li);
  }
}

function renderVersion(): void {
  const version = chrome.runtime.getManifest().version;
  byId("version").textContent = `v${version}`;
}

let toastTimer: number | undefined;

function showToast(message: string): void {
  const toast = byId("toast");
  toast.textContent = message;
  toast.classList.add("toast-visible");
  if (toastTimer !== undefined) clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    toast.classList.remove("toast-visible");
    toast.textContent = "";
  }, 2400);
}

function showRuleErrors(errors: string[]): void {
  const box = byId<HTMLDivElement>("rules-errors");
  box.replaceChildren();
  if (errors.length === 0) {
    box.classList.remove("visible");
    return;
  }
  const ul = document.createElement("ul");
  for (const e of errors) {
    const li = document.createElement("li");
    li.textContent = e;
    ul.append(li);
  }
  box.append(ul);
  box.classList.add("visible");
}

async function loadRules(): Promise<void> {
  const { yaml } = await getRules().catch(() => ({ yaml: "" }));
  byId<HTMLTextAreaElement>("rules-yaml").value = yaml;
}

async function persistConfig(): Promise<void> {
  await setConfig(config).catch(() => undefined);
  reflectConfig();
}

function wireControls(): void {
  byId<HTMLInputElement>("enabled").addEventListener("change", (e) => {
    config = { ...config, enabled: (e.target as HTMLInputElement).checked };
    void persistConfig();
  });

  byId<HTMLButtonElement>("rules-save").addEventListener("click", () => {
    const yaml = byId<HTMLTextAreaElement>("rules-yaml").value;
    void setRules(yaml).then((res) => {
      if (res.ok) {
        showRuleErrors([]);
        showToast("Rules saved.");
      } else {
        showRuleErrors(res.errors);
        showToast("Rules not saved — please fix the errors.");
      }
    });
  });

  byId<HTMLButtonElement>("rules-reset").addEventListener("click", () => {
    const ok = window.confirm("Replace the current rules with the built-in defaults?");
    if (!ok) return;
    void resetRules().then((res) => {
      byId<HTMLTextAreaElement>("rules-yaml").value = res.yaml;
      showRuleErrors([]);
      showToast("Rules reset to default.");
    });
  });

  byId<HTMLButtonElement>("clear").addEventListener("click", () => {
    const ok = window.confirm(
      "Clear all local activity logs and statistics? This cannot be undone.",
    );
    if (!ok) return;
    clearLogs()
      .then(() => showActivityToast("Activity cleared."))
      .catch(() => showActivityToast("Could not clear activity."));
  });
}

let activityToastTimer: number | undefined;
function showActivityToast(message: string): void {
  const toast = byId("toast-activity");
  toast.textContent = message;
  toast.classList.add("toast-visible");
  if (activityToastTimer !== undefined) clearTimeout(activityToastTimer);
  activityToastTimer = window.setTimeout(() => {
    toast.classList.remove("toast-visible");
    toast.textContent = "";
  }, 2400);
}

async function init(): Promise<void> {
  wireControls();
  renderServices();
  renderVersion();
  config = await getConfig().catch(() => ({ ...DEFAULT_CONFIG }));
  reflectConfig();
  await loadRules();
}

document.addEventListener("DOMContentLoaded", () => void init());
