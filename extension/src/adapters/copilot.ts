import type { LLMAdapter, TextTransform } from "@/adapters/types";
import { asArray, isObject, isString } from "@/adapters/_helpers";

function isUserMessage(msg: Record<string, unknown>): boolean {
  return msg.author === "user" || msg.role === "user";
}

export const copilotAdapter: LLMAdapter = {
  id: "copilot",
  label: "Copilot",
  hostnames: ["copilot.microsoft.com"],

  matchEndpoint(url: string): boolean {
    return url.includes("/api/conversation") || url.includes("/sydney");
  },

  extractPrompts(body: unknown): string[] {
    if (!isObject(body)) return [];
    const out: string[] = [];
    for (const msg of asArray(body.messages)) {
      if (!isObject(msg) || !isUserMessage(msg)) continue;
      const text = isString(msg.text)
        ? msg.text
        : isString(msg.content)
          ? msg.content
          : "";
      out.push(text);
    }
    return out;
  },

  injectPrompts(body: unknown, transform: TextTransform): unknown {
    if (!isObject(body)) return body;
    const clone = structuredClone(body) as Record<string, unknown>;
    for (const msg of asArray(clone.messages)) {
      if (!isObject(msg) || !isUserMessage(msg)) continue;
      const text = isString(msg.text)
        ? msg.text
        : isString(msg.content)
          ? msg.content
          : "";
      const transformed = transform(text);
      msg.text = transformed;
      msg.content = transformed;
    }
    return clone;
  },
};
