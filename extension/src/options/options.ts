/**
 * Options page: master enable toggle, mode radios with descriptions, the static
 * list of supported services, and a "clear activity & stats" action. All DOM is
 * built with createElement + textContent (services list); the rest is static
 * HTML wired up here.
 */
import type { GuardConfig, GuardMode } from "@/shared/messages";
import { DEFAULT_CONFIG } from "@/shared/messages";
import { clearLogs, getConfig, setConfig } from "@/popup/messaging";

const MODES: readonly GuardMode[] = ["anonymize", "warn", "block"];

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
  for (const input of document.querySelectorAll<HTMLInputElement>(
    'input[name="mode"]',
  )) {
    input.checked = input.value === config.mode;
    input.disabled = !config.enabled;
  }
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

async function persistConfig(): Promise<void> {
  await setConfig(config).catch(() => undefined);
  reflectConfig();
}

function wireControls(): void {
  byId<HTMLInputElement>("enabled").addEventListener("change", (e) => {
    config = { ...config, enabled: (e.target as HTMLInputElement).checked };
    void persistConfig();
  });

  for (const input of document.querySelectorAll<HTMLInputElement>(
    'input[name="mode"]',
  )) {
    input.addEventListener("change", () => {
      const value = input.value as GuardMode;
      if (!MODES.includes(value)) return;
      config = { ...config, mode: value };
      void persistConfig();
    });
  }

  byId<HTMLButtonElement>("clear").addEventListener("click", () => {
    const ok = window.confirm(
      "Clear all local activity logs and statistics? This cannot be undone.",
    );
    if (!ok) return;
    clearLogs()
      .then(() => showToast("Activity cleared."))
      .catch(() => showToast("Could not clear activity."));
  });
}

async function init(): Promise<void> {
  wireControls();
  renderServices();
  renderVersion();
  config = await getConfig().catch(() => ({ ...DEFAULT_CONFIG }));
  reflectConfig();
}

document.addEventListener("DOMContentLoaded", () => void init());
