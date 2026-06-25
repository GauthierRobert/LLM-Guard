/**
 * MAIN-world content script (document_start).
 *
 * Monkey-patches window.fetch to intercept LLM chat/completion requests and,
 * according to the DPO's YAML rules, anonymize / block / warn on detected
 * sensitive data. Each rule carries its own action; the per-request decision is
 * the most severe action among the matches (block > anonymize > warn).
 *
 * Anonymization is reversible but de-anonymization is MANUAL: the response is
 * left with placeholders, and the popup's reveal button restores the real
 * values in the page on demand. This sits on the hot path of every fetch, so we
 * early-exit cheaply and wrap everything in try/catch — the page must never
 * break.
 */

import { Anonymizer } from "@/core/anonymizer";
import { evaluate } from "@/core/rules/engine";
import { compileRules } from "@/core/rules/compile";
import { parseRulesYaml } from "@/core/rules/parse";
import { getDefaultCompiledRules } from "@/core/rules/defaults";
import type { CompiledRules, RuleFinding } from "@/core/rules/types";
import { findAdapter } from "@/adapters";
import type { LLMAdapter } from "@/adapters/types";
import { showBanner } from "@/ui/banner";
import { hideInPage, isRevealed, revealInPage } from "@/content/reveal";
import {
  DEFAULT_CONFIG,
  GUARD_NS,
  isGuardMessage,
  type DetectionAction,
  type DetectionEvent,
  type FindingSummary,
  type GuardConfig,
} from "@/shared/messages";
import { SEVERITY_RANK, type AnonymizeSpan, type Severity } from "@/shared/types";

const originalFetch = window.fetch.bind(window);
(window as unknown as { __llmGuardOriginalFetch?: typeof fetch }).__llmGuardOriginalFetch =
  originalFetch;

let config: GuardConfig = DEFAULT_CONFIG;
let rules: CompiledRules = getDefaultCompiledRules();
const anonymizer = new Anonymizer();
const adapter: LLMAdapter | null = findAdapter(location.hostname);

/* ----------------------------- config wiring ----------------------------- */

window.addEventListener("message", (event: MessageEvent) => {
  if (event.source !== window) return;
  if (!isGuardMessage(event.data)) return;
  const data = event.data;

  if (data.kind === "config") {
    config = data.payload;
  } else if (data.kind === "rules") {
    applyRules(data.payload.yaml);
  } else if (data.kind === "reveal") {
    handleReveal(data.payload.reveal);
  }
});

window.postMessage({ ns: GUARD_NS, kind: "config-request" }, location.origin);

function applyRules(yaml: string): void {
  try {
    const parsed = parseRulesYaml(yaml);
    if (parsed.ok) rules = compileRules(parsed.doc);
    // Invalid YAML is rejected at save time; keep the last good rules if it slips through.
  } catch {
    /* keep current rules */
  }
}

function handleReveal(reveal: boolean): void {
  let replaced = 0;
  let ok = true;
  try {
    replaced = reveal
      ? revealInPage(anonymizer.exportMap(), adapter?.conversationSelector ?? null)
      : hideInPage();
  } catch {
    ok = false;
  }
  window.postMessage(
    {
      ns: GUARD_NS,
      kind: "reveal-result",
      payload: { reveal: isRevealed(), replaced, ok },
    },
    location.origin,
  );
}

/* -------------------------------- helpers -------------------------------- */

function resolveUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  if (input instanceof Request) return input.url;
  return String(input);
}

/** Roll findings up per rule id for the activity log. */
function summarize(findings: RuleFinding[]): {
  summaries: FindingSummary[];
  highest: Severity;
} {
  const byType = new Map<string, FindingSummary>();
  let highest: Severity = "low";
  for (const f of findings) {
    if (SEVERITY_RANK[f.severity] > SEVERITY_RANK[highest]) highest = f.severity;
    const cur = byType.get(f.ruleId);
    if (cur) {
      cur.count += 1;
      if (SEVERITY_RANK[f.severity] > SEVERITY_RANK[cur.severity]) cur.severity = f.severity;
    } else {
      byType.set(f.ruleId, { type: f.ruleId, severity: f.severity, count: 1 });
    }
  }
  return { summaries: [...byType.values()], highest };
}

function emitDetection(
  service: string,
  action: DetectionAction,
  findings: FindingSummary[],
  total: number,
): void {
  const payload: DetectionEvent = {
    service,
    host: location.hostname,
    action,
    findings,
    total,
    ts: Date.now(),
  };
  window.postMessage({ ns: GUARD_NS, kind: "detection", payload }, location.origin);
}

function blockedResponse(): Response {
  return new Response(
    JSON.stringify({ error: "Blocked by AvoPseudo — sensitive data detected." }),
    {
      status: 403,
      statusText: "Blocked by AvoPseudo",
      headers: { "content-type": "application/json" },
    },
  );
}

/**
 * Find, within a single prompt string, the spans whose value matches an
 * anonymize-action finding. The engine ran over the joined prompts, so offsets
 * are recomputed per-prompt by value (stable: same value → same placeholder).
 */
function anonymizeSpansFor(text: string, findings: RuleFinding[]): AnonymizeSpan[] {
  const spans: AnonymizeSpan[] = [];
  for (const f of findings) {
    if (f.action !== "anonymize") continue;
    let from = 0;
    let idx: number;
    while ((idx = text.indexOf(f.value, from)) !== -1) {
      spans.push({ start: idx, end: idx + f.value.length, value: f.value, label: f.placeholderLabel ?? "INFO" });
      from = idx + f.value.length;
    }
  }
  // Non-overlapping, left-to-right (anonymizer also guards overlaps defensively).
  return spans.sort((a, b) => a.start - b.start);
}

/* ------------------------------ fetch patch ------------------------------ */

window.fetch = async function patchedFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  try {
    if (!config.enabled) return originalFetch(input, init);
    if (!adapter) return originalFetch(input, init);

    const url = resolveUrl(input);
    if (!adapter.matchEndpoint(url)) return originalFetch(input, init);

    let bodyText: string | null = null;
    if (typeof init?.body === "string") {
      bodyText = init.body;
    } else if (input instanceof Request) {
      bodyText = await input.clone().text();
    } else {
      return originalFetch(input, init);
    }
    if (!bodyText) return originalFetch(input, init);

    let parsed: unknown;
    try {
      parsed = JSON.parse(bodyText);
    } catch {
      return originalFetch(input, init);
    }
    if (typeof parsed !== "object" || parsed === null) return originalFetch(input, init);

    const prompts = adapter.extractPrompts(parsed);
    if (prompts.length === 0) return originalFetch(input, init);

    const result = evaluate(prompts.join("\n"), rules);
    if (result.findings.length === 0 || result.decision === null) {
      return originalFetch(input, init);
    }

    const { summaries, highest } = summarize(result.findings);
    const total = result.findings.length;

    if (result.decision === "block") {
      showBanner({ message: "Blocked — sensitive data detected", tone: "danger" });
      emitDetection(adapter.id, "blocked", summaries, total);
      return blockedResponse();
    }

    if (result.decision === "warn") {
      showBanner({ message: "Sensitive data detected in your prompt", tone: "warn" });
      emitDetection(adapter.id, "warned", summaries, total);
      return originalFetch(input, init);
    }

    // anonymize: replace only the anonymize-action spans; leave the response
    // untouched (placeholders are revealed manually from the popup).
    const newBody = adapter.injectPrompts(parsed, (t) =>
      anonymizer.anonymizeSpans(t, anonymizeSpansFor(t, result.findings)),
    );

    const serialized = JSON.stringify(newBody);
    const response =
      input instanceof Request
        ? await originalFetch(new Request(input, { body: serialized }))
        : await originalFetch(input, { ...init, body: serialized });

    showBanner({
      message: "Sensitive data anonymized — reveal from the popup",
      tone: "info",
    });
    emitDetection(adapter.id, "anonymized", summaries, total);
    void highest;
    return response;
  } catch {
    return originalFetch(input, init);
  }
};
