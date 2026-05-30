/**
 * Hand-written validator for the parsed YAML rules document. Produces
 * DPO-friendly error messages (which rule, what's wrong) rather than raw
 * schema-library output. No external dependency.
 */

import type { Severity } from "@/shared/types";
import type {
  ParsedCondition,
  ParsedRule,
  ParsedRulesDoc,
  RuleAction,
} from "./types";

const ACTIONS: RuleAction[] = ["block", "anonymize", "warn"];
const SEVERITIES: Severity[] = ["low", "medium", "high", "critical"];
const KINDS = ["words", "regex", "combination"] as const;

export type ValidationResult =
  | { ok: true; doc: ParsedRulesDoc }
  | { ok: false; errors: string[] };

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === "string");
}

/** Validate a words/regex sub-condition; push errors with the given prefix. */
function validateCondition(cond: unknown, where: string, errors: string[]): void {
  if (!isObject(cond)) {
    errors.push(`${where}: each condition must be an object with a "kind".`);
    return;
  }
  if (cond.kind === "words") {
    if (!isStringArray(cond.words) || cond.words.length === 0) {
      errors.push(`${where}: a "words" condition needs a non-empty "words" list.`);
    }
  } else if (cond.kind === "regex") {
    if (typeof cond.pattern !== "string" || cond.pattern.length === 0) {
      errors.push(`${where}: a "regex" condition needs a non-empty "pattern".`);
    }
  } else {
    errors.push(`${where}: condition "kind" must be "words" or "regex".`);
  }
}

function validateRule(rule: unknown, index: number, errors: string[]): void {
  const where = `rule #${index + 1}`;
  if (!isObject(rule)) {
    errors.push(`${where}: must be an object.`);
    return;
  }
  const id = rule.id;
  const label = typeof id === "string" && id ? `rule "${id}"` : where;

  if (typeof id !== "string" || id.length === 0) {
    errors.push(`${where}: missing required "id".`);
  }
  if (typeof rule.kind !== "string" || !KINDS.includes(rule.kind as never)) {
    errors.push(`${label}: "kind" must be one of ${KINDS.join(", ")}.`);
  }
  if (rule.action !== undefined && !ACTIONS.includes(rule.action as RuleAction)) {
    errors.push(`${label}: "action" must be one of ${ACTIONS.join(", ")}.`);
  }
  if (rule.severity !== undefined && !SEVERITIES.includes(rule.severity as Severity)) {
    errors.push(`${label}: "severity" must be one of ${SEVERITIES.join(", ")}.`);
  }
  if (rule.placeholder !== undefined && typeof rule.placeholder !== "string") {
    errors.push(`${label}: "placeholder" must be text.`);
  }

  switch (rule.kind) {
    case "words":
      if (!isStringArray(rule.words) || (rule.words as string[]).length === 0) {
        errors.push(`${label}: a "words" rule needs a non-empty "words" list.`);
      }
      break;
    case "regex":
      if (typeof rule.pattern !== "string" || rule.pattern.length === 0) {
        errors.push(`${label}: a "regex" rule needs a non-empty "pattern".`);
      }
      break;
    case "combination":
      if (!Array.isArray(rule.all) || rule.all.length < 2) {
        errors.push(`${label}: a "combination" rule needs an "all" list of at least 2 conditions.`);
      } else {
        rule.all.forEach((c, i) =>
          validateCondition(c, `${label}, condition #${i + 1}`, errors),
        );
      }
      break;
  }
}

/** Validate and (when valid) return the typed document. */
export function validateRulesDoc(raw: unknown): ValidationResult {
  const errors: string[] = [];

  if (!isObject(raw)) {
    return { ok: false, errors: ["The rules file must be a YAML mapping (top-level object)."] };
  }

  if (raw.version !== undefined && typeof raw.version !== "number") {
    errors.push(`"version" must be a number.`);
  }

  if (raw.defaults !== undefined) {
    if (!isObject(raw.defaults)) {
      errors.push(`"defaults" must be an object.`);
    } else {
      const d = raw.defaults;
      if (d.action !== undefined && !ACTIONS.includes(d.action as RuleAction)) {
        errors.push(`defaults.action must be one of ${ACTIONS.join(", ")}.`);
      }
      if (d.severity !== undefined && !SEVERITIES.includes(d.severity as Severity)) {
        errors.push(`defaults.severity must be one of ${SEVERITIES.join(", ")}.`);
      }
    }
  }

  if (raw.whitelist !== undefined && !isStringArray(raw.whitelist)) {
    errors.push(`"whitelist" must be a list of text values.`);
  }

  if (raw.blacklist !== undefined) {
    if (!isObject(raw.blacklist)) {
      errors.push(`"blacklist" must be an object with a "values" list.`);
    } else {
      const b = raw.blacklist;
      if (!isStringArray(b.values)) {
        errors.push(`blacklist "values" must be a list of text values.`);
      }
      if (b.action !== undefined && !ACTIONS.includes(b.action as RuleAction)) {
        errors.push(`blacklist.action must be one of ${ACTIONS.join(", ")}.`);
      }
      if (b.severity !== undefined && !SEVERITIES.includes(b.severity as Severity)) {
        errors.push(`blacklist.severity must be one of ${SEVERITIES.join(", ")}.`);
      }
    }
  }

  if (raw.rules === undefined) {
    // rules optional only if a blacklist exists; otherwise nothing would match.
    if (raw.blacklist === undefined) {
      errors.push(`Provide at least a "rules" list or a "blacklist".`);
    }
  } else if (!Array.isArray(raw.rules)) {
    errors.push(`"rules" must be a list.`);
  } else {
    raw.rules.forEach((r, i) => validateRule(r, i, errors));
    const ids = new Set<string>();
    raw.rules.forEach((r) => {
      if (isObject(r) && typeof r.id === "string") {
        if (ids.has(r.id)) errors.push(`Duplicate rule id "${r.id}".`);
        ids.add(r.id);
      }
    });
  }

  if (errors.length > 0) return { ok: false, errors };

  const doc: ParsedRulesDoc = {
    version: typeof raw.version === "number" ? raw.version : 1,
    defaults: raw.defaults as ParsedRulesDoc["defaults"],
    whitelist: raw.whitelist as string[] | undefined,
    blacklist: raw.blacklist as ParsedRulesDoc["blacklist"],
    rules: ((raw.rules as ParsedRule[] | undefined) ?? []).map(normalizeRule),
  };
  return { ok: true, doc };
}

/** Trim a parsed rule down to its known shape (defensive copy). */
function normalizeRule(rule: ParsedRule): ParsedRule {
  const base = {
    id: rule.id,
    description: rule.description,
    action: rule.action,
    severity: rule.severity,
    placeholder: rule.placeholder,
  };
  switch (rule.kind) {
    case "words":
      return { ...base, kind: "words", words: rule.words };
    case "regex":
      return { ...base, kind: "regex", pattern: rule.pattern };
    case "combination":
      return {
        ...base,
        kind: "combination",
        all: rule.all.map((c) => ({ ...c }) as ParsedCondition),
      };
  }
}
