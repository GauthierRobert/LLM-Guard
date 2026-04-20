/**
 * LLM Guard -- LLM Adapters
 * Generic prompt extraction and anonymized injection for each LLM.
 * Replaces 8 nearly-identical per-LLM functions with 2 generic ones + config.
 */
(function () {
  "use strict";

  /**
   * Extract user prompt text from a request body using per-LLM field mappings.
   * @param {string|object} body - The request body
   * @param {object} adapter - LLM adapter config with extraction rules
   * @returns {string} The extracted user prompt text
   */
  function extractPrompt(body, adapter) {
    try {
      const data = typeof body === "string" ? JSON.parse(body) : body;

      // Handle top-level prompt field (e.g., Claude's { prompt: "..." })
      if (adapter.promptField && data[adapter.promptField]) {
        return data[adapter.promptField];
      }

      // Handle message arrays (ChatGPT, Claude, Gemini, Copilot)
      const messages = data[adapter.messagesField];
      if (messages && Array.isArray(messages)) {
        return messages
          .filter((m) => adapter.isUserMessage(m))
          .map((m) => adapter.getMessageText(m))
          .join("\n");
      }

      return JSON.stringify(data);
    } catch {
      return typeof body === "string" ? body : "";
    }
  }

  /**
   * Inject anonymized text into a request body using per-LLM field mappings.
   * @param {string|object} body - The original request body
   * @param {string} anonymized - The anonymized text to inject
   * @param {object} adapter - LLM adapter config with injection rules
   * @returns {string} The modified request body as JSON string
   */
  function injectAnonymized(body, anonymized, adapter) {
    try {
      const data = typeof body === "string" ? JSON.parse(body) : body;

      // Handle top-level prompt field
      if (adapter.promptField && data[adapter.promptField]) {
        data[adapter.promptField] = anonymized;
      }

      // Handle message arrays
      const messages = data[adapter.messagesField];
      if (messages && Array.isArray(messages)) {
        for (const m of messages) {
          if (adapter.isUserMessage(m)) {
            adapter.setMessageText(m, anonymized);
          }
        }
      }

      return JSON.stringify(data);
    } catch {
      return body;
    }
  }

  // ─── Per-LLM adapter configurations ────────────────────────

  const LLM_ADAPTERS = {
    chatgpt: {
      messagesField: "messages",
      isUserMessage: (m) => m.author?.role === "user" || m.role === "user",
      getMessageText: (m) => {
        if (m.content?.parts) return m.content.parts.join(" ");
        if (typeof m.content === "string") return m.content;
        return "";
      },
      setMessageText: (m, text) => {
        if (m.content?.parts) {
          m.content.parts = m.content.parts.map(() => text);
        } else if (typeof m.content === "string") {
          m.content = text;
        }
      },
    },
    claude: {
      promptField: "prompt",
      messagesField: "messages",
      isUserMessage: (m) => m.role === "user" || m.role === "human",
      getMessageText: (m) => {
        if (typeof m.content === "string") return m.content;
        if (Array.isArray(m.content)) {
          return m.content
            .filter((c) => c.type === "text")
            .map((c) => c.text)
            .join(" ");
        }
        return "";
      },
      setMessageText: (m, text) => {
        if (typeof m.content === "string") {
          m.content = text;
        } else if (Array.isArray(m.content)) {
          for (const c of m.content) {
            if (c.type === "text") c.text = text;
          }
        }
      },
    },
    gemini: {
      messagesField: "contents",
      isUserMessage: (m) => m.role === "user",
      getMessageText: (m) => {
        return (m.parts || []).map((p) => p.text || "").join("\n");
      },
      setMessageText: (m, text) => {
        if (m.parts) {
          m.parts = m.parts.map((p) =>
            p.text !== undefined ? { ...p, text } : p
          );
        }
      },
    },
    copilot: {
      messagesField: "messages",
      isUserMessage: (m) => m.author === "user" || m.role === "user",
      getMessageText: (m) => m.text || m.content || "",
      setMessageText: (m, text) => {
        if (m.text !== undefined) m.text = text;
        if (m.content !== undefined) m.content = text;
      },
    },
    // Mistral Le Chat — OpenAI-compatible messages[] with string content.
    mistral: {
      messagesField: "messages",
      isUserMessage: (m) => m.role === "user",
      getMessageText: (m) => {
        if (typeof m.content === "string") return m.content;
        if (Array.isArray(m.content)) {
          return m.content
            .filter((c) => c.type === "text" || typeof c.text === "string")
            .map((c) => c.text || "")
            .join(" ");
        }
        return "";
      },
      setMessageText: (m, text) => {
        if (typeof m.content === "string") {
          m.content = text;
        } else if (Array.isArray(m.content)) {
          for (const c of m.content) {
            if (c.type === "text" || typeof c.text === "string") c.text = text;
          }
        }
      },
    },
    // Perplexity — uses messages[] for ask/chat endpoints; some single-shot
    // search endpoints carry the prompt as top-level `query`.
    perplexity: {
      promptField: "query",
      messagesField: "messages",
      isUserMessage: (m) => m.role === "user",
      getMessageText: (m) => {
        if (typeof m.content === "string") return m.content;
        return "";
      },
      setMessageText: (m, text) => {
        if (typeof m.content === "string") m.content = text;
      },
    },
    // DeepSeek — OpenAI-compatible messages[] with string content.
    deepseek: {
      messagesField: "messages",
      isUserMessage: (m) => m.role === "user",
      getMessageText: (m) => (typeof m.content === "string" ? m.content : ""),
      setMessageText: (m, text) => {
        if (typeof m.content === "string") m.content = text;
      },
    },
    // Grok (x.ai / grok.com) — conversation endpoints carry the user turn in
    // a top-level `message` string; some endpoints use `messages[]`.
    grok: {
      promptField: "message",
      messagesField: "messages",
      isUserMessage: (m) => m.role === "user" || m.sender === "user",
      getMessageText: (m) => {
        if (typeof m.message === "string") return m.message;
        if (typeof m.content === "string") return m.content;
        return "";
      },
      setMessageText: (m, text) => {
        if (typeof m.message === "string") m.message = text;
        if (typeof m.content === "string") m.content = text;
      },
    },
  };

  // Browser (Chrome MAIN world)
  if (typeof window !== "undefined") {
    window.__llmGuard = window.__llmGuard || {};
    window.__llmGuard.adapters = { extractPrompt, injectAnonymized, LLM_ADAPTERS };
  }

  // Node.js (tests)
  if (typeof module !== "undefined" && module.exports) {
    module.exports = { extractPrompt, injectAnonymized, LLM_ADAPTERS };
  }
})();
