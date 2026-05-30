/**
 * The bundled default rules — imported as a raw string via Vite's `?raw`
 * suffix, parsed and compiled once, lazily, and memoised.
 */

import rulesYaml from "./rules.default.yaml?raw";
import { parseRulesYaml } from "./parse";
import { compileRules } from "./compile";
import type { CompiledRules } from "./types";

export const DEFAULT_RULES_YAML: string = rulesYaml;

let cached: CompiledRules | null = null;

/** Parse + compile the bundled default rules (memoised). */
export function getDefaultCompiledRules(): CompiledRules {
  if (cached) return cached;
  const parsed = parseRulesYaml(DEFAULT_RULES_YAML);
  if (!parsed.ok) {
    // The bundled default must always be valid; fail loud in dev/tests.
    throw new Error(`Bundled default rules are invalid: ${parsed.errors.join("; ")}`);
  }
  cached = compileRules(parsed.doc);
  return cached;
}
