import type { LLMAdapter, TextTransform } from "@/adapters/types";
import { asArray, isObject, isString } from "@/adapters/_helpers";

export const geminiAdapter: LLMAdapter = {
  id: "gemini",
  label: "Gemini",
  hostnames: ["gemini.google.com"],
  conversationSelector: "message-content, .conversation-container, main",

  matchEndpoint(url: string): boolean {
    return (
      /generate/i.test(url) ||
      /stream/i.test(url) ||
      url.includes("BardChatUi")
    );
  },

  extractPrompts(body: unknown): string[] {
    if (!isObject(body)) return [];
    const out: string[] = [];
    for (const content of asArray(body.contents)) {
      if (!isObject(content) || content.role !== "user") continue;
      const text = asArray(content.parts)
        .map((p) => (isObject(p) && isString(p.text) ? p.text : ""))
        .join("\n");
      out.push(text);
    }
    return out;
  },

  injectPrompts(body: unknown, transform: TextTransform): unknown {
    if (!isObject(body)) return body;
    const clone = structuredClone(body) as Record<string, unknown>;
    for (const content of asArray(clone.contents)) {
      if (!isObject(content) || content.role !== "user") continue;
      if (!Array.isArray(content.parts)) continue;
      content.parts = content.parts.map((p) =>
        isObject(p) && p.text !== undefined && isString(p.text)
          ? { ...p, text: transform(p.text) }
          : p,
      );
    }
    return clone;
  },
};
