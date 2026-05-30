/**
 * MAIN-world content script (document_start).
 *
 * Monkey-patches window.fetch to intercept LLM chat/completion requests and,
 * depending on the configured mode, anonymize / block / warn on detected PII.
 * This sits on the hot path of every fetch, so we early-exit as cheaply as
 * possible and wrap everything in try/catch — the page must never break.
 */

import { Anonymizer } from "@/core/anonymizer";
import { scan } from "@/core/detector";
import { findAdapter } from "@/adapters";
import { showBanner } from "@/ui/banner";
import {
  DEFAULT_CONFIG,
  GUARD_NS,
  isGuardMessage,
  type DetectionAction,
  type DetectionEvent,
  type FindingSummary,
  type GuardConfig,
} from "@/shared/messages";
import { SEVERITY_RANK, type Finding, type Severity } from "@/shared/types";

const originalFetch = window.fetch.bind(window);
(window as unknown as { __llmGuardOriginalFetch?: typeof fetch }).__llmGuardOriginalFetch =
  originalFetch;

let config: GuardConfig = DEFAULT_CONFIG;
const anonymizer = new Anonymizer();

/* ----------------------------- config wiring ----------------------------- */

window.addEventListener("message", (event: MessageEvent) => {
  if (event.source !== window) return;
  if (!isGuardMessage(event.data)) return;
  if (event.data.kind === "config") {
    config = event.data.payload;
  }
});

window.postMessage({ ns: GUARD_NS, kind: "config-request" }, location.origin);

/* -------------------------------- helpers -------------------------------- */

function resolveUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  if (input instanceof Request) return input.url;
  return String(input);
}

function summarize(findings: Finding[]): {
  summaries: FindingSummary[];
  highest: Severity;
} {
  const byType = new Map<string, FindingSummary>();
  let highest: Severity = "low";
  for (const f of findings) {
    if (SEVERITY_RANK[f.severity] > SEVERITY_RANK[highest]) highest = f.severity;
    const cur = byType.get(f.type);
    if (cur) {
      cur.count += 1;
      if (SEVERITY_RANK[f.severity] > SEVERITY_RANK[cur.severity]) {
        cur.severity = f.severity;
      }
    } else {
      byType.set(f.type, { type: f.type, severity: f.severity, count: 1 });
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
    mode: config.mode,
    action,
    findings,
    total,
    ts: Date.now(),
  };
  window.postMessage({ ns: GUARD_NS, kind: "detection", payload }, location.origin);
}

/**
 * Wrap a streamed Response so its text body is de-anonymized on the way back
 * to the page. Returns the original response if the body is not readable.
 */
function deanonymizeResponse(response: Response): Response {
  const body = response.body;
  if (!body) return response;

  const reader = body.getReader();
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  const stream = anonymizer.createStreamDeanonymizer();

  const out = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { done, value } = await reader.read();
        if (done) {
          const decoded = decoder.decode();
          const tail = stream.push(decoded) + stream.flush();
          if (tail) controller.enqueue(encoder.encode(tail));
          controller.close();
          return;
        }
        const text = decoder.decode(value, { stream: true });
        const emitted = stream.push(text);
        if (emitted) controller.enqueue(encoder.encode(emitted));
      } catch (err) {
        controller.error(err);
      }
    },
    cancel(reason) {
      void reader.cancel(reason);
    },
  });

  return new Response(out, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}

/* ------------------------------ fetch patch ------------------------------ */

window.fetch = async function patchedFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  try {
    // Cheap early-exits first.
    if (!config.enabled) return originalFetch(input, init);

    const adapter = findAdapter(location.hostname);
    if (!adapter) return originalFetch(input, init);

    const url = resolveUrl(input);
    if (!adapter.matchEndpoint(url)) return originalFetch(input, init);

    // Read the request body text.
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
    if (typeof parsed !== "object" || parsed === null) {
      return originalFetch(input, init);
    }

    const prompts = adapter.extractPrompts(parsed);
    if (prompts.length === 0) return originalFetch(input, init);

    const result = scan(prompts.join("\n"));
    if (result.findings.length === 0) return originalFetch(input, init);

    const { summaries, highest } = summarize(result.findings);
    const total = result.findings.length;

    // block mode only short-circuits on high/critical; otherwise anonymize.
    if (config.mode === "block" && (highest === "high" || highest === "critical")) {
      showBanner({ message: "Blocked — sensitive data detected", tone: "danger" });
      emitDetection(adapter.id, "blocked", summaries, total);
      return new Response(
        JSON.stringify({ error: "Blocked by LLM Guard — sensitive data detected." }),
        {
          status: 403,
          statusText: "Blocked by LLM Guard",
          headers: { "content-type": "application/json" },
        },
      );
    }

    if (config.mode === "warn") {
      showBanner({ message: "Sensitive data detected in your prompt", tone: "warn" });
      emitDetection(adapter.id, "warned", summaries, total);
      return originalFetch(input, init);
    }

    // anonymize (default, and block fallthrough on low/medium).
    let changed = false;
    const newBody = adapter.injectPrompts(parsed, (t) => {
      const a = anonymizer.anonymize(t);
      if (a.changed) changed = true;
      return a.text;
    });

    const serialized = JSON.stringify(newBody);
    let response: Response;
    if (input instanceof Request) {
      response = await originalFetch(new Request(input, { body: serialized }));
    } else {
      response = await originalFetch(input, { ...init, body: serialized });
    }

    showBanner({ message: "Sensitive data anonymized", tone: "info" });
    emitDetection(adapter.id, "anonymized", summaries, total);

    return changed ? deanonymizeResponse(response) : response;
  } catch {
    // Any failure → behave exactly like a normal fetch.
    return originalFetch(input, init);
  }
};
