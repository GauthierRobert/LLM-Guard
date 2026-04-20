/**
 * LLM Guard v2 — Options page logic
 *
 * Reads/writes the telemetry configuration stored at
 * chrome.storage.local.guard_telemetry_config and displays the outbox state.
 * All backend interaction (flush, connectivity test) goes through messages
 * to the service worker so telemetry.js stays the single source of truth.
 */

const $ = (id) => document.getElementById(id);

const FIELDS = [
  ["opt-enabled", "enabled", "checkbox"],
  ["opt-backend-url", "backendUrl", "text"],
  ["opt-device-token", "deviceToken", "text"],
  ["opt-org-id", "orgId", "text"],
  ["opt-user-hint", "userHint", "text"],
  ["opt-device-id", "deviceId", "text"],
];

document.addEventListener("DOMContentLoaded", async () => {
  await loadConfig();
  await loadState();

  $("btn-save").addEventListener("click", saveConfig);
  $("btn-flush").addEventListener("click", flushNow);
  $("btn-test").addEventListener("click", testConnection);
  $("btn-regenerate").addEventListener("click", regenerateDeviceId);

  // Refresh state every 5s while the page is open.
  setInterval(loadState, 5000);
});

async function loadConfig() {
  const cfg = await sendMsg({ type: "telemetry.getConfig" });
  if (!cfg) return;
  for (const [elId, key, kind] of FIELDS) {
    const el = $(elId);
    const val = cfg[key];
    if (kind === "checkbox") el.checked = !!val;
    else el.value = val == null ? "" : val;
  }
}

async function saveConfig() {
  const patch = {};
  for (const [elId, key, kind] of FIELDS) {
    const el = $(elId);
    if (kind === "checkbox") patch[key] = el.checked;
    else if (!el.readOnly) patch[key] = el.value.trim();
  }
  if (patch.backendUrl && !/^https?:\/\//i.test(patch.backendUrl)) {
    return showStatus("L'URL doit commencer par http:// ou https://", "err");
  }
  const saved = await sendMsg({ type: "telemetry.setConfig", patch });
  if (saved?.deviceId) $("opt-device-id").value = saved.deviceId;
  showStatus("Configuration enregistrée.", "ok");
}

async function loadState() {
  const state = await sendMsg({ type: "telemetry.getState" });
  if (!state) return;
  $("q-count").textContent = state.queued || 0;
  $("q-last").textContent = state.lastSentAt
    ? new Date(state.lastSentAt).toLocaleString("fr-FR")
    : "Jamais";
  $("q-err").textContent = state.lastError || "—";
}

async function flushNow() {
  showStatus("Envoi en cours…", "");
  const res = await sendMsg({ type: "telemetry.flush" });
  await loadState();
  if (res?.error) showStatus(`Échec: ${res.error}`, "err");
  else showStatus("Envoi terminé.", "ok");
}

async function testConnection() {
  showStatus("Test en cours…", "");
  const res = await sendMsg({ type: "telemetry.test" });
  if (res?.ok) showStatus(`Connecté (HTTP ${res.status}).`, "ok");
  else showStatus(`Échec: ${res?.error || "inconnu"}`, "err");
}

async function regenerateDeviceId() {
  if (!confirm("Régénérer le Device ID ? Les évènements historiques seront dissociés.")) return;
  const saved = await sendMsg({ type: "telemetry.regenerateDeviceId" });
  if (saved?.deviceId) {
    $("opt-device-id").value = saved.deviceId;
    showStatus("Device ID régénéré.", "ok");
  }
}

function showStatus(msg, kind) {
  const el = $("save-status");
  el.textContent = msg;
  el.className = "status" + (kind ? " " + kind : "");
  if (kind === "ok") setTimeout(() => { el.textContent = ""; el.className = "status"; }, 3000);
}

function sendMsg(payload) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ source: "llm-guard", ...payload }, (response) => {
      if (chrome.runtime.lastError) {
        resolve({ error: chrome.runtime.lastError.message });
      } else {
        resolve(response);
      }
    });
  });
}
