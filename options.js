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

function t(key, subs) {
  try { return chrome.i18n.getMessage(key, subs) || ""; }
  catch { return ""; }
}

function applyI18n(root) {
  root.querySelectorAll("[data-i18n]").forEach((el) => {
    const key = el.getAttribute("data-i18n");
    const msg = t(key);
    if (msg) el.textContent = msg;
  });
}

document.addEventListener("DOMContentLoaded", async () => {
  applyI18n(document);
  await loadConfig();
  await loadLayer4Config();
  await loadAttachmentConfig();
  await loadState();

  $("btn-save").addEventListener("click", saveConfig);
  $("btn-flush").addEventListener("click", flushNow);
  $("btn-test").addEventListener("click", testConnection);
  $("btn-regenerate").addEventListener("click", regenerateDeviceId);
  $("btn-layer4-test").addEventListener("click", testLayer4);

  // Live toggle on the device-token field so users can verify what they
  // pasted without committing to a permanent plaintext display.
  const tokenInput = $("opt-device-token");
  const peekBtn = $("btn-peek-token");
  if (peekBtn && tokenInput) {
    peekBtn.addEventListener("click", () => {
      const showing = tokenInput.type === "text";
      tokenInput.type = showing ? "password" : "text";
      const nextLabel = showing ? t("optsShowPassword") : t("optsHidePassword");
      peekBtn.textContent = nextLabel || (showing ? "Show" : "Hide");
      peekBtn.setAttribute("aria-label", nextLabel || peekBtn.textContent);
    });
  }

  // Live http:// warning as the user types — avoids saving-then-confirming
  // if they pasted an insecure URL by accident.
  const urlInput = $("opt-backend-url");
  if (urlInput) {
    const update = () => updateBackendHttpWarning(urlInput.value);
    urlInput.addEventListener("input", update);
    urlInput.addEventListener("blur", update);
    update();
  }

  // Refresh state every 5s while the page is open.
  setInterval(loadState, 5000);
});

function updateBackendHttpWarning(value) {
  const warn = $("backend-http-warning");
  if (!warn) return;
  const v = (value || "").trim();
  const danger = /^http:\/\//i.test(v) && !isSafeInsecureBackend(v);
  warn.classList.toggle("visible", danger);
  if (danger && !warn.textContent) warn.textContent = t("optsHttpWarning") || "";
}

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
    return showStatus(t("optsHttpsRequired") || "URL must start with http:// or https://", "err");
  }
  // Refuse plaintext backends unless the host is localhost/127.x.x.x — the
  // device token is a long-lived bearer credential and shipping it over
  // http:// to anything else is almost always a misconfiguration.
  if (patch.backendUrl && !isSafeInsecureBackend(patch.backendUrl)) {
    const ok = confirm(
      t("optsHttpWarning") || "Backend URL uses HTTP. Confirm anyway?"
    );
    if (!ok) return showStatus(t("optsSaveCancelled") || "Save cancelled.", "err");
  }

  const layer4Url = $("opt-layer4-presidio-url").value.trim().replace(/\/+$/, "");
  if (layer4Url && !/^https?:\/\//i.test(layer4Url)) {
    return showStatus(t("optsHttpsRequired") || "URL must start with http:// or https://", "err");
  }

  const saved = await sendMsg({ type: "telemetry.setConfig", patch });
  if (saved?.deviceId) $("opt-device-id").value = saved.deviceId;

  await chrome.storage.local.set({
    guard_layer4: {
      enabled: $("opt-layer4-enabled").checked,
      presidioUrl: layer4Url,
      usePresidioAnonymizer: $("opt-layer4-use-anonymizer").checked,
    },
  });

  // If Layer 4 is enabled with a Presidio URL, ensure the optional host
  // permission is granted. Without it the service-worker fetch to Presidio
  // is blocked and Layer 4 silently degrades to empty results.
  if ($("opt-layer4-enabled").checked && layer4Url) {
    const granted = await ensurePresidioPermission(layer4Url);
    if (!granted) {
      showStatus("Configuration enregistrée — autorisation d'accès à Presidio refusée. Cliquez Tester pour la redemander.", "err");
      return;
    }
  }

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

  showStatus(t("optsSaved") || "Configuration saved.", "ok");
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
  const cfg = guard_layer4 || { enabled: false, presidioUrl: "", usePresidioAnonymizer: false };
  $("opt-layer4-enabled").checked = !!cfg.enabled;
  $("opt-layer4-presidio-url").value = cfg.presidioUrl || "";
  $("opt-layer4-use-anonymizer").checked = !!cfg.usePresidioAnonymizer;
}

async function testLayer4() {
  const rawUrl = $("opt-layer4-presidio-url").value.trim();
  const statusEl = $("layer4-status");
  if (!rawUrl) {
    statusEl.textContent = "URL manquante";
    return;
  }
  if (!/^https?:\/\//i.test(rawUrl)) {
    statusEl.textContent = "URL invalide (http:// ou https:// requis)";
    return;
  }
  const url = rawUrl.replace(/\/+$/, "");
  statusEl.textContent = "Test…";

  // Persist the URL so the background proxy will accept the test fetch
  // (it refuses to proxy any URL that doesn't match the stored one).
  const current = (await chrome.storage.local.get(["guard_layer4"])).guard_layer4 || {};
  await chrome.storage.local.set({ guard_layer4: { ...current, presidioUrl: url } });

  // Request the host permission so the background fetch can actually reach
  // the user's Presidio host. Must be called from a user-action handler.
  const granted = await ensurePresidioPermission(url);
  if (!granted) {
    statusEl.textContent = "Échec: autorisation refusée pour " + url;
    return;
  }

  // Route the test through the same proxy the content script uses, so a
  // successful test guarantees the production path works.
  const res = await sendMsg({ type: "presidio.fetch", url: url + "/health", method: "GET" });
  if (res?.ok) {
    statusEl.textContent = `OK (HTTP ${res.status})`;
  } else if (res?.error === "HOST_PERMISSION_MISSING") {
    statusEl.textContent = "Échec: permission manquante — cliquez Tester à nouveau pour accorder";
  } else {
    statusEl.textContent = `Échec: ${res?.error || "inconnu"}`;
  }
}

function ensurePresidioPermission(presidioBase) {
  return new Promise((resolve) => {
    try {
      chrome.permissions.contains({ origins: [presidioBase + "/*"] }, (alreadyGranted) => {
        if (alreadyGranted) { resolve(true); return; }
        chrome.permissions.request({ origins: [presidioBase + "/*"] }, (granted) => {
          resolve(!!granted && !chrome.runtime.lastError);
        });
      });
    } catch {
      resolve(false);
    }
  });
}

async function loadState() {
  const state = await sendMsg({ type: "telemetry.getState" });
  if (!state) return;
  $("q-count").textContent = state.queued || 0;
  $("q-last").textContent = state.lastSentAt
    ? new Date(state.lastSentAt).toLocaleString("fr-FR")
    : (t("optsNever") || "Never");
  const errTxt = state.lastError || "";
  const errAt = state.lastErrorAt
    ? ` (${new Date(state.lastErrorAt).toLocaleString("fr-FR")})`
    : "";
  $("q-err").textContent = errTxt ? errTxt + errAt : "—";
  const evicted = state.evictedCount || 0;
  $("q-evicted").textContent = evicted > 0
    ? `${evicted}${state.lastEvictionAt ? " (dernière: " + new Date(state.lastEvictionAt).toLocaleString("fr-FR") + ")" : ""}`
    : "0";
  $("q-flush-stats").textContent = `${state.totalFlushSuccesses || 0} / ${state.totalFlushAttempts || 0}`;
}

async function flushNow() {
  showStatus(t("optsSending") || "Sending…", "");
  const res = await sendMsg({ type: "telemetry.flush" });
  await loadState();
  if (res?.error) showStatus(t("optsFailure", [String(res.error)]) || `Failure: ${res.error}`, "err");
  else showStatus(t("optsSendDone") || "Send complete.", "ok");
}

async function testConnection() {
  showStatus(t("optsSending") || "Sending…", "");
  const res = await sendMsg({ type: "telemetry.test" });
  if (res?.ok) showStatus(t("optsConnected", [String(res.status)]) || `Connected (HTTP ${res.status}).`, "ok");
  else showStatus(t("optsFailure", [String(res?.error || "unknown")]) || `Failure: ${res?.error || "unknown"}`, "err");
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

function isSafeInsecureBackend(urlStr) {
  // Only allow http:// when the host is clearly a loopback / private dev box.
  try {
    const u = new URL(urlStr);
    if (u.protocol === "https:") return true;
    if (u.protocol !== "http:") return false;
    const h = u.hostname;
    if (h === "localhost") return true;
    if (h === "::1") return true;
    if (/^127\./.test(h)) return true;
    // Private IPv4 ranges used on corporate dev networks
    if (/^10\./.test(h)) return true;
    if (/^192\.168\./.test(h)) return true;
    if (/^172\.(1[6-9]|2\d|3[01])\./.test(h)) return true;
    return false;
  } catch {
    return false;
  }
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
