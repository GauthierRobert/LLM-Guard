/**
 * LLM adapter contract. Each supported service implements this to teach the
 * content script how to (a) recognise its chat API requests, (b) pull the
 * user's prompt text out of the request body, and (c) write transformed text
 * back into the body — all without knowing about anonymization itself.
 */

/** A pure text transform: original prompt → replacement (anonymized) prompt. */
export type TextTransform = (text: string) => string;

export interface LLMAdapter {
  /** Stable id, e.g. "chatgpt". */
  id: string;
  /** Human label, e.g. "ChatGPT". */
  label: string;
  /** Hostnames this adapter owns (exact `location.hostname` values). */
  hostnames: string[];
  /** True if `url` (request URL or path) is a chat/completion endpoint. */
  matchEndpoint(url: string): boolean;
  /**
   * Extract every user-authored prompt string from an already-parsed JSON
   * request body. Returns [] when nothing relevant is found.
   */
  extractPrompts(body: unknown): string[];
  /**
   * Return a NEW body (do not mutate the input) with every user prompt passed
   * through `transform`. If the body shape is unrecognised, return it as-is.
   */
  injectPrompts(body: unknown, transform: TextTransform): unknown;
}

/** Find the adapter that owns a hostname, or null. */
export type FindAdapter = (hostname: string) => LLMAdapter | null;
