import { describe, it, expect } from "vitest";
import { ADAPTERS, findAdapter } from "@/adapters/index";
import { chatgptAdapter } from "@/adapters/chatgpt";
import { claudeAdapter } from "@/adapters/claude";
import { geminiAdapter } from "@/adapters/gemini";
import { copilotAdapter } from "@/adapters/copilot";
import { mistralAdapter } from "@/adapters/mistral";
import { perplexityAdapter } from "@/adapters/perplexity";
import { deepseekAdapter } from "@/adapters/deepseek";
import { grokAdapter } from "@/adapters/grok";

const REDACT = (): string => "[REDACTED]";

describe("chatgptAdapter", () => {
  const body = {
    messages: [
      { author: { role: "user" }, content: { parts: ["hello", "world"] } },
      { author: { role: "assistant" }, content: { parts: ["hi"] } },
    ],
  };

  it("matches and rejects endpoints", () => {
    expect(chatgptAdapter.matchEndpoint("/backend-api/conversation")).toBe(true);
    expect(chatgptAdapter.matchEndpoint("/backend-api/models")).toBe(false);
  });

  it("extracts user prompt parts", () => {
    expect(chatgptAdapter.extractPrompts(body)).toEqual(["hello\nworld"]);
  });

  it("extracts string content", () => {
    const b = { messages: [{ role: "user", content: "plain text" }] };
    expect(chatgptAdapter.extractPrompts(b)).toEqual(["plain text"]);
  });

  it("injects without mutating", () => {
    const out = chatgptAdapter.injectPrompts(body, REDACT) as typeof body;
    expect(out.messages[0].content.parts).toEqual(["[REDACTED]"]);
    expect(out.messages[1].content.parts).toEqual(["hi"]);
    expect(body.messages[0].content.parts).toEqual(["hello", "world"]);
  });

  it("returns body as-is for bad shape", () => {
    expect(chatgptAdapter.extractPrompts(42)).toEqual([]);
    expect(chatgptAdapter.injectPrompts(42, REDACT)).toBe(42);
  });
});

describe("claudeAdapter", () => {
  const body = {
    prompt: "top level prompt",
    messages: [
      { role: "human", content: "string msg" },
      {
        role: "user",
        content: [
          { type: "text", text: "part a" },
          { type: "text", text: "part b" },
        ],
      },
    ],
  };

  it("matches and rejects endpoints", () => {
    expect(claudeAdapter.matchEndpoint("/api/organizations/x/chat_conversations")).toBe(true);
    expect(claudeAdapter.matchEndpoint("/static/app.js")).toBe(false);
  });

  it("extracts prompt, string and text-part content", () => {
    expect(claudeAdapter.extractPrompts(body)).toEqual([
      "top level prompt",
      "string msg",
      "part a\npart b",
    ]);
  });

  it("injects all sites without mutating", () => {
    const out = claudeAdapter.injectPrompts(body, REDACT) as typeof body;
    expect(out.prompt).toBe("[REDACTED]");
    expect(out.messages[0].content).toBe("[REDACTED]");
    expect((out.messages[1].content as { text: string }[])[0].text).toBe("[REDACTED]");
    expect(body.prompt).toBe("top level prompt");
    expect(body.messages[0].content).toBe("string msg");
  });
});

describe("geminiAdapter", () => {
  const body = {
    contents: [
      { role: "user", parts: [{ text: "g1" }, { text: "g2" }] },
      { role: "model", parts: [{ text: "answer" }] },
    ],
  };

  it("matches and rejects endpoints", () => {
    expect(geminiAdapter.matchEndpoint("/v1/models/x:streamGenerate")).toBe(true);
    expect(geminiAdapter.matchEndpoint("/StreamGenerate?bl=BardChatUi")).toBe(true);
    expect(geminiAdapter.matchEndpoint("/v1/unrelated")).toBe(false);
  });

  it("extracts joined user parts", () => {
    expect(geminiAdapter.extractPrompts(body)).toEqual(["g1\ng2"]);
  });

  it("injects part text without mutating", () => {
    const out = geminiAdapter.injectPrompts(body, REDACT) as typeof body;
    expect(out.contents[0].parts.map((p) => p.text)).toEqual(["[REDACTED]", "[REDACTED]"]);
    expect(out.contents[1].parts[0].text).toBe("answer");
    expect(body.contents[0].parts[0].text).toBe("g1");
  });
});

describe("copilotAdapter", () => {
  const body = {
    messages: [
      { author: "user", text: "co text" },
      { role: "user", content: "co content" },
      { author: "bot", text: "reply" },
    ],
  };

  it("matches and rejects endpoints", () => {
    expect(copilotAdapter.matchEndpoint("/api/conversation/start")).toBe(true);
    expect(copilotAdapter.matchEndpoint("/sydney/UpdateConversation")).toBe(true);
    expect(copilotAdapter.matchEndpoint("/c/api/other")).toBe(false);
  });

  it("extracts text then content", () => {
    expect(copilotAdapter.extractPrompts(body)).toEqual(["co text", "co content"]);
  });

  it("injects both fields without mutating", () => {
    const out = copilotAdapter.injectPrompts(body, REDACT) as typeof body;
    expect(out.messages[0].text).toBe("[REDACTED]");
    expect(out.messages[0].content).toBe("[REDACTED]");
    expect(out.messages[2].text).toBe("reply");
    expect(body.messages[0].text).toBe("co text");
  });
});

describe("mistralAdapter", () => {
  const body = {
    messages: [
      { role: "user", content: "m string" },
      { role: "user", content: [{ type: "text", text: "m part" }] },
      { role: "assistant", content: "ignored" },
    ],
  };

  it("matches and rejects endpoints", () => {
    expect(mistralAdapter.matchEndpoint("/api/chat/completions")).toBe(true);
    expect(mistralAdapter.matchEndpoint("/api/models")).toBe(false);
  });

  it("extracts string and text parts", () => {
    expect(mistralAdapter.extractPrompts(body)).toEqual(["m string", "m part"]);
  });

  it("injects without mutating", () => {
    const out = mistralAdapter.injectPrompts(body, REDACT) as typeof body;
    expect(out.messages[0].content).toBe("[REDACTED]");
    expect((out.messages[1].content as { text: string }[])[0].text).toBe("[REDACTED]");
    expect(body.messages[0].content).toBe("m string");
  });
});

describe("perplexityAdapter", () => {
  const body = {
    query: "px query",
    messages: [{ role: "user", content: "px msg" }],
  };

  it("matches and rejects endpoints", () => {
    expect(perplexityAdapter.matchEndpoint("/rest/sse/perplexity_ask")).toBe(true);
    expect(perplexityAdapter.matchEndpoint("/api/new_ask")).toBe(true);
    expect(perplexityAdapter.matchEndpoint("/api/profile")).toBe(false);
  });

  it("extracts query and messages", () => {
    expect(perplexityAdapter.extractPrompts(body)).toEqual(["px query", "px msg"]);
  });

  it("injects both without mutating", () => {
    const out = perplexityAdapter.injectPrompts(body, REDACT) as typeof body;
    expect(out.query).toBe("[REDACTED]");
    expect(out.messages[0].content).toBe("[REDACTED]");
    expect(body.query).toBe("px query");
  });
});

describe("deepseekAdapter", () => {
  const body = { messages: [{ role: "user", content: "ds msg" }] };

  it("matches and rejects endpoints", () => {
    expect(deepseekAdapter.matchEndpoint("/api/v0/chat/completion")).toBe(true);
    expect(deepseekAdapter.matchEndpoint("/chat/completion")).toBe(true);
    expect(deepseekAdapter.matchEndpoint("/api/v0/user")).toBe(false);
  });

  it("extracts string content", () => {
    expect(deepseekAdapter.extractPrompts(body)).toEqual(["ds msg"]);
  });

  it("injects without mutating", () => {
    const out = deepseekAdapter.injectPrompts(body, REDACT) as typeof body;
    expect(out.messages[0].content).toBe("[REDACTED]");
    expect(body.messages[0].content).toBe("ds msg");
  });
});

describe("grokAdapter", () => {
  const body = {
    message: "grok top",
    messages: [
      { role: "user", message: "grok msg" },
      { sender: "user", content: "grok content" },
      { role: "assistant", content: "reply" },
    ],
  };

  it("matches and rejects endpoints", () => {
    expect(grokAdapter.matchEndpoint("/rest/app-chat/conversations/new")).toBe(true);
    expect(grokAdapter.matchEndpoint("/api/rpc")).toBe(true);
    expect(grokAdapter.matchEndpoint("/api/account")).toBe(false);
  });

  it("extracts top message and per-message text", () => {
    expect(grokAdapter.extractPrompts(body)).toEqual([
      "grok top",
      "grok msg",
      "grok content",
    ]);
  });

  it("injects both levels without mutating", () => {
    const out = grokAdapter.injectPrompts(body, REDACT) as typeof body;
    expect(out.message).toBe("[REDACTED]");
    expect(out.messages[0].message).toBe("[REDACTED]");
    expect(out.messages[1].content).toBe("[REDACTED]");
    expect(out.messages[2].content).toBe("reply");
    expect(body.message).toBe("grok top");
  });
});

describe("registry", () => {
  it("exposes all 8 adapters", () => {
    expect(ADAPTERS).toHaveLength(8);
  });

  it("findAdapter resolves hostnames and subdomains", () => {
    expect(findAdapter("chatgpt.com")).toBe(chatgptAdapter);
    expect(findAdapter("www.perplexity.ai")).toBe(perplexityAdapter);
    expect(findAdapter("claude.ai")).toBe(claudeAdapter);
    expect(findAdapter("unknown.com")).toBeNull();
  });
});
