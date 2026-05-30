import type { TextTransform } from "@/adapters/types";

/** Narrow an unknown value to a plain object with string keys. */
export function isObject(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}

/** Return `x` if it's an array, otherwise []. */
export function asArray(x: unknown): unknown[] {
  return Array.isArray(x) ? x : [];
}

/** True when `x` is a non-empty string. */
export function isString(x: unknown): x is string {
  return typeof x === "string";
}

/**
 * Join the `text` of OpenAI/Anthropic-style content parts:
 * `[{ type: "text", text: "..." }, ...]` → "a\nb". Non-text parts ignored.
 */
export function joinTextParts(parts: unknown): string {
  return asArray(parts)
    .map((p) => (isObject(p) && isString(p.text) ? p.text : ""))
    .filter((t) => t.length > 0)
    .join("\n");
}

/** True when a message object represents a user/human turn. */
function isUserRole(role: unknown): boolean {
  return role === "user" || role === "human";
}

/**
 * Extract user prompts from an OpenAI-style `messages` array where each message
 * has a `role` and a `content` that is either a string or an array of text
 * parts. Returns [] when the field is missing or malformed.
 */
export function extractOpenAIMessages(
  body: unknown,
  field = "messages",
): string[] {
  if (!isObject(body)) return [];
  const out: string[] = [];
  for (const msg of asArray(body[field])) {
    if (!isObject(msg)) continue;
    if (!isUserRole(msg.role)) continue;
    if (isString(msg.content)) {
      out.push(msg.content);
    } else if (Array.isArray(msg.content)) {
      const joined = joinTextParts(msg.content);
      if (joined.length > 0) out.push(joined);
    }
  }
  return out;
}

/**
 * Inject transformed text into an OpenAI-style `messages` array (in place on a
 * clone). Handles string content and `{type:"text",text}` part arrays.
 */
export function injectOpenAIMessages(
  clone: Record<string, unknown>,
  transform: TextTransform,
  field = "messages",
): void {
  for (const msg of asArray(clone[field])) {
    if (!isObject(msg)) continue;
    if (!isUserRole(msg.role)) continue;
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
}
