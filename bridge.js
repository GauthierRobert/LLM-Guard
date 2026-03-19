window.addEventListener("message", (event) => {
  if (event.source !== window) return;
  if (event.data?.source !== "llm-guard") return;
  if (event.data.type === "log") {
    chrome.runtime.sendMessage({
      source: "llm-guard",
      type: "log",
      payload: event.data.payload,
    });
  }
});
