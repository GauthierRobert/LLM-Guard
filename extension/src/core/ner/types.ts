/**
 * NER (Named Entity Recognition) layer — domain types and configuration.
 *
 * A machine-learning pass that detects entities regexes cannot (people,
 * organisations, places) and feeds them into the SAME span pipeline as the
 * YAML rules engine: NER entities become low-priority candidates that merge
 * with the regex findings (regex wins overlaps — it is exact, NER is fuzzy),
 * then flow through resolveOverlaps → decide → anonymize unchanged.
 *
 * See `merge.ts` for the (pure, testable) merge, `engine.ts` for the
 * transformers.js model wrapper, and `host.ts` for where it physically runs.
 */

import type { Severity } from "@/shared/types";
import type { RuleAction } from "@/core/rules/types";

/**
 * One entity returned by the model. `entity` is the model's group label
 * (PER / ORG / LOC / MISC for the default multilingual model); `start`/`end`
 * are character offsets into the text the model was given.
 */
export interface NerEntity {
  entity: string;
  value: string;
  start: number;
  end: number;
  /** Model confidence in [0, 1]. */
  score: number;
}

/** Per-entity-type policy — what to do with a detected entity of this group. */
export interface NerEntitySetting {
  enabled: boolean;
  action: RuleAction;
  severity: Severity;
  /** Placeholder label for anonymize, e.g. "PERSON" → `[PERSON_xxxx]`. */
  label: string;
  /** Minimum model confidence before the entity is acted on. */
  threshold: number;
}

export interface NerConfig {
  /** Master switch for the whole NER layer. */
  enabled: boolean;
  /** HuggingFace model id (token-classification, ONNX-converted). */
  model: string;
  /** Policy per model entity group. Unknown groups are ignored. */
  entities: Record<string, NerEntitySetting>;
}

/**
 * Default NER policy. The model is multilingual (incl. French — AvoPseudo is a
 * French legal tool) and ONNX-ready for transformers.js. People/orgs/places are
 * anonymised; MISC is off by default (noisy).
 *
 * NOTE: `enabled: true` so a freshly-built v4.3 can be tested without extra UI.
 * Turning it on triggers a one-time model download (~tens of MB) on first use.
 */
export const DEFAULT_NER_CONFIG: NerConfig = {
  enabled: true,
  model: "Xenova/bert-base-multilingual-cased-ner-hrl",
  entities: {
    PER: { enabled: true, action: "anonymize", severity: "high", label: "PERSON", threshold: 0.85 },
    ORG: { enabled: true, action: "anonymize", severity: "medium", label: "ORG", threshold: 0.85 },
    // Locations are NOT pseudonymised: a place name is rarely personal data on
    // its own and over-redacting it hurts readability. Disabled by default.
    LOC: { enabled: false, action: "anonymize", severity: "medium", label: "LOC", threshold: 0.85 },
    MISC: { enabled: false, action: "warn", severity: "low", label: "MISC", threshold: 0.9 },
  },
};
