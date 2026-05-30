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

  if (message.type === "presidio.fetch") {
    // Security: only allow fetches to the URL the user explicitly configured.
    // This prevents a compromised page from using the proxy to reach arbitrary hosts.
    chrome.storage.local.get(["guard_layer4"], async (r) => {
      const presidioBase = (r.guard_layer4?.presidioUrl || "").replace(/\/+$/, "");
      if (!presidioBase || !message.url.startsWith(presidioBase)) {
        sendResponse({ error: "URL not allowed" });
        return;
      }
      // Host permission gate: the Presidio host is user-configured and falls
      // under optional_host_permissions. Without an explicit grant the
      // service-worker fetch fails opaquely (looks like a network error to
      // the caller). Detect the missing permission up-front and surface a
      // specific error so the options page can offer to request it.
      const hasPermission = await hasPresidioPermission(presidioBase);
      if (!hasPermission) {
        sendResponse({ error: "HOST_PERMISSION_MISSING", presidioBase });
        return;
      }
      try {
        const opts = { method: message.method || "GET", headers: { "Content-Type": "application/json" } };
        if (message.body) opts.body = JSON.stringify(message.body);
        const resp = await fetch(message.url, opts);
        const bodyText = await resp.text().catch(() => null);
        let data = null;
        if (resp.ok && bodyText) {
          try { data = JSON.parse(bodyText); } catch { data = bodyText; }
        }
        sendResponse({ ok: resp.ok, status: resp.status, data, error: resp.ok ? null : `HTTP ${resp.status}${bodyText ? ": " + bodyText.slice(0, 200) : ""}` });
      } catch (err) {
        console.warn("[LLM Guard] Presidio fetch failed:", message.url, err?.message || err);
        sendResponse({ error: err?.message || String(err) });
      }
    });
    return true;
  }

  if (message.type === "presidio.requestPermission") {
    const base = (message.presidioBase || "").replace(/\/+$/, "");
    if (!base || !/^https?:\/\//i.test(base)) {
      sendResponse({ ok: false, error: "invalid URL" });
      return true;
    }
    chrome.permissions.request({ origins: [base + "/*"] }, (granted) => {
      const err = chrome.runtime.lastError;
      if (err) sendResponse({ ok: false, error: err.message });
      else sendResponse({ ok: !!granted });
    });
    return true;
  }

  if (message.type === "presidio.hasPermission") {
    const base = (message.presidioBase || "").replace(/\/+$/, "");
    if (!base) { sendResponse({ ok: false }); return true; }
    hasPresidioPermission(base).then((granted) => sendResponse({ ok: granted }));
    return true;
  }

  if (message.type === "telemetry.regenerateDeviceId") {
    self.telemetry.setConfig({ deviceId: crypto.randomUUID() }).then(sendResponse);
    return true;
  }
});

function hasPresidioPermission(presidioBase) {
  return new Promise((resolve) => {
    try {
      chrome.permissions.contains({ origins: [presidioBase + "/*"] }, (granted) => {
        if (chrome.runtime.lastError) { resolve(false); return; }
        resolve(!!granted);
      });
    } catch {
      resolve(false);
    }
  });
}

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
    attachmentsScanned: 0,
    attachmentsBlocked: 0,
    attachmentsFlagged: 0,
    piiByType: {},
    byLLM: {},
  };
}

const ATTACHMENT_ACTIONS = new Set([
  "ATTACHMENT_CLEAN",
  "ATTACHMENT_PII_DETECTED",
  "ATTACHMENT_BLOCKED",
  "ATTACHMENT_DETECTED",
  "ATTACHMENT_UNSCANNED",
]);

async function storeLog(event) {
  const result = await chrome.storage.local.get(["guard_logs", "guard_stats"]);
  const logs = result.guard_logs || [];
  const stats = result.guard_stats || defaultStats();

  logs.unshift(event);
  if (logs.length > 1000) logs.length = 1000;

  const isAttachment = ATTACHMENT_ACTIONS.has(event.action);

  if (isAttachment) {
    if (stats.attachmentsScanned == null) stats.attachmentsScanned = 0;
    if (stats.attachmentsBlocked == null) stats.attachmentsBlocked = 0;
    if (stats.attachmentsFlagged == null) stats.attachmentsFlagged = 0;
    stats.attachmentsScanned++;
    if (event.action === "ATTACHMENT_BLOCKED") stats.attachmentsBlocked++;
    else if (event.action === "ATTACHMENT_PII_DETECTED" || event.action === "ATTACHMENT_DETECTED") stats.attachmentsFlagged++;
  } else {
    stats.totalPrompts++;
    if (event.action === "CLEAN") stats.cleanPrompts++;
    if (event.action === "PII_DETECTED") stats.flaggedPrompts++;
    if (event.action === "BLOCKED") stats.blockedPrompts++;
    if (event.action === "ANONYMIZED") stats.anonymizedPrompts++;
  }

  if (event.findings) {
    for (const f of event.findings) {
      stats.piiByType[f.type] = (stats.piiByType[f.type] || 0) + f.count;
    }
  }

  // Stats par LLM
  const llm = event.llm || "Unknown";
  if (!stats.byLLM[llm]) {
    stats.byLLM[llm] = { total: 0, clean: 0, flagged: 0, blocked: 0, anonymized: 0, attachments: 0 };
  }
  if (stats.byLLM[llm].attachments == null) stats.byLLM[llm].attachments = 0;
  if (isAttachment) {
    stats.byLLM[llm].attachments++;
  } else {
    stats.byLLM[llm].total++;
    if (event.action === "CLEAN") stats.byLLM[llm].clean++;
    if (event.action === "PII_DETECTED") stats.byLLM[llm].flagged++;
    if (event.action === "BLOCKED") stats.byLLM[llm].blocked++;
    if (event.action === "ANONYMIZED") stats.byLLM[llm].anonymized++;
  }

  await chrome.storage.local.set({ guard_logs: logs, guard_stats: stats });
}

function updateBadge(event) {
  if (event.action === "BLOCKED" || event.action === "ATTACHMENT_BLOCKED") {
    chrome.action.setBadgeBackgroundColor({ color: "#A32D2D" });
    chrome.action.setBadgeText({ text: "!" });
  } else if (event.action === "ANONYMIZED") {
    chrome.action.setBadgeBackgroundColor({ color: "#0F6E56" });
    chrome.action.setBadgeText({ text: "\u2713" });
    setTimeout(() => chrome.action.setBadgeText({ text: "" }), 3000);
  } else if (event.action === "PII_DETECTED" || event.action === "ATTACHMENT_PII_DETECTED" || event.action === "ATTACHMENT_DETECTED") {
    chrome.action.setBadgeBackgroundColor({ color: "#854F0B" });
    chrome.action.setBadgeText({ text: "\u26A0" });
    setTimeout(() => chrome.action.setBadgeText({ text: "" }), 5000);
  }
}
