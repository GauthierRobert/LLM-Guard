/**
 * Build the ready-to-paste prompts that let a non-technical user change a rule
 * by talking to ChatGPT or Claude instead of writing YAML or regex by hand.
 *
 * The user clicks "Copy" on a rule, pastes the prompt into the assistant,
 * describes the change in plain language, and pastes the assistant's reply back
 * into the Options page, which merges it by id.
 */

import { stringify as yamlStringify } from "yaml";

/** Shared explanation of the rule format and the engine's regex constraints. */
const FORMAT_GUIDE = `A rule says WHAT to look for and WHAT to do about it:
- kind: "words" (a list of literal terms), "regex" (a JavaScript regular expression in the "pattern" field), or "combination" (an "all" list where every condition must match).
- action: "anonymize" (replace the value with a placeholder such as [EMAIL_1a2b]), "warn" (only alert the user), or "block" (refuse to send the prompt).
- severity: one of low, medium, high, critical.
- placeholder: the label used when anonymizing (e.g. EMAIL gives [EMAIL_1a2b]).

Regex constraints (important):
- Patterns are compiled with the flags "gu" (global + unicode).
- Inline modifiers like (?i) are NOT supported. For case-insensitivity write character classes such as [Pp]assword.
- Use \\p{L} and \\p{N} for letters and digits so accented text (é, ü, ç) is matched correctly.`;

/** YAML for one rule, as a single-item list (the form it is pasted back in). */
function ruleToYaml(rule: Record<string, unknown>): string {
  return yamlStringify([rule]).trimEnd();
}

/**
 * Prompt to MODIFY an existing rule. The user replaces the `<<…>>` marker with
 * their request; the assistant returns the updated rule, which merges by id.
 */
export function buildEditPrompt(rule: Record<string, unknown>): string {
  return `You are editing ONE detection rule for "LLM Guard", a browser extension that finds sensitive data in text before it is sent to an AI assistant.

What I need you to do:
1. Read my request, written between << and >> below.
2. Apply it to the rule shown at the end.
3. Reply with ONLY the updated rule as YAML — no explanation, no code fences, and keep the same "id".

${FORMAT_GUIDE}

MY REQUEST: <<Replace this whole text, including the << >>, with what you want — for example: also detect UK phone numbers, or change the action from anonymize to warn>>

The rule to update:

${ruleToYaml(rule)}`;
}

/**
 * Prompt to CREATE a new rule from scratch. The user replaces the `<<…>>`
 * marker; the assistant returns one new rule block, which merges in.
 */
export function buildCreatePrompt(): string {
  const example = ruleToYaml({
    id: "internal-ticket-id",
    description: "Internal ticket number",
    kind: "regex",
    action: "anonymize",
    severity: "high",
    placeholder: "TICKET",
    pattern: "(?<![\\p{L}\\p{N}])INC-\\d{5}(?![\\p{L}\\p{N}])",
  });
  return `You are creating ONE new detection rule for "LLM Guard", a browser extension that finds sensitive data in text before it is sent to an AI assistant.

What I need you to do:
1. Read what I want to detect, written between << and >> below.
2. Write a single rule that detects it, choosing a short unique lowercase id with dashes (e.g. "internal-ticket-id").
3. Reply with ONLY the new rule as YAML — no explanation, no code fences — using exactly the same structure as the example.

${FORMAT_GUIDE}

WHAT TO DETECT: <<Replace this whole text, including the << >>, with what the rule should catch — for example: our internal ticket numbers like INC-12345, or warn whenever someone mentions a customer's medical condition>>

Example of the exact format to follow:

${example}`;
}
