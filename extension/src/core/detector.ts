import { type Finding, type ScanResult, type Severity, maxSeverity } from "@/shared/types";
import { scanKeywords } from "./keywords";
import { collectMatches } from "./match";

/**
 * Scan `text` for PII (regex patterns, overlap-resolved) plus sensitive
 * keywords, without mutating it. Returns all findings and the aggregate
 * severity.
 */
export function scan(text: string): ScanResult {
  const findings: Finding[] = [];

  for (const m of collectMatches(text)) {
    findings.push({
      type: m.pattern.type,
      label: m.pattern.label,
      value: m.value,
      severity: m.pattern.severity,
      start: m.start,
      end: m.end,
      source: "regex",
    });
  }

  for (const kf of scanKeywords(text)) findings.push(kf);

  let max: Severity | null = null;
  let hasCritical = false;
  for (const f of findings) {
    max = maxSeverity(max, f.severity);
    if (f.severity === "critical") hasCritical = true;
  }

  return { findings, maxSeverity: max, hasCritical };
}
