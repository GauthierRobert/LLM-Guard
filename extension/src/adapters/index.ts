import type { LLMAdapter } from "@/adapters/types";
import { chatgptAdapter } from "@/adapters/chatgpt";
import { claudeAdapter } from "@/adapters/claude";
import { geminiAdapter } from "@/adapters/gemini";
import { copilotAdapter } from "@/adapters/copilot";
import { mistralAdapter } from "@/adapters/mistral";
import { perplexityAdapter } from "@/adapters/perplexity";
import { deepseekAdapter } from "@/adapters/deepseek";
import { grokAdapter } from "@/adapters/grok";

export const ADAPTERS: LLMAdapter[] = [
  chatgptAdapter,
  claudeAdapter,
  geminiAdapter,
  copilotAdapter,
  mistralAdapter,
  perplexityAdapter,
  deepseekAdapter,
  grokAdapter,
];

/**
 * Find the adapter that owns `hostname`. Matches an exact hostname, or a
 * subdomain of one (e.g. "www.perplexity.ai" matches "perplexity.ai").
 */
export function findAdapter(hostname: string): LLMAdapter | null {
  for (const adapter of ADAPTERS) {
    for (const h of adapter.hostnames) {
      if (hostname === h || hostname.endsWith("." + h)) {
        return adapter;
      }
    }
  }
  return null;
}

export {
  chatgptAdapter,
  claudeAdapter,
  geminiAdapter,
  copilotAdapter,
  mistralAdapter,
  perplexityAdapter,
  deepseekAdapter,
  grokAdapter,
};
