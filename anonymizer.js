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

function createAnonymizer({ patterns, isAllowlisted = () => false, maxMapSize = 5000, onOverflow = null }) {
  const anonymizationMap = new Map();
  const reverseMap = new Map();
  const placeholderCounters = new Map();
  const state = { maxPlaceholderLen: 0, overflowReported: false };

  function trimMap(map) {
    if (map.size <= maxMapSize) return;
    const excess = map.size - maxMapSize;
    const iter = map.keys();
    for (let i = 0; i < excess; i++) map.delete(iter.next().value);
  }

  function anonymize(text) {
    let result = text;
    const newMap = new Map();

    for (const pattern of patterns) {
      const regex = new RegExp(pattern.regex.source, pattern.regex.flags);
      let match;
      while ((match = regex.exec(result)) !== null) {
        const original = match[0];
        if (isAllowlisted(original, pattern.name)) continue;

        let placeholder = reverseMap.get(original);
        if (!placeholder) {
          const next = (placeholderCounters.get(pattern.placeholder) || 0) + 1;
          placeholderCounters.set(pattern.placeholder, next);
          placeholder = pattern.placeholder.replace("§", next);
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
      if (!state.overflowReported) {
        state.overflowReported = true;
        if (typeof onOverflow === "function") onOverflow(anonymizationMap.size);
      }
    }

    return { anonymized: result, mappings: newMap, changed: newMap.size > 0 };
  }

  function deanonymize(text) {
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
  function makeStreamDeanonymizer() {
    let carry = "";

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
        const { head, tail } = splitAtSafeBoundary(restored);
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

  return {
    anonymize,
    deanonymize,
    makeStreamDeanonymizer,
    get anonymizationMap() { return anonymizationMap; },
    get reverseMap() { return reverseMap; },
    get maxPlaceholderLen() { return state.maxPlaceholderLen; },
  };
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { createAnonymizer };
}

if (typeof window !== "undefined") {
  window.__llmGuard = window.__llmGuard || {};
  window.__llmGuard.anonymizer = { createAnonymizer };
}
