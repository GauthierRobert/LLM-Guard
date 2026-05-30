import type { LLMAdapter, TextTransform } from "@/adapters/types";
import { asArray, isObject, isString } from "@/adapters/_helpers";

function isUserMessage(msg: Record<string, unknown>): boolean {
  const author = msg.author;
  const authorRole = isObject(author) ? author.role : undefined;
  return authorRole === "user" || msg.role === "user";
}

function messageText(msg: Record<string, unknown>): string | null {
  const content = msg.content;
  if (isObject(content) && Array.isArray(content.parts)) {
    return content.parts
      .map((p) => (isString(p) ? p : ""))
      .join("\n");
  }
  if (isString(content)) return content;
  return null;
}

export const chatgptAdapter: LLMAdapter = {
  id: "chatgpt",
  label: "ChatGPT",
  hostnames: ["chatgpt.com", "chat.openai.com"],

  matchEndpoint(url: string): boolean {
    return url.includes("/conversation");
  },

  extractPrompts(body: unknown): string[] {
    if (!isObject(body)) return [];
    const out: string[] = [];
    for (const msg of asArray(body.messages)) {
      if (!isObject(msg) || !isUserMessage(msg)) continue;
      const text = messageText(msg);
      if (text !== null) out.push(text);
    }
    return out;
  },

  injectPrompts(body: unknown, transform: TextTransform): unknown {
    if (!isObject(body)) return body;
    const clone = structuredClone(body) as Record<string, unknown>;
    for (const msg of asArray(clone.messages)) {
      if (!isObject(msg) || !isUserMessage(msg)) continue;
      const content = msg.content;
      if (isObject(content) && Array.isArray(content.parts)) {
        const text = content.parts
          .map((p) => (isString(p) ? p : ""))
          .join("\n");
        content.parts = [transform(text)];
      } else if (isString(content)) {
        msg.content = transform(content);
      }
    }
    return clone;
  },
};
