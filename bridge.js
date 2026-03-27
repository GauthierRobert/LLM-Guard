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
    chrome.storage.local.get(["guard_mode"], (r) => {
      const mode = r.guard_mode === "block" ? "block" : "anonymize";
      window.postMessage({ source: "llm-guard-bridge", type: "modeUpdate", mode }, window.location.origin);
    });
    return;
  }

  if (event.data.type === "setMode") {
    const mode = event.data.mode;
    if (mode === "anonymize" || mode === "block") {
      chrome.storage.local.set({ guard_mode: mode });
    }
    return;
  }
});

// Relay storage changes (e.g. popup mode switch) back to the page
chrome.storage.onChanged.addListener((changes) => {
  if (changes.guard_mode) {
    const mode = changes.guard_mode.newValue === "block" ? "block" : "anonymize";
    window.postMessage({ source: "llm-guard-bridge", type: "modeUpdate", mode }, window.location.origin);
  }
});
