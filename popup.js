const LLM_COLORS = { ChatGPT: "#10A37F", Claude: "#D97706", Gemini: "#4285F4", Copilot: "#0078D4", Mistral: "#FA5018", Perplexity: "#20B8CD", DeepSeek: "#4D6BFE", Grok: "#1DA1F2" };

// Allowed CSS class names for log dots and severity tags (whitelist to prevent injection)
const VALID_DOT_CLASSES = ["block", "anon", "warn", "clean"];
const VALID_SEVERITY_CLASSES = ["critical", "high", "medium", "low"];

// Filter taxonomy for the log list. Each filter maps to the `log.action`
// tokens the background worker writes; keep this list in sync with
// background.js::storeLog callers.
const FILTER_ACTIONS = {
  all: null,
  blocked: new Set(["BLOCKED", "ATTACHMENT_BLOCKED"]),
  flagged: new Set(["PII_DETECTED", "ATTACHMENT_PII_DETECTED", "ATTACHMENT_DETECTED", "ATTACHMENT_UNSCANNED"]),
  anonymized: new Set(["ANONYMIZED"]),
};

let cachedLogs = [];
let currentFilter = "all";

// ─── i18n helpers ───────────────────────────────────────────────
// chrome.i18n.getMessage is available in extension pages; the __MSG__
// substitution used in manifest.json only works in the manifest, not in
// HTML, so we wire up text content here at load time. Fallback to the
// element's existing text if the locale file doesn't define the key
// (useful during local development when adding a new string).
function t(key, substitutions) {
  try {
    const msg = chrome.i18n.getMessage(key, substitutions);
    return msg || "";
  } catch {
    return "";
  }
}

function applyI18n(root) {
  root.querySelectorAll("[data-i18n]").forEach((el) => {
    const key = el.getAttribute("data-i18n");
    const msg = t(key);
    if (msg) el.textContent = msg;
  });
  root.querySelectorAll("[data-i18n-aria-label]").forEach((el) => {
    const key = el.getAttribute("data-i18n-aria-label");
    const msg = t(key);
    if (msg) el.setAttribute("aria-label", msg);
  });
}

document.addEventListener("DOMContentLoaded", () => {
  applyI18n(document);
  loadStats(); loadLogs(); loadMode(); loadSyncStatus();
  document.getElementById("btn-clear").addEventListener("click", clearLogs);
  document.getElementById("btn-export").addEventListener("click", exportLogs);
  document.getElementById("btn-configure").addEventListener("click", openOptions);
  document.getElementById("btn-dashboard").addEventListener("click", openDashboard);
  document.querySelectorAll(".mode-btn").forEach(b =>
    b.addEventListener("click", () => setMode(b.dataset.mode))
  );
  document.querySelectorAll(".log-filter").forEach(b =>
    b.addEventListener("click", () => setFilter(b.dataset.filter))
  );
});

function openOptions() {
  if (chrome.runtime.openOptionsPage) chrome.runtime.openOptionsPage();
  else window.open(chrome.runtime.getURL("options.html"));
}

function openDashboard() {
  chrome.runtime.sendMessage({ source: "llm-guard", type: "telemetry.getConfig" }, (cfg) => {
    const url = cfg?.backendUrl ? cfg.backendUrl.replace(/\/+$/, "") : "";
    if (!url) {
      openOptions();
      return;
    }
    chrome.tabs.create({ url });
  });
}

function loadSyncStatus() {
  chrome.runtime.sendMessage({ source: "llm-guard", type: "telemetry.getConfig" }, (cfg) => {
    chrome.runtime.sendMessage({ source: "llm-guard", type: "telemetry.getState" }, (state) => {
      const dot = document.getElementById("sync-dot");
      const text = document.getElementById("sync-text");
      const meta = document.getElementById("sync-meta");
      if (!cfg || !cfg.enabled || !cfg.backendUrl) {
        dot.className = "sync-dot off";
        text.textContent = t("syncDisabled");
        meta.textContent = "";
        return;
      }
      const queued = state?.queued || 0;
      if (state?.lastError) {
        dot.className = "sync-dot err";
        text.textContent = t("syncErr");
      } else if (queued > 0) {
        dot.className = "sync-dot pending";
        text.textContent = t("syncPending");
      } else {
        dot.className = "sync-dot ok";
        text.textContent = t("syncOk");
      }
      const locale = chrome.i18n.getUILanguage ? chrome.i18n.getUILanguage() : undefined;
      const last = state?.lastSentAt
        ? new Date(state.lastSentAt).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" })
        : "—";
      meta.textContent = t("queueLabel", [String(queued), last]) || `${queued} • ${last}`;
    });
  });
}

/** Build an LLM usage bar row using safe DOM construction */
function buildLlmRow(name, data, maxTotal) {
  const row = document.createElement("div");
  row.className = "llm-row";

  const dot = document.createElement("div");
  dot.className = "llm-dot";
  dot.style.background = LLM_COLORS[name] || "#888";

  const nameSpan = document.createElement("span");
  nameSpan.className = "llm-name";
  nameSpan.textContent = name;

  const track = document.createElement("div");
  track.className = "llm-bar-track";

  const fillClean = document.createElement("div");
  fillClean.className = "llm-bar-fill";
  fillClean.style.width = ((data.clean / maxTotal) * 100) + "%";
  fillClean.style.background = "#6FD8B4";
  fillClean.style.opacity = "0.6";

  const fillTotal = document.createElement("div");
  fillTotal.className = "llm-bar-fill";
  fillTotal.style.width = ((data.total / maxTotal) * 100) + "%";
  fillTotal.style.background = LLM_COLORS[name] || "#888";
  fillTotal.style.opacity = "0.3";

  track.appendChild(fillClean);
  track.appendChild(fillTotal);

  const countSpan = document.createElement("span");
  countSpan.className = "llm-count";
  countSpan.textContent = data.total;

  row.appendChild(dot);
  row.appendChild(nameSpan);
  row.appendChild(track);
  row.appendChild(countSpan);

  return row;
}

/** Build a PII type bar row using safe DOM construction */
function buildPiiRow(type, count, maxCount) {
  const row = document.createElement("div");
  row.className = "pii-bar";

  const label = document.createElement("span");
  label.className = "pii-bar-label";
  label.textContent = type;

  const track = document.createElement("div");
  track.className = "pii-bar-track";

  const fill = document.createElement("div");
  fill.className = "pii-bar-fill";
  fill.style.width = ((count / maxCount) * 100) + "%";

  track.appendChild(fill);

  const countSpan = document.createElement("span");
  countSpan.className = "pii-bar-count";
  countSpan.textContent = count;

  row.appendChild(label);
  row.appendChild(track);
  row.appendChild(countSpan);

  return row;
}

function dotClassForAction(action) {
  if (action === "BLOCKED" || action === "ATTACHMENT_BLOCKED") return "block";
  if (action === "ANONYMIZED") return "anon";
  if (action === "PII_DETECTED" || action === "ATTACHMENT_PII_DETECTED" ||
      action === "ATTACHMENT_DETECTED" || action === "ATTACHMENT_UNSCANNED") return "warn";
  return "clean";
}

/** Build a single log entry using safe DOM construction */
function buildLogEntry(log) {
  const action = log.action || "";
  const rawDotClass = dotClassForAction(action);
  const dotClass = VALID_DOT_CLASSES.includes(rawDotClass) ? rawDotClass : "clean";

  const locale = chrome.i18n.getUILanguage ? chrome.i18n.getUILanguage() : undefined;
  const time = new Date(log.timestamp).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  const preview = log.anonymizedPreview || log.promptPreview || "";

  const entry = document.createElement("div");
  entry.className = "log-entry";
  entry.setAttribute("role", "button");
  entry.setAttribute("tabindex", "0");
  entry.setAttribute("aria-expanded", "false");
  entry.setAttribute("aria-label", `${action} — ${preview.slice(0, 80)}`);

  const dot = document.createElement("div");
  dot.className = "log-dot " + dotClass;
  dot.setAttribute("aria-hidden", "true");

  const textDiv = document.createElement("div");
  textDiv.className = "log-text";

  const timeDiv = document.createElement("div");
  timeDiv.className = "log-time";
  timeDiv.textContent = time + " — " + action;

  const promptDiv = document.createElement("div");
  promptDiv.className = "log-prompt";
  promptDiv.textContent = preview;

  const metaDiv = document.createElement("div");
  metaDiv.className = "log-meta";

  // LLM tag
  if (log.llm) {
    const llmTag = document.createElement("span");
    llmTag.className = "log-tag llm";
    llmTag.textContent = log.llm;
    metaDiv.appendChild(llmTag);
  }

  // Finding/severity tags
  (log.findings || []).forEach(f => {
    const tag = document.createElement("span");
    const severityClass = VALID_SEVERITY_CLASSES.includes(f.severity) ? f.severity : "";
    tag.className = "log-tag" + (severityClass ? " " + severityClass : "");
    tag.textContent = (f.type || "") + " (" + (f.count || 0) + ")";
    metaDiv.appendChild(tag);
  });

  textDiv.appendChild(timeDiv);
  textDiv.appendChild(promptDiv);
  textDiv.appendChild(metaDiv);

  entry.appendChild(dot);
  entry.appendChild(textDiv);

  // Click/keyboard drill-down: toggles a detail pane with the raw fields.
  // Built lazily so 25 entries don't all render the dl at once.
  const toggle = () => {
    const existing = entry.querySelector(".log-detail");
    if (existing) {
      existing.remove();
      entry.setAttribute("aria-expanded", "false");
      return;
    }
    entry.appendChild(buildDetail(log));
    entry.setAttribute("aria-expanded", "true");
  };
  entry.addEventListener("click", toggle);
  entry.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(); }
  });

  return entry;
}

function buildDetail(log) {
  const detail = document.createElement("dl");
  detail.className = "log-detail";
  detail.setAttribute("aria-label", t("logDetailsAria"));
  const rows = [
    ["URL", log.url || "—"],
    ["Action", log.action || "—"],
    ["LLM", log.llm || "—"],
    ["Timestamp", log.timestamp || "—"],
  ];
  if (Array.isArray(log.findings) && log.findings.length > 0) {
    rows.push(["Findings", log.findings.map(f => `${f.type}×${f.count} [${f.severity}]`).join(", ")]);
  }
  if (log.promptPreview) rows.push(["Preview", log.promptPreview]);
  if (log.anonymizedPreview) rows.push(["Anonymized", log.anonymizedPreview]);
  for (const [k, v] of rows) {
    const dt = document.createElement("dt"); dt.textContent = k;
    const dd = document.createElement("dd");
    const code = document.createElement("code"); code.textContent = String(v);
    dd.appendChild(code);
    detail.appendChild(dt); detail.appendChild(dd);
  }
  return detail;
}

function loadStats() {
  chrome.runtime.sendMessage({ source: "llm-guard", type: "getStats" }, (r) => {
    if (!r?.stats) return;
    const s = r.stats;
    setStat("s-total", s.totalPrompts);
    setStat("s-anon", s.anonymizedPrompts);
    setStat("s-flag", s.flaggedPrompts);
    setStat("s-block", s.blockedPrompts);
    setStat("s-att-total", s.attachmentsScanned || 0);
    setStat("s-att-flag", s.attachmentsFlagged || 0);
    setStat("s-att-block", s.attachmentsBlocked || 0);

    // LLM bars
    const llmSection = document.getElementById("llm-section");
    const llmContainer = document.getElementById("llm-bars");
    const llmEntries = Object.entries(s.byLLM || {}).sort((a,b) => b[1].total - a[1].total);
    if (llmEntries.length > 0) {
      llmSection.style.display = "block";
      const maxLLM = llmEntries[0][1].total;
      llmContainer.textContent = "";
      llmEntries.forEach(([name, d]) => {
        llmContainer.appendChild(buildLlmRow(name, d, maxLLM));
      });
    }

    // PII bars
    const piiSection = document.getElementById("pii-section");
    const piiContainer = document.getElementById("pii-bars");
    const piiEntries = Object.entries(s.piiByType || {}).sort((a,b) => b[1] - a[1]);
    if (piiEntries.length > 0) {
      piiSection.style.display = "block";
      const maxPII = piiEntries[0][1];
      piiContainer.textContent = "";
      piiEntries.forEach(([type, count]) => {
        piiContainer.appendChild(buildPiiRow(type, count, maxPII));
      });
    }
  });
}

function setStat(id, value) {
  const el = document.getElementById(id);
  el.textContent = String(value);
  el.removeAttribute("aria-busy");
}

function loadLogs() {
  chrome.runtime.sendMessage({ source: "llm-guard", type: "getLogs" }, (r) => {
    cachedLogs = r?.logs || [];
    renderLogs();
  });
}

function filteredLogs() {
  const set = FILTER_ACTIONS[currentFilter];
  if (!set) return cachedLogs;
  return cachedLogs.filter(l => set.has(l.action));
}

function renderLogs() {
  const container = document.getElementById("log-list");
  const visible = filteredLogs();
  container.textContent = "";
  if (visible.length === 0) {
    const emptyDiv = document.createElement("div");
    emptyDiv.className = "empty-state";
    emptyDiv.textContent = t("emptyLog");
    container.appendChild(emptyDiv);
    return;
  }
  visible.slice(0, 25).forEach(log => {
    container.appendChild(buildLogEntry(log));
  });
}

function setFilter(filter) {
  if (!(filter in FILTER_ACTIONS)) return;
  currentFilter = filter;
  document.querySelectorAll(".log-filter").forEach(b => {
    const active = b.dataset.filter === filter;
    b.classList.toggle("active", active);
    b.setAttribute("aria-selected", active ? "true" : "false");
  });
  renderLogs();
}

function loadMode() {
  chrome.storage.local.get(["guard_mode"], (r) => {
    const raw = r.guard_mode || "anonymize";
    const mode = ["block", "visible", "anonymize"].includes(raw) ? raw : "anonymize";
    applyModeUI(mode);
  });
}

function applyModeUI(mode) {
  document.querySelectorAll(".mode-btn").forEach(b => {
    const active = b.dataset.mode === mode;
    b.classList.toggle("active", active);
    b.setAttribute("aria-checked", active ? "true" : "false");
  });
  const badge = document.getElementById("mode-badge");
  if (badge) {
    const label = t("mode" + mode.charAt(0).toUpperCase() + mode.slice(1)) || mode;
    badge.textContent = label;
    const aria = t("modeActiveBadge", [label]);
    if (aria) badge.setAttribute("aria-label", aria);
  }
}

function setMode(mode) {
  chrome.storage.local.set({ guard_mode: mode });
  applyModeUI(mode);
}

function clearLogs() {
  if (!confirm(t("confirmClear") || "Clear logs?")) return;
  chrome.runtime.sendMessage({ source: "llm-guard", type: "clearLogs" }, () => { loadStats(); loadLogs(); });
}

function exportLogs() {
  chrome.runtime.sendMessage({ source: "llm-guard", type: "getLogs" }, (r) => {
    chrome.runtime.sendMessage({ source: "llm-guard", type: "getStats" }, (sr) => {
      const data = {
        exportDate: new Date().toISOString(),
        extension: "LLM Guard v2.0.0",
        stats: sr?.stats || {},
        logs: r?.logs || [],
      };
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `llm-guard-export-${new Date().toISOString().slice(0,10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
    });
  });
}
