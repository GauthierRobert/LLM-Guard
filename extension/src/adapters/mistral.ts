import type { LLMAdapter, TextTransform } from "@/adapters/types";
import {
  extractOpenAIMessages,
  injectOpenAIMessages,
  isObject,
} from "@/adapters/_helpers";

export const mistralAdapter: LLMAdapter = {
  id: "mistral",
  label: "Mistral",
  hostnames: ["chat.mistral.ai"],

  matchEndpoint(url: string): boolean {
    return /\/api\/(chat|conversation|completion)/i.test(url);
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
