const LLM_COLORS = { ChatGPT: "#10A37F", Claude: "#D97706", Gemini: "#4285F4", Copilot: "#0078D4", Mistral: "#FA5018", Perplexity: "#20B8CD", DeepSeek: "#4D6BFE", Grok: "#1DA1F2" };

// Allowed CSS class names for log dots and severity tags (whitelist to prevent injection)
const VALID_DOT_CLASSES = ["block", "anon", "warn", "clean"];
const VALID_SEVERITY_CLASSES = ["critical", "high", "medium", "low"];

document.addEventListener("DOMContentLoaded", () => {
  loadStats(); loadLogs(); loadMode(); loadSyncStatus();
  document.getElementById("btn-clear").addEventListener("click", clearLogs);
  document.getElementById("btn-export").addEventListener("click", exportLogs);
  document.getElementById("btn-configure").addEventListener("click", openOptions);
  document.getElementById("btn-dashboard").addEventListener("click", openDashboard);
  document.querySelectorAll(".mode-btn").forEach(b =>
    b.addEventListener("click", () => setMode(b.dataset.mode))
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
        text.textContent = "Envoi désactivé";
        meta.textContent = "";
        return;
      }
      const queued = state?.queued || 0;
      if (state?.lastError) {
        dot.className = "sync-dot err";
        text.textContent = "Erreur d'envoi";
      } else if (queued > 0) {
        dot.className = "sync-dot pending";
        text.textContent = "Envoi en attente";
      } else {
        dot.className = "sync-dot ok";
        text.textContent = "Synchronisé";
      }
      const last = state?.lastSentAt
        ? new Date(state.lastSentAt).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })
        : "—";
      meta.textContent = `${queued} en file • ${last}`;
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
  fillClean.style.background = "#5DCAA5";
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

/** Build a single log entry using safe DOM construction */
function buildLogEntry(log) {
  const action = log.action || "";
  const rawDotClass =
    action === "BLOCKED" || action === "ATTACHMENT_BLOCKED" ? "block" :
    action === "ANONYMIZED" ? "anon" :
    action === "PII_DETECTED" || action === "ATTACHMENT_PII_DETECTED" || action === "ATTACHMENT_DETECTED" || action === "ATTACHMENT_UNSCANNED" ? "warn" :
    "clean";
  const dotClass = VALID_DOT_CLASSES.includes(rawDotClass) ? rawDotClass : "clean";

  const time = new Date(log.timestamp).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  const preview = log.anonymizedPreview || log.promptPreview || "";

  const entry = document.createElement("div");
  entry.className = "log-entry";

  const dot = document.createElement("div");
  dot.className = "log-dot " + dotClass;

  const textDiv = document.createElement("div");
  textDiv.className = "log-text";

  const timeDiv = document.createElement("div");
  timeDiv.className = "log-time";
  timeDiv.textContent = time + " \u2014 " + (log.action || "");

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

  return entry;
}

function loadStats() {
  chrome.runtime.sendMessage({ source: "llm-guard", type: "getStats" }, (r) => {
    if (!r?.stats) return;
    const s = r.stats;
    document.getElementById("s-total").textContent = s.totalPrompts;
    document.getElementById("s-anon").textContent = s.anonymizedPrompts;
    document.getElementById("s-flag").textContent = s.flaggedPrompts;
    document.getElementById("s-block").textContent = s.blockedPrompts;
    document.getElementById("s-att-total").textContent = s.attachmentsScanned || 0;
    document.getElementById("s-att-flag").textContent = s.attachmentsFlagged || 0;
    document.getElementById("s-att-block").textContent = s.attachmentsBlocked || 0;

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

function loadLogs() {
  chrome.runtime.sendMessage({ source: "llm-guard", type: "getLogs" }, (r) => {
    const container = document.getElementById("log-list");
    const logs = r?.logs || [];
    if (logs.length === 0) {
      container.textContent = "";
      const emptyDiv = document.createElement("div");
      emptyDiv.className = "empty-state";
      emptyDiv.textContent = "Aucune activit\u00e9 enregistr\u00e9e.";
      container.appendChild(emptyDiv);
      return;
    }
    container.textContent = "";
    logs.slice(0, 25).forEach(log => {
      container.appendChild(buildLogEntry(log));
    });
  });
}

function loadMode() {
  chrome.storage.local.get(["guard_mode"], (r) => {
    const raw = r.guard_mode || "anonymize";
    const mode = ["block", "visible", "anonymize", "review"].includes(raw) ? raw : "anonymize";
    document.querySelectorAll(".mode-btn").forEach(b =>
      b.classList.toggle("active", b.dataset.mode === mode)
    );
  });
}

function setMode(mode) {
  chrome.storage.local.set({ guard_mode: mode });
  document.querySelectorAll(".mode-btn").forEach(b =>
    b.classList.toggle("active", b.dataset.mode === mode)
  );
}

function clearLogs() {
  if (!confirm("Effacer tous les logs et statistiques ?")) return;
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
