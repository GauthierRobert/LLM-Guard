/**
 * Mirrors ../../shared/schema.json. Regenerate with `json-schema-to-typescript`
 * after editing that file. For now hand-written to avoid an extra build step.
 */

export type Severity = 'critical' | 'high' | 'medium' | 'low';
export type Action = 'CLEAN' | 'ANONYMIZED' | 'PII_DETECTED' | 'BLOCKED';
export type LLM = 'ChatGPT' | 'Claude' | 'Gemini' | 'Copilot' | 'Unknown';
export type Mode = 'anonymize' | 'block';

export interface Finding {
  type: string;
  severity: Severity;
  count: number;
}

export interface LLMGuardEvent {
  eventId: string;
  deviceId: string;
  orgId: string;
  userHint: string | null;
  timestamp: string;
  hostname: string;
  llm: LLM;
  action: Action;
  endpoint: string | null;
  mode: Mode;
  promptLength: number;
  mappingsCount: number;
  anonymizedPreview: string | null;
  findings: Finding[];
  extensionVersion: string;
  schemaVersion: 1;
}

export interface StatsResponse {
  total: number;
  clean: number;
  flagged: number;
  blocked: number;
  anonymized: number;
  by_llm: Record<string, number>;
  by_type: Record<string, number>;
}
