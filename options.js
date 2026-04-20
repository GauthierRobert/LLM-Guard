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
  await loadLayer4Config();
  await loadAttachmentConfig();
  await loadState();

  $("btn-save").addEventListener("click", saveConfig);
  $("btn-flush").addEventListener("click", flushNow);
  $("btn-test").addEventListener("click", testConnection);
  $("btn-regenerate").addEventListener("click", regenerateDeviceId);
  $("btn-layer4-test").addEventListener("click", testLayer4);

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

  const layer4Url = $("opt-layer4-presidio-url").value.trim();
  if (layer4Url && !/^https?:\/\//i.test(layer4Url)) {
    return showStatus("L'URL Presidio doit commencer par http:// ou https://", "err");
  }

  const saved = await sendMsg({ type: "telemetry.setConfig", patch });
  if (saved?.deviceId) $("opt-device-id").value = saved.deviceId;

  await chrome.storage.local.set({
    guard_layer4: {
      enabled: $("opt-layer4-enabled").checked,
      presidioUrl: layer4Url,
    },
  });

  const maxMb = parseFloat($("opt-attachment-max-mb").value);
  await chrome.storage.local.set({
    guard_attachment: {
      enabled: $("opt-attachment-enabled").checked,
      mode: $("opt-attachment-mode").value,
      maxSizeBytes: Number.isFinite(maxMb) && maxMb > 0 ? Math.round(maxMb * 1024 * 1024) : 20 * 1024 * 1024,
      types: {
        pdf: $("opt-attachment-pdf").checked,
        image: $("opt-attachment-image").checked,
        text: $("opt-attachment-text").checked,
      },
    },
  });

  showStatus("Configuration enregistrée.", "ok");
}

async function loadAttachmentConfig() {
  const { guard_attachment } = await chrome.storage.local.get(["guard_attachment"]);
  const cfg = guard_attachment || {};
  const types = cfg.types || {};
  $("opt-attachment-enabled").checked = cfg.enabled !== false;
  $("opt-attachment-mode").value = ["inherit", "block", "warn"].includes(cfg.mode) ? cfg.mode : "inherit";
  $("opt-attachment-pdf").checked = types.pdf !== false;
  $("opt-attachment-image").checked = types.image !== false;
  $("opt-attachment-text").checked = types.text !== false;
  const mb = Number.isFinite(cfg.maxSizeBytes) ? (cfg.maxSizeBytes / (1024 * 1024)) : 20;
  $("opt-attachment-max-mb").value = String(mb);
}

async function loadLayer4Config() {
  const { guard_layer4 } = await chrome.storage.local.get(["guard_layer4"]);
  const cfg = guard_layer4 || { enabled: false, presidioUrl: "" };
  $("opt-layer4-enabled").checked = !!cfg.enabled;
  $("opt-layer4-presidio-url").value = cfg.presidioUrl || "";
}

async function testLayer4() {
  const url = $("opt-layer4-presidio-url").value.trim();
  const statusEl = $("layer4-status");
  if (!url) {
    statusEl.textContent = "URL manquante";
    return;
  }
  statusEl.textContent = "Test…";
  try {
    const res = await fetch(url.replace(/\/+$/, "") + "/health", { method: "GET" });
    statusEl.textContent = res.ok ? `OK (HTTP ${res.status})` : `Échec (HTTP ${res.status})`;
  } catch (err) {
    statusEl.textContent = `Échec: ${err?.message || err}`;
  }
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
