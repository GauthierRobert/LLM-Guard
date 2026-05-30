import type { LLMAdapter, TextTransform } from "@/adapters/types";
import { asArray, isObject, isString } from "@/adapters/_helpers";

export const perplexityAdapter: LLMAdapter = {
  id: "perplexity",
  label: "Perplexity",
  hostnames: ["perplexity.ai", "www.perplexity.ai"],

  matchEndpoint(url: string): boolean {
    return (
      url.includes("/rest/sse/perplexity_ask") ||
      /\/api\/(save_ask|new_ask|search)/i.test(url)
    );
  },

  extractPrompts(body: unknown): string[] {
    if (!isObject(body)) return [];
    const out: string[] = [];
    if (isString(body.query)) out.push(body.query);
    for (const msg of asArray(body.messages)) {
      if (!isObject(msg) || msg.role !== "user") continue;
      if (isString(msg.content)) out.push(msg.content);
    }
    return out;
  },

  injectPrompts(body: unknown, transform: TextTransform): unknown {
    if (!isObject(body)) return body;
    const clone = structuredClone(body) as Record<string, unknown>;
    if (isString(clone.query)) clone.query = transform(clone.query);
    for (const msg of asArray(clone.messages)) {
      if (!isObject(msg) || msg.role !== "user") continue;
      if (isString(msg.content)) msg.content = transform(msg.content);
    }
    return clone;
  },
};
