/**
 * LLM Guard v2 — Background Service Worker
 */

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.source !== "llm-guard") return;

  if (message.type === "log") {
    storeLog(message.payload);
    updateBadge(message.payload);
  }

  if (message.type === "getLogs") {
    chrome.storage.local.get(["guard_logs"], (r) => {
      sendResponse({ logs: r.guard_logs || [] });
    });
    return true;
  }

  if (message.type === "clearLogs") {
    chrome.storage.local.set({ guard_logs: [], guard_stats: defaultStats() });
    chrome.action.setBadgeText({ text: "" });
    sendResponse({ ok: true });
    return true;
  }

  if (message.type === "getStats") {
    chrome.storage.local.get(["guard_stats"], (r) => {
      sendResponse({ stats: r.guard_stats || defaultStats() });
    });
    return true;
  }
});

function defaultStats() {
  return {
    totalPrompts: 0,
    cleanPrompts: 0,
    flaggedPrompts: 0,
    blockedPrompts: 0,
    anonymizedPrompts: 0,
    piiByType: {},
    byLLM: {},
  };
}

async function storeLog(event) {
  const result = await chrome.storage.local.get(["guard_logs", "guard_stats"]);
  const logs = result.guard_logs || [];
  const stats = result.guard_stats || defaultStats();

  logs.unshift(event);
  if (logs.length > 1000) logs.length = 1000;

  stats.totalPrompts++;
  if (event.action === "CLEAN") stats.cleanPrompts++;
  if (event.action === "PII_DETECTED") stats.flaggedPrompts++;
  if (event.action === "BLOCKED") stats.blockedPrompts++;
  if (event.action === "ANONYMIZED") stats.anonymizedPrompts++;

  if (event.findings) {
    for (const f of event.findings) {
      stats.piiByType[f.type] = (stats.piiByType[f.type] || 0) + f.count;
    }
  }

  // Stats par LLM
  const llm = event.llm || "Unknown";
  if (!stats.byLLM[llm]) {
    stats.byLLM[llm] = { total: 0, clean: 0, flagged: 0, blocked: 0, anonymized: 0 };
  }
  stats.byLLM[llm].total++;
  if (event.action === "CLEAN") stats.byLLM[llm].clean++;
  if (event.action === "PII_DETECTED") stats.byLLM[llm].flagged++;
  if (event.action === "BLOCKED") stats.byLLM[llm].blocked++;
  if (event.action === "ANONYMIZED") stats.byLLM[llm].anonymized++;

  await chrome.storage.local.set({ guard_logs: logs, guard_stats: stats });
}

function updateBadge(event) {
  if (event.action === "BLOCKED") {
    chrome.action.setBadgeBackgroundColor({ color: "#A32D2D" });
    chrome.action.setBadgeText({ text: "!" });
  } else if (event.action === "ANONYMIZED") {
    chrome.action.setBadgeBackgroundColor({ color: "#0F6E56" });
    chrome.action.setBadgeText({ text: "\u2713" });
    setTimeout(() => chrome.action.setBadgeText({ text: "" }), 3000);
  } else if (event.action === "PII_DETECTED") {
    chrome.action.setBadgeBackgroundColor({ color: "#854F0B" });
    chrome.action.setBadgeText({ text: "\u26A0" });
    setTimeout(() => chrome.action.setBadgeText({ text: "" }), 5000);
  }
}
