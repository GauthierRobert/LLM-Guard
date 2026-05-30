/**
 * Parse a YAML rules string into a validated document. Never throws — a bad
 * file (malformed YAML or schema violation) returns `{ ok: false, errors }`
 * with messages a DPO can act on.
 */

import { load as yamlLoad, YAMLException } from "js-yaml";
import { validateRulesDoc, type ValidationResult } from "./schema";

export function parseRulesYaml(yaml: string): ValidationResult {
  let raw: unknown;
  try {
    raw = yamlLoad(yaml);
  } catch (err) {
    if (err instanceof YAMLException) {
      const line = err.mark ? ` (line ${err.mark.line + 1})` : "";
      return { ok: false, errors: [`YAML syntax error${line}: ${err.reason}`] };
    }
    return { ok: false, errors: ["The rules file could not be parsed as YAML."] };
  }
  if (raw === undefined || raw === null) {
    return { ok: false, errors: ["The rules file is empty."] };
  }
  return validateRulesDoc(raw);
}
