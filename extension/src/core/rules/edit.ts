/**
 * Comment-preserving, structured edits of the rules YAML.
 *
 * The friendly Options UI never asks anyone to type YAML: it toggles rules on
 * and off, manages the allow/block lists, and merges back a rule that an AI
 * assistant rewrote. Each of those is a small, surgical change. We use the
 * `yaml` Document API (not js-yaml's load/dump) precisely because it keeps the
 * file's comments, ordering and formatting intact across the round-trip — the
 * default ruleset is heavily commented and that documentation must survive.
 *
 * None of these helpers validate: the caller persists the result through the
 * service worker, which re-validates (parse + compile) before storing. A bad
 * edit therefore fails closed (rejected, not saved), never silently corrupts.
 */

import {
  isMap,
  isScalar,
  isSeq,
  parseDocument,
  parse as yamlParse,
  type Document,
  type YAMLMap,
  type YAMLSeq,
} from "yaml";

/** Stringify a sequence item (scalar node or plain value) for comparison. */
function itemString(node: unknown): string {
  if (isScalar(node)) return String(node.value ?? "");
  return String(node ?? "");
}

function eqCI(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

function findRuleIndex(doc: Document, id: string): { seq: YAMLSeq; index: number } | null {
  const seq = doc.get("rules");
  if (!isSeq(seq)) return null;
  const index = seq.items.findIndex((it) => isMap(it) && it.get("id") === id);
  return index >= 0 ? { seq, index } : null;
}

/* ------------------------------ enable / disable -------------------------- */

/**
 * Turn a rule on or off by id. Disabling writes `enabled: false`; enabling
 * removes the key so the rule reverts to its default (active) state. Returns
 * the YAML unchanged when the id is unknown.
 */
export function setRuleEnabled(yaml: string, id: string, enabled: boolean): string {
  const doc = parseDocument(yaml);
  const found = findRuleIndex(doc, id);
  if (!found) return yaml;
  const rule = found.seq.items[found.index] as YAMLMap;
  if (enabled) rule.delete("enabled");
  else rule.set("enabled", false);
  return String(doc);
}

/* ------------------------------- whitelist -------------------------------- */

export function addWhitelistValue(yaml: string, value: string): string {
  const v = value.trim();
  if (!v) return yaml;
  const doc = parseDocument(yaml);
  const wl = doc.get("whitelist");
  if (isSeq(wl)) {
    if (!wl.items.some((it) => eqCI(itemString(it), v))) {
      wl.flow = false;
      wl.add(v);
    }
  } else {
    doc.set("whitelist", doc.createNode([v]));
  }
  return String(doc);
}

export function removeWhitelistValue(yaml: string, value: string): string {
  const doc = parseDocument(yaml);
  const wl = doc.get("whitelist");
  if (isSeq(wl)) {
    const idx = wl.items.findIndex((it) => itemString(it) === value);
    if (idx >= 0) wl.delete(idx);
  }
  return String(doc);
}

/* ------------------------------- blacklist -------------------------------- */

function ensureBlacklist(doc: Document): YAMLMap {
  let bl = doc.get("blacklist");
  if (!isMap(bl)) {
    bl = doc.createNode({
      action: "anonymize",
      severity: "critical",
      placeholder: "MATTER",
      values: [],
    }) as YAMLMap;
    doc.set("blacklist", bl);
  }
  return bl as YAMLMap;
}

export function addBlacklistValue(yaml: string, value: string): string {
  const v = value.trim();
  if (!v) return yaml;
  const doc = parseDocument(yaml);
  const bl = ensureBlacklist(doc);
  const values = bl.get("values");
  if (isSeq(values)) {
    if (!values.items.some((it) => eqCI(itemString(it), v))) {
      values.flow = false;
      values.add(v);
    }
  } else {
    bl.set("values", doc.createNode([v]));
  }
  return String(doc);
}

export function removeBlacklistValue(yaml: string, value: string): string {
  const doc = parseDocument(yaml);
  const bl = doc.get("blacklist");
  if (isMap(bl)) {
    const values = bl.get("values");
    if (isSeq(values)) {
      const idx = values.items.findIndex((it) => itemString(it) === value);
      if (idx >= 0) values.delete(idx);
      // An empty block seq serialises to null (invalid: `values` must be a
      // list). Force the flow form so it renders as `values: []`.
      if (values.items.length === 0) values.flow = true;
    }
  }
  return String(doc);
}

/* --------------------------- merge rules by id ---------------------------- */

/**
 * Insert or replace each rule by its `id`, keeping every other rule (and all
 * comments) untouched. New ids are appended to the end of the `rules` list.
 */
export function upsertRules(yaml: string, rules: Array<Record<string, unknown>>): string {
  const doc = parseDocument(yaml);
  let seq = doc.get("rules");
  if (!isSeq(seq)) {
    doc.set("rules", doc.createNode([]));
    seq = doc.get("rules");
  }
  const rulesSeq = seq as YAMLSeq;
  for (const rule of rules) {
    const id = rule.id;
    const node = doc.createNode(rule);
    const idx =
      typeof id === "string"
        ? rulesSeq.items.findIndex((it) => isMap(it) && it.get("id") === id)
        : -1;
    if (idx >= 0) rulesSeq.set(idx, node);
    else rulesSeq.add(node);
  }
  return String(doc);
}

/** The plain-object form of one rule, for building an AI prompt. */
export function extractRuleObject(yaml: string, id: string): Record<string, unknown> | null {
  const doc = parseDocument(yaml);
  const found = findRuleIndex(doc, id);
  if (!found) return null;
  const node = found.seq.items[found.index] as YAMLMap;
  return node.toJSON() as Record<string, unknown>;
}

/* ----------------------------- paste / import ----------------------------- */

export type ImportResult =
  | { ok: true; yaml: string; mode: "replace"; count: number }
  | { ok: true; yaml: string; mode: "merge"; count: number; ids: string[] }
  | { ok: false; error: string };

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

const DOC_KEYS = ["rules", "version", "whitelist", "blacklist", "defaults"];

/**
 * Decide what to do with text pasted by the user (or read from an uploaded
 * file) and produce the candidate YAML to save:
 *
 *  - a full rules file (has top-level `rules`/`version`/…) → replace everything
 *    with the pasted text verbatim (its own comments are preserved);
 *  - one rule, or a list of rules → merge each by id into the current file.
 *
 * Returns a friendly error when the text is neither.
 */
export function buildImportedYaml(currentYaml: string, pasted: string): ImportResult {
  const text = pasted.trim();
  if (!text) return { ok: false, error: "There is nothing to apply." };

  let data: unknown;
  try {
    data = yamlParse(text);
  } catch (err) {
    return { ok: false, error: `That is not valid YAML: ${(err as Error).message}` };
  }
  if (data == null) return { ok: false, error: "The pasted text is empty." };

  if (isPlainObject(data) && DOC_KEYS.some((k) => k in data)) {
    const count = Array.isArray((data as { rules?: unknown }).rules)
      ? ((data as { rules: unknown[] }).rules.length)
      : 0;
    return { ok: true, yaml: text, mode: "replace", count };
  }

  const rules = Array.isArray(data) ? data : [data];
  const ids: string[] = [];
  for (const r of rules) {
    if (!isPlainObject(r) || typeof r.id !== "string" || !r.id) {
      return {
        ok: false,
        error:
          'Expected a rule (with an "id") or a full rules file. Paste exactly what the assistant returned.',
      };
    }
    ids.push(r.id);
  }
  return {
    ok: true,
    yaml: upsertRules(currentYaml, rules as Array<Record<string, unknown>>),
    mode: "merge",
    count: ids.length,
    ids,
  };
}
