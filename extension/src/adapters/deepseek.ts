import type { LLMAdapter, TextTransform } from "@/adapters/types";
import {
  extractOpenAIMessages,
  injectOpenAIMessages,
  isObject,
} from "@/adapters/_helpers";

export const deepseekAdapter: LLMAdapter = {
  id: "deepseek",
  label: "DeepSeek",
  hostnames: ["chat.deepseek.com"],
  conversationSelector: "main",

  matchEndpoint(url: string): boolean {
    return (
      /\/api\/v\d*\/chat\/completion/i.test(url) ||
      url.includes("/chat/completion")
    );
  },

  extractPrompts(body: unknown): string[] {
    return extractOpenAIMessages(body);
  },

  injectPrompts(body: unknown, transform: TextTransform): unknown {
    if (!isObject(body)) return body;
    const clone = structuredClone(body) as Record<string, unknown>;
    injectOpenAIMessages(clone, transform);
    return clone;
  },
};
