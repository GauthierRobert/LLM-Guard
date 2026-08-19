/**
 * MAIN-world content script (document_start).
 *
 * Hosts the two guards, the shared detection state (config, compiled rules, the
 * session anonymizer) and the NER round-trip to the ISOLATED bridge:
 *
 *   - **paste guard** (v5, default): pseudonymises sensitive text the moment it
 *     is pasted into the chat composer, and says so in a branded in-page panel.
 *     See `content/paste-guard.ts`.
 *   - **send guard** (v4 behaviour, opt-in via `config.guardOnSend`): patches
 *     window.fetch and rewrites the outgoing prompt instead.
 *
 * Each rule carries its own action; the decision is the most severe match
 * (block > anonymize > warn). Anonymization is reversible but de-anonymization
 * is MANUAL: placeholders stay in the page and the popup's reveal button
 * restores the real values on demand.
 *
 * The fetch patch sits on the hot path of every request, so we early-exit
 * cheaply and wrap everything in try/catch — the page must never break.
 */

import { Anonymizer } from "@/core/anonymizer";
import { evaluate } from "@/core/rules/engine";
import { compileRules } from "@/core/rules/compile";
import { parseRulesYaml } from "@/core/rules/parse";
import { getDefaultCompiledRules } from "@/core/rules/defaults";
import type { CompiledRules, RuleFinding } from "@/core/rules/types";
import { mergeNerFindings } from "@/core/ner/merge";
import type { NerEntity } from "@/core/ner/types";
import { findAdapter } from "@/adapters";
import type { LLMAdapter } from "@/adapters/types";
import { showBanner } from "@/ui/banner";
import { hideInPage, isRevealed, revealInPage } from "@/content/reveal";
import { installPasteGuard } from "@/content/paste-guard";
import {
  DEFAULT_CONFIG,
  GUARD_NS,
  isGuardMessage,
  type DetectionAction,
  type DetectionEvent,
  type DetectionSource,
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
  } else if (data.kind === "ner-result") {
    const pending = nerPending.get(data.payload.id);
    if (pending) {
      nerPending.delete(data.payload.id);
      pending(data.payload.entities);
    }
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

/* --------------------------------- NER ----------------------------------- */

/** In-flight NER requests, resolved when the ISOLATED bridge posts ner-result. */
const nerPending = new Map<string, (entities: NerEntity[]) => void>();
let nerSeq = 0;
/** Cap how long the fetch waits on the model before sending without NER. */
const NER_TIMEOUT_MS = 8000;

/**
 * Ask the bridge (→ service worker → offscreen/background host) to run NER on
 * `text`. Resolves to [] on timeout or any failure so a slow/missing model can
 * never hold up or break the user's request. The paste path passes a shorter
 * timeout than the send path — a paste has to feel instant.
 */
function requestNer(text: string, timeoutMs: number = NER_TIMEOUT_MS): Promise<NerEntity[]> {
  return new Promise((resolve) => {
    const id = `${Date.now()}-${nerSeq++}`;
    let done = false;
    const finish = (entities: NerEntity[]) => {
      if (done) return;
      done = true;
      nerPending.delete(id);
      resolve(entities);
    };
    nerPending.set(id, finish);
    window.setTimeout(() => finish([]), timeoutMs);
    window.postMessage({ ns: GUARD_NS, kind: "ner-request", payload: { id, text } }, location.origin);
  });
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
  source: DetectionSource,
): void {
  const payload: DetectionEvent = {
    service,
    host: location.hostname,
    action,
    findings,
    total,
    source,
    ts: Date.now(),
  };
  window.postMessage({ ns: GUARD_NS, kind: "detection", payload }, location.origin);
}

/** Summarise raw findings and emit them in one step. */
function emitFindings(
  action: DetectionAction,
  findings: RuleFinding[],
  source: DetectionSource,
): void {
  const { summaries } = summarize(findings);
  emitDetection(adapter?.id ?? location.hostname, action, summaries, findings.length, source);
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

/* ------------------------------ paste guard ------------------------------ */

// The v5 primary guard: catch sensitive text as it is pasted into the composer.
installPasteGuard({
  getConfig: () => config,
  getRules: () => rules,
  anonymizer,
  requestNer,
  emit: (action, findings) => emitFindings(action, findings, "paste"),
});

/* --------------------- send guard (fetch patch, opt-in) ------------------- */

// Installed unconditionally so it is in place before the page captures fetch,
// but inert unless the user turns `guardOnSend` on: v5 protects at paste time.
window.fetch = async function patchedFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  try {
    if (!config.enabled || !config.guardOnSend) return originalFetch(input, init);
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

    const joined = prompts.join("\n");
    let result = evaluate(joined, rules);

    // Optional ML layer: detect names/orgs/places regex can't, merged into the
    // same findings (regex wins overlaps). Awaiting here holds the send until
    // the model answers (bounded by NER_TIMEOUT_MS).
    if (config.ner?.enabled) {
      const entities = await requestNer(joined);
      result = mergeNerFindings(joined, result, entities, config.ner, rules.whitelist);
    }

    if (result.findings.length === 0 || result.decision === null) {
      return originalFetch(input, init);
    }

    const { summaries, highest } = summarize(result.findings);
    const total = result.findings.length;

    if (result.decision === "block") {
      showBanner({ message: "Blocked — sensitive data detected", tone: "danger" });
      emitDetection(adapter.id, "blocked", summaries, total, "send");
      return blockedResponse();
    }

    if (result.decision === "warn") {
      showBanner({ message: "Sensitive data detected in your prompt", tone: "warn" });
      emitDetection(adapter.id, "warned", summaries, total, "send");
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
    emitDetection(adapter.id, "anonymized", summaries, total, "send");
    void highest;
    return response;
  } catch {
    return originalFetch(input, init);
  }
};
