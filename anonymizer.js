/**
 * LLM Guard — Anonymization engine (shared between content.js and Node tests).
 *
 * Why this file exists:
 *   - Tests cannot exercise content.js internals (wrapped in an IIFE).
 *   - The anonymize/deanonymize logic has two subtle correctness bugs
 *     (cross-prompt placeholder collision, stream chunk-boundary loss).
 *   - Extracting it here lets production and tests run the same code.
 *
 * Exposes `createAnonymizer({ patterns, isAllowlisted, maxMapSize })` which
 * returns an object with `anonymize(text)`, `deanonymize(text)`,
 * `makeStreamDeanonymizer()`, plus the accumulated maps for introspection.
 */

function createAnonymizer({
  patterns,
  isAllowlisted = () => false,
  maxMapSize = 5000,
  onOverflow = null,
  // Default to "hashed": placeholders embed fnv1a(salt + value) so the same
  // original gets the same placeholder within a session, and collisions
  // between different originals are vanishingly rare. The legacy "counter"
  // strategy has a cross-prompt collision class where two turns can both
  // start at [EMAIL_1] and de-anonymize to the wrong address when the caller
  // reuses an old mapping.
  placeholderStrategy = "hashed",
  sessionSalt = null,
}) {
  const anonymizationMap = new Map();
  const reverseMap = new Map();
  const placeholderCounters = new Map();
  const state = {
    maxPlaceholderLen: 0,
    overflowReported: false,
    // Once we have evicted an entry, de-anonymization can no longer guarantee
    // a complete round-trip — a placeholder in the LLM response may point to
    // a mapping we threw away, so the raw placeholder would leak to the UI.
    // Consumers check this flag and skip de-anon (or warn) instead of
    // emitting corrupted output.
    overflowed: false,
  };

  // Session salt for hashed-placeholder mode. Prevents an attacker who can
  // observe one session's placeholders (e.g. [EMAIL_a1b2]) from predicting
  // another user's mapping.
  const effectiveSalt = sessionSalt || generateSalt();

  function generateSalt() {
    try {
      if (typeof crypto !== "undefined" && crypto.getRandomValues) {
        const bytes = new Uint8Array(8);
        crypto.getRandomValues(bytes);
        return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
      }
    } catch { /* fall through */ }
    return Math.random().toString(36).slice(2, 18);
  }

  // FNV-1a 32-bit; returns 6 lowercase hex chars. 16M namespace + collision
  // fallback below keeps the placeholder stable per (salt, value).
  function fnv1aHex(str) {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619) >>> 0;
    }
    return h.toString(16).padStart(8, "0").slice(0, 6);
  }

  function mintPlaceholder(pattern, original) {
    if (placeholderStrategy === "hashed") {
      const base = pattern.placeholder.replace("§", fnv1aHex(effectiveSalt + ":" + original));
      // Collision check: same hash but different original within this session.
      const existing = anonymizationMap.get(base);
      if (!existing || existing === original) return base;
      let i = 2;
      while (true) {
        const candidate = base.replace(/\]$/, `_${i}]`);
        const clash = anonymizationMap.get(candidate);
        if (!clash || clash === original) return candidate;
        i++;
      }
    }
    // Default: monotonically increasing per-pattern counter.
    const next = (placeholderCounters.get(pattern.placeholder) || 0) + 1;
    placeholderCounters.set(pattern.placeholder, next);
    return pattern.placeholder.replace("§", next);
  }

  function trimMap(map) {
    if (map.size <= maxMapSize) return;
    const excess = map.size - maxMapSize;
    const iter = map.keys();
    for (let i = 0; i < excess; i++) map.delete(iter.next().value);
  }

  // Pre-compile the pattern regexes once. Recompiling on every call showed up
  // as ~20% anonymize overhead on large prompts — the pattern list is read-
  // only for the lifetime of the anonymizer, so a single compile suffices.
  // Each regex is reused with its lastIndex reset before `exec`.
  const compiledPatterns = patterns.map((pattern) => ({
    pattern,
    regex: new RegExp(pattern.regex.source, pattern.regex.flags),
  }));

  function anonymize(text) {
    let result = text;
    const newMap = new Map();

    for (const { pattern, regex } of compiledPatterns) {
      regex.lastIndex = 0;
      let match;
      while ((match = regex.exec(result)) !== null) {
        const original = match[0];
        if (isAllowlisted(original, pattern.name)) continue;
        // Honour the pattern-level validator so anonymisation doesn't mint a
        // placeholder for a match that the detector would have discarded
        // (invalid Luhn card, reserved example.com email, 999.999.999.999
        // IP, etc.).
        if (typeof pattern.validate === "function" && !pattern.validate(original)) continue;

        let placeholder = reverseMap.get(original);
        if (!placeholder) {
          placeholder = mintPlaceholder(pattern, original);
          anonymizationMap.set(placeholder, original);
          reverseMap.set(original, placeholder);
          if (placeholder.length > state.maxPlaceholderLen) {
            state.maxPlaceholderLen = placeholder.length;
          }
        }
        if (!newMap.has(placeholder)) newMap.set(placeholder, original);
      }
    }

    const sorted = [...newMap.entries()].sort((a, b) => b[1].length - a[1].length);
    for (const [placeholder, original] of sorted) {
      result = result.split(original).join(placeholder);
    }

    if (anonymizationMap.size > maxMapSize) {
      trimMap(anonymizationMap);
      trimMap(reverseMap);
      state.overflowed = true;
      if (!state.overflowReported) {
        state.overflowReported = true;
        if (typeof onOverflow === "function") onOverflow(anonymizationMap.size);
      }
    }

    return { anonymized: result, mappings: newMap, changed: newMap.size > 0 };
  }

  // De-anonymization contract: if the map has ever overflowed and evicted
  // entries, we cannot safely substitute placeholders back to originals —
  // an evicted placeholder would be left visible as raw text. Callers
  // observing `overflowed === true` must either skip de-anon or surface a
  // clear warning; returning the input unchanged is the safe default.
  function deanonymize(text) {
    if (state.overflowed) return text;
    let result = text;
    for (const [placeholder, original] of anonymizationMap) {
      result = result.split(placeholder).join(original);
    }
    return result;
  }

  // Stateful stream deanonymizer: feed it successive chunks, receive emittable
  // text. A placeholder split across chunks (e.g. "[EMA" | "IL_1]") is safely
  // reassembled because we hold back everything from the last "[" whenever it
  // falls within maxPlaceholderLen chars of the buffer end.
  //
  // The tail buffer is bounded: if incoming chunks never contain the matching
  // "]" (corrupted stream, a lone "[" literal, or an LLM writing real brackets
  // without closing them), the carry must not grow unbounded. We cap it at
  // a small multiple of the longest known placeholder and flush the oldest
  // bytes when exceeded so we always make forward progress.
  function makeStreamDeanonymizer() {
    let carry = "";

    function tailCap() {
      // Room for one full placeholder plus a few bytes of surrounding text,
      // with a floor for safety when no placeholders have been seen yet.
      return Math.max(64, state.maxPlaceholderLen + 16);
    }

    function splitAtSafeBoundary(restored) {
      if (state.maxPlaceholderLen <= 1) return { head: restored, tail: "" };
      const searchFrom = Math.max(0, restored.length - state.maxPlaceholderLen);
      const lastOpen = restored.lastIndexOf("[");
      if (lastOpen >= searchFrom) {
        return { head: restored.slice(0, lastOpen), tail: restored.slice(lastOpen) };
      }
      return { head: restored, tail: "" };
    }

    return {
      push(chunk) {
        const buffered = carry + chunk;
        const restored = deanonymize(buffered);
        let { head, tail } = splitAtSafeBoundary(restored);
        const cap = tailCap();
        if (tail.length > cap) {
          // Drain the oldest portion of the tail so memory is bounded and the
          // consumer keeps seeing output. Anything beyond the last `cap`
          // characters cannot be a placeholder prefix anyway.
          head += tail.slice(0, tail.length - cap);
          tail = tail.slice(-cap);
        }
        carry = tail;
        return head;
      },
      flush() {
        const remaining = carry;
        carry = "";
        return deanonymize(remaining);
      },
    };
  }

  // Register a placeholder/original pair produced by an external engine
  // (e.g. Presidio NER) so that de-anonymization and stream de-anonymization
  // work correctly for those entries too.
  function registerExternalMapping(placeholder, original) {
    anonymizationMap.set(placeholder, original);
    reverseMap.set(original, placeholder);
    if (placeholder.length > state.maxPlaceholderLen) {
      state.maxPlaceholderLen = placeholder.length;
    }
  }

  return {
    anonymize,
    deanonymize,
    makeStreamDeanonymizer,
    registerExternalMapping,
    get anonymizationMap() { return anonymizationMap; },
    get reverseMap() { return reverseMap; },
    get maxPlaceholderLen() { return state.maxPlaceholderLen; },
    get overflowed() { return state.overflowed; },
  };
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { createAnonymizer };
}

if (typeof window !== "undefined") {
  window.__llmGuard = window.__llmGuard || {};
  window.__llmGuard.anonymizer = { createAnonymizer };
}
