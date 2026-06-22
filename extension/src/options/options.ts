/**
 * Options page.
 *
 * The detection rules are managed without anyone having to read or write YAML:
 *   - a "block list" and an "allow list" edited as removable chips;
 *   - a list of rules, each with an on/off switch and a "Copy" button that puts
 *     a ready-to-paste prompt on the clipboard (edit the rule via ChatGPT /
 *     Claude, paste the reply back);
 *   - a paste box / file upload to apply a rule (merged by id) or a whole file;
 *   - download of the current YAML, and a collapsed raw-YAML editor for experts.
 *
 * Every friendly edit auto-saves through the service worker, which re-validates
 * before persisting. All DOM is built with createElement + textContent.
 */
import type { GuardConfig } from "@/shared/messages";
import { DEFAULT_CONFIG } from "@/shared/messages";
import type { Severity } from "@/shared/types";
import type { ParsedRule, ParsedRulesDoc, RuleAction } from "@/core/rules/types";
import { parseRulesYaml } from "@/core/rules/parse";
import {
  addBlacklistValue,
  addWhitelistValue,
  buildImportedYaml,
  extractRuleObject,
  removeBlacklistValue,
  removeWhitelistValue,
  setRuleEnabled,
} from "@/core/rules/edit";
import { buildCreatePrompt, buildEditPrompt } from "@/core/rules/prompt";
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

const DEFAULT_ACTION: RuleAction = "anonymize";
const DEFAULT_SEVERITY: Severity = "medium";
/** Kept in sync with the #new-rule button label in options.html. */
const NEW_RULE_LABEL = "✨ Copy prompt to create a new rule with AI";
/** Per-rule copy button label (restored after the "Copied ✓" flash). */
const COPY_RULE_LABEL = "Copy prompt to edit with AI";

let config: GuardConfig = { ...DEFAULT_CONFIG };
/** The last YAML known to be saved; the single source of truth for the UI. */
let currentYaml = "";

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

/* -------------------------------- toasts --------------------------------- */

const toastTimers = new Map<string, number>();

function showToast(id: string, message: string): void {
  const toast = byId(id);
  toast.textContent = message;
  toast.classList.add("toast-visible");
  const prev = toastTimers.get(id);
  if (prev !== undefined) clearTimeout(prev);
  toastTimers.set(
    id,
    window.setTimeout(() => {
      toast.classList.remove("toast-visible");
      toast.textContent = "";
    }, 2600),
  );
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

/* ----------------------------- save pipeline ----------------------------- */

/**
 * Persist a candidate YAML through the service worker (which re-validates).
 * On success the UI re-renders from the saved value; on failure the UI reverts
 * (re-render from the unchanged `currentYaml`) and the errors are shown.
 */
async function applyYaml(nextYaml: string, successToast: string): Promise<boolean> {
  const res = await setRules(nextYaml).catch(() => ({
    ok: false as const,
    errors: ["Could not reach the extension to save."],
  }));
  if (res.ok) {
    currentYaml = nextYaml;
    showRuleErrors([]);
    renderRulesUI();
    showToast("toast", successToast);
    return true;
  }
  showRuleErrors(res.errors);
  showToast("toast", "Couldn't save — see the errors above.");
  renderRulesUI();
  return false;
}

/* ------------------------------- rendering ------------------------------- */

function parseCurrent(): ParsedRulesDoc | null {
  const res = parseRulesYaml(currentYaml);
  return res.ok ? res.doc : null;
}

function effectiveAction(rule: ParsedRule, doc: ParsedRulesDoc): RuleAction {
  return rule.action ?? doc.defaults?.action ?? DEFAULT_ACTION;
}

function effectiveSeverity(rule: ParsedRule, doc: ParsedRulesDoc): Severity {
  return rule.severity ?? doc.defaults?.severity ?? DEFAULT_SEVERITY;
}

function makeChip(value: string, onRemove: () => void): HTMLElement {
  const chip = document.createElement("span");
  chip.className = "chip";

  const text = document.createElement("span");
  text.className = "chip-text";
  text.textContent = value;

  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "chip-remove";
  btn.textContent = "×";
  btn.setAttribute("aria-label", `Remove ${value}`);
  btn.title = `Remove ${value}`;
  btn.addEventListener("click", onRemove);

  chip.append(text, btn);
  return chip;
}

function renderChips(
  containerId: string,
  values: string[],
  emptyText: string,
  onRemove: (value: string) => void,
): void {
  const box = byId<HTMLDivElement>(containerId);
  box.replaceChildren();
  if (values.length === 0) {
    const empty = document.createElement("span");
    empty.className = "chips-empty";
    empty.textContent = emptyText;
    box.append(empty);
    return;
  }
  for (const v of values) box.append(makeChip(v, () => onRemove(v)));
}

function makeSwitch(checked: boolean, label: string, onChange: (v: boolean) => void): HTMLElement {
  const wrap = document.createElement("label");
  wrap.className = "switch";
  wrap.title = label;

  const input = document.createElement("input");
  input.type = "checkbox";
  input.checked = checked;
  input.setAttribute("aria-label", label);
  input.addEventListener("change", () => onChange(input.checked));

  const track = document.createElement("span");
  track.className = "track";
  track.setAttribute("aria-hidden", "true");

  wrap.append(input, track);
  return wrap;
}

function makeBadge(text: string, cls: string): HTMLElement {
  const b = document.createElement("span");
  b.className = `badge ${cls}`;
  b.textContent = text;
  return b;
}

function renderRulesList(doc: ParsedRulesDoc): void {
  const list = byId<HTMLUListElement>("rules-list");
  list.replaceChildren();

  for (const rule of doc.rules) {
    const li = document.createElement("li");
    li.className = "rule";
    if (rule.enabled === false) li.classList.add("rule-off");

    const info = document.createElement("div");
    info.className = "rule-info";

    const name = document.createElement("span");
    name.className = "rule-name";
    name.textContent = rule.description ?? rule.id;

    const meta = document.createElement("div");
    meta.className = "rule-meta";
    const action = effectiveAction(rule, doc);
    const severity = effectiveSeverity(rule, doc);
    meta.append(
      makeBadge(action, `badge-${action}`),
      makeBadge(severity, `badge-sev badge-sev-${severity}`),
    );
    const id = document.createElement("span");
    id.className = "rule-id";
    id.textContent = rule.id;
    meta.append(id);

    info.append(name, meta);

    const actions = document.createElement("div");
    actions.className = "rule-actions";

    const copy = document.createElement("button");
    copy.type = "button";
    copy.className = "btn btn-small";
    copy.textContent = COPY_RULE_LABEL;
    copy.title = "Copy a prompt to edit this rule with ChatGPT or Claude";
    copy.addEventListener("click", () => void onCopyRule(rule.id, copy));

    const toggle = makeSwitch(
      rule.enabled !== false,
      `Enable rule ${rule.id}`,
      (enabled) => void onToggleRule(rule.id, enabled),
    );

    actions.append(copy, toggle);
    li.append(info, actions);
    list.append(li);
  }

  if (doc.rules.length === 0) {
    const li = document.createElement("li");
    li.className = "chips-empty";
    li.textContent = "No rules yet. Use “New rule with AI” to create one.";
    list.append(li);
  }
}

/** Re-render every rules-related widget from `currentYaml`. */
function renderRulesUI(): void {
  syncRawEditor();
  const doc = parseCurrent();
  if (!doc) {
    showRuleErrors([
      "The saved rules can't be read. Use the raw YAML editor below or reset to default.",
    ]);
    return;
  }
  renderChips(
    "blacklist-chips",
    doc.blacklist?.values ?? [],
    "Nothing yet — add a client, matter or project name.",
    (v) => void applyYaml(removeBlacklistValue(currentYaml, v), "Removed."),
  );
  renderChips(
    "whitelist-chips",
    doc.whitelist ?? [],
    "Nothing yet — add a value that should never be flagged.",
    (v) => void applyYaml(removeWhitelistValue(currentYaml, v), "Removed."),
  );
  renderRulesList(doc);
}

function syncRawEditor(): void {
  byId<HTMLTextAreaElement>("rules-yaml").value = currentYaml;
}

/* ------------------------------- handlers -------------------------------- */

async function onToggleRule(id: string, enabled: boolean): Promise<void> {
  await applyYaml(setRuleEnabled(currentYaml, id, enabled), enabled ? "Rule enabled." : "Rule disabled.");
}

async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/** Briefly show "Copied ✓" on a button, then restore its label. */
const copyTimers = new WeakMap<HTMLElement, number>();
function flashCopied(btn: HTMLButtonElement, label: string): void {
  btn.textContent = "Copied ✓";
  btn.classList.add("btn-copied");
  const prev = copyTimers.get(btn);
  if (prev !== undefined) clearTimeout(prev);
  copyTimers.set(
    btn,
    window.setTimeout(() => {
      btn.textContent = label;
      btn.classList.remove("btn-copied");
    }, 1800),
  );
}

async function onCopyRule(id: string, btn: HTMLButtonElement): Promise<void> {
  const rule = extractRuleObject(currentYaml, id);
  if (!rule) {
    showToast("toast", "Rule not found.");
    return;
  }
  if (await copyToClipboard(buildEditPrompt(rule))) flashCopied(btn, COPY_RULE_LABEL);
  else showToast("toast", "Couldn't copy.");
}

async function onNewRule(btn: HTMLButtonElement): Promise<void> {
  if (await copyToClipboard(buildCreatePrompt())) flashCopied(btn, NEW_RULE_LABEL);
  else showToast("toast", "Couldn't copy.");
}

function addFromForm(
  formId: string,
  inputId: string,
  toastId: string,
  add: (yaml: string, value: string) => string,
): void {
  byId<HTMLFormElement>(formId).addEventListener("submit", (e) => {
    e.preventDefault();
    const input = byId<HTMLInputElement>(inputId);
    const value = input.value.trim();
    if (!value) return;
    void applyYaml(add(currentYaml, value), "Added.").then((ok) => {
      if (ok) input.value = "";
      else showToast(toastId, "Couldn't add.");
    });
  });
}

async function onImportApply(): Promise<void> {
  const box = byId<HTMLTextAreaElement>("import-box");
  const result = buildImportedYaml(currentYaml, box.value);
  if (!result.ok) {
    showRuleErrors([result.error]);
    showToast("toast", "Nothing applied — see the error.");
    return;
  }
  const msg =
    result.mode === "replace"
      ? `Replaced all rules${result.count ? ` (${result.count}).` : "."}`
      : `Updated ${result.count} rule${result.count === 1 ? "" : "s"}.`;
  const ok = await applyYaml(result.yaml, msg);
  if (ok) box.value = "";
}

function onDownload(): void {
  const blob = new Blob([currentYaml], { type: "text/yaml" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "llm-guard-rules.yaml";
  document.body.append(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  showToast("toast", "Downloaded llm-guard-rules.yaml.");
}

function onUploadFile(file: File): void {
  const reader = new FileReader();
  reader.onload = () => {
    byId<HTMLTextAreaElement>("import-box").value = String(reader.result ?? "");
    void onImportApply();
  };
  reader.onerror = () => showToast("toast", "Couldn't read that file.");
  reader.readAsText(file);
}

function wireControls(): void {
  byId<HTMLInputElement>("enabled").addEventListener("change", (e) => {
    config = { ...config, enabled: (e.target as HTMLInputElement).checked };
    void setConfig(config).catch(() => undefined);
    reflectConfig();
  });

  addFromForm("blacklist-form", "blacklist-input", "toast-blacklist", addBlacklistValue);
  addFromForm("whitelist-form", "whitelist-input", "toast-whitelist", addWhitelistValue);

  byId<HTMLButtonElement>("new-rule").addEventListener("click", (e) =>
    void onNewRule(e.currentTarget as HTMLButtonElement),
  );
  byId<HTMLButtonElement>("import-apply").addEventListener("click", () => void onImportApply());

  byId<HTMLButtonElement>("import-file").addEventListener("click", () => {
    byId<HTMLInputElement>("import-file-input").click();
  });
  byId<HTMLInputElement>("import-file-input").addEventListener("change", (e) => {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (file) onUploadFile(file);
    (e.target as HTMLInputElement).value = "";
  });

  byId<HTMLButtonElement>("download").addEventListener("click", onDownload);

  byId<HTMLButtonElement>("rules-reset").addEventListener("click", () => {
    const ok = window.confirm("Replace the current rules with the built-in defaults?");
    if (!ok) return;
    void resetRules().then((res) => {
      currentYaml = res.yaml;
      showRuleErrors([]);
      renderRulesUI();
      showToast("toast", "Rules reset to default.");
    });
  });

  byId<HTMLButtonElement>("rules-save").addEventListener("click", () => {
    const yaml = byId<HTMLTextAreaElement>("rules-yaml").value;
    void applyYaml(yaml, "Saved.").then((ok) => {
      if (!ok) showToast("toast-raw", "Not saved — see the errors.");
    });
  });

  byId<HTMLButtonElement>("clear").addEventListener("click", () => {
    const ok = window.confirm(
      "Clear all local activity logs and statistics? This cannot be undone.",
    );
    if (!ok) return;
    clearLogs()
      .then(() => showToast("toast-activity", "Activity cleared."))
      .catch(() => showToast("toast-activity", "Could not clear activity."));
  });
}

async function init(): Promise<void> {
  wireControls();
  renderServices();
  renderVersion();
  config = await getConfig().catch(() => ({ ...DEFAULT_CONFIG }));
  reflectConfig();
  currentYaml = (await getRules().catch(() => ({ yaml: "" }))).yaml;
  renderRulesUI();
}

document.addEventListener("DOMContentLoaded", () => void init());
