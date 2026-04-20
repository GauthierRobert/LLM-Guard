/**
 * LLM Guard v2 — Background Service Worker
 */

importScripts("telemetry.js");

// Periodic flush via chrome.alarms (service workers can be evicted; alarms wake them).
chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create("telemetry-flush", { periodInMinutes: 1 });
});
chrome.runtime.onStartup?.addListener(() => {
  chrome.alarms.create("telemetry-flush", { periodInMinutes: 1 });
});
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "telemetry-flush") {
    self.telemetry?.flush?.().catch((err) => console.warn("[LLM Guard] alarm flush", err));
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.source !== "llm-guard") return;

  if (message.type === "log") {
    storeLog(message.payload);
    updateBadge(message.payload);
    self.telemetry?.enqueue?.(message.payload);
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

  if (message.type === "telemetry.getConfig") {
    self.telemetry.getConfig().then(sendResponse);
    return true;
  }

  if (message.type === "telemetry.setConfig") {
    self.telemetry.setConfig(message.patch || {}).then(sendResponse);
    return true;
  }

  if (message.type === "telemetry.getState") {
    self.telemetry.getState().then(sendResponse);
    return true;
  }

  if (message.type === "telemetry.flush") {
    self.telemetry.flush().then(
      () => self.telemetry.getState().then((state) => sendResponse({ ok: true, state })),
      (err) => sendResponse({ error: err?.message || String(err) })
    );
    return true;
  }

  if (message.type === "telemetry.test") {
    runConnectivityTest().then(sendResponse);
    return true;
  }

  if (message.type === "telemetry.regenerateDeviceId") {
    self.telemetry.setConfig({ deviceId: crypto.randomUUID() }).then(sendResponse);
    return true;
  }
});

async function runConnectivityTest() {
  const cfg = await self.telemetry.getConfig();
  if (!cfg.backendUrl) return { ok: false, error: "Backend URL missing" };
  const url = cfg.backendUrl.replace(/\/+$/, "") + "/v1/health";
  try {
    const res = await fetch(url, {
      method: "GET",
      headers: cfg.deviceToken ? { Authorization: `Bearer ${cfg.deviceToken}` } : {},
    });
    return { ok: res.ok, status: res.status };
  } catch (err) {
    return { ok: false, error: err?.message || String(err) };
  }
}

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
