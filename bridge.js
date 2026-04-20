window.addEventListener("message", (event) => {
  if (event.source !== window) return;
  if (event.data?.source !== "llm-guard") return;

  if (event.data.type === "log") {
    chrome.runtime.sendMessage({
      source: "llm-guard",
      type: "log",
      payload: event.data.payload,
    });
    return;
  }

  if (event.data.type === "getMode") {
    chrome.storage.local.get(["guard_mode", "guard_layer4", "guard_attachment"], (r) => {
      const mode = ["block", "visible", "anonymize"].includes(r.guard_mode) ? r.guard_mode : "anonymize";
      const layer4 = r.guard_layer4 || { enabled: false, presidioUrl: "" };
      const attachment = r.guard_attachment || {};
      window.postMessage({ source: "llm-guard-bridge", type: "modeUpdate", mode }, window.location.origin);
      window.postMessage({ source: "llm-guard-bridge", type: "layer4Update", layer4 }, window.location.origin);
      window.postMessage({ source: "llm-guard-bridge", type: "attachmentConfigUpdate", attachment }, window.location.origin);
    });
    return;
  }

  if (event.data.type === "setMode") {
    const mode = event.data.mode;
    if (mode === "anonymize" || mode === "block" || mode === "visible") {
      chrome.storage.local.set({ guard_mode: mode });
    }
    return;
  }

  if (event.data.type === "allowlist.addAttachment") {
    const sha256 = event.data.sha256 || "";
    if (!sha256) return;
    const filename = event.data.filename || "";
    chrome.storage.local.get(["guard_user_allowlist"], (r) => {
      const list = Array.isArray(r.guard_user_allowlist) ? r.guard_user_allowlist : [];
      if (!list.some((e) => e.type === "attachment" && e.pattern === sha256)) {
        list.push({ type: "attachment", pattern: sha256, filename });
        chrome.storage.local.set({ guard_user_allowlist: list });
      }
    });
    return;
  }
});

// Relay storage changes (e.g. popup mode switch) back to the page
chrome.storage.onChanged.addListener((changes) => {
  if (changes.guard_mode) {
    const raw = changes.guard_mode.newValue;
    const mode = ["block", "visible", "anonymize"].includes(raw) ? raw : "anonymize";
    window.postMessage({ source: "llm-guard-bridge", type: "modeUpdate", mode }, window.location.origin);
  }
  if (changes.guard_layer4) {
    const layer4 = changes.guard_layer4.newValue || { enabled: false, presidioUrl: "" };
    window.postMessage({ source: "llm-guard-bridge", type: "layer4Update", layer4 }, window.location.origin);
  }
  if (changes.guard_attachment) {
    const attachment = changes.guard_attachment.newValue || {};
    window.postMessage({ source: "llm-guard-bridge", type: "attachmentConfigUpdate", attachment }, window.location.origin);
  }
});
