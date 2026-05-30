import type { LLMAdapter, TextTransform } from "@/adapters/types";
import {
  asArray,
  isObject,
  isString,
  joinTextParts,
} from "@/adapters/_helpers";

function isUserMessage(msg: Record<string, unknown>): boolean {
  return msg.role === "user" || msg.role === "human";
}

export const claudeAdapter: LLMAdapter = {
  id: "claude",
  label: "Claude",
  hostnames: ["claude.ai"],
  conversationSelector: "[data-testid='conversation-turn'], .font-claude-message, main",

  matchEndpoint(url: string): boolean {
    return /\/api\/.*(chat|completion|message|conversation)/i.test(url);
  },

  extractPrompts(body: unknown): string[] {
    if (!isObject(body)) return [];
    const out: string[] = [];
    if (isString(body.prompt)) out.push(body.prompt);
    for (const msg of asArray(body.messages)) {
      if (!isObject(msg) || !isUserMessage(msg)) continue;
      if (isString(msg.content)) {
        out.push(msg.content);
      } else if (Array.isArray(msg.content)) {
        const joined = joinTextParts(msg.content);
        if (joined.length > 0) out.push(joined);
      }
    }
    return out;
  },

  injectPrompts(body: unknown, transform: TextTransform): unknown {
    if (!isObject(body)) return body;
    const clone = structuredClone(body) as Record<string, unknown>;
    if (isString(clone.prompt)) clone.prompt = transform(clone.prompt);
    for (const msg of asArray(clone.messages)) {
      if (!isObject(msg) || !isUserMessage(msg)) continue;
      if (isString(msg.content)) {
        msg.content = transform(msg.content);
      } else if (Array.isArray(msg.content)) {
        msg.content = msg.content.map((p) =>
          isObject(p) && isString(p.text)
            ? { ...p, text: transform(p.text) }
            : p,
        );
      }
    }
    return clone;
  },
};
