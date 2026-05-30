import type { LLMAdapter, TextTransform } from "@/adapters/types";
import { asArray, isObject, isString } from "@/adapters/_helpers";

function isUserMessage(msg: Record<string, unknown>): boolean {
  return msg.role === "user" || msg.sender === "user";
}

export const grokAdapter: LLMAdapter = {
  id: "grok",
  label: "Grok",
  hostnames: ["grok.com", "x.ai"],
  conversationSelector: "main",

  matchEndpoint(url: string): boolean {
    return (
      url.includes("/rest/app-chat/conversations") ||
      /\/api\/(rpc|chat|conversation)/i.test(url)
    );
  },

  extractPrompts(body: unknown): string[] {
    if (!isObject(body)) return [];
    const out: string[] = [];
    if (isString(body.message)) out.push(body.message);
    for (const msg of asArray(body.messages)) {
      if (!isObject(msg) || !isUserMessage(msg)) continue;
      const text = isString(msg.message)
        ? msg.message
        : isString(msg.content)
          ? msg.content
          : null;
      if (text !== null) out.push(text);
    }
    return out;
  },

  injectPrompts(body: unknown, transform: TextTransform): unknown {
    if (!isObject(body)) return body;
    const clone = structuredClone(body) as Record<string, unknown>;
    if (isString(clone.message)) clone.message = transform(clone.message);
    for (const msg of asArray(clone.messages)) {
      if (!isObject(msg) || !isUserMessage(msg)) continue;
      if (isString(msg.message)) {
        msg.message = transform(msg.message);
      } else if (isString(msg.content)) {
        msg.content = transform(msg.content);
      }
    }
    return clone;
  },
};
