#!/usr/bin/env node
/**
 * Seeds the LLM Guard backend with ~2000 synthetic events for demo/testing.
 *
 * Posts to the same /v1/events endpoint the extension uses, so fixtures pass
 * the same validation and trigger the same WebSocket broadcast as live data.
 *
 * Usage:
 *   node infra/seed-demo.mjs                       # defaults below
 *   BASE_URL=http://localhost/api node infra/seed-demo.mjs
 *   TOTAL=5000 ORG=default node infra/seed-demo.mjs
 */

import { randomUUID } from "node:crypto";

const BASE_URL = process.env.BASE_URL || "http://localhost/api";
const ORG = process.env.ORG || "default";
const TOTAL = Number(process.env.TOTAL || 2000);
const BATCH_SIZE = Number(process.env.BATCH_SIZE || 50);
const TOKEN = process.env.TOKEN || "demo-seed-token-" + randomUUID();
const EXT_VERSION = process.env.EXT_VERSION || "2.0.0";

// Distribution must match the API's allowed llm/action regex.
const LLM_WEIGHTS = [
  ["ChatGPT", 50],
  ["Claude", 25],
  ["Gemini", 13],
  ["Copilot", 8],
  ["Mistral", 2],
  ["DeepSeek", 1],
  ["Perplexity", 1],
];

const ACTION_WEIGHTS = [
  ["CLEAN", 65],
  ["PII_DETECTED", 22],
  ["ANONYMIZED", 11],
  ["BLOCKED", 2],
];

const FINDING_TYPES = [
  // Must align with compliance.data.ts FINDING_TYPE_TO_ARTICLES keys.
  ["email", "medium", 60],
  ["phone", "medium", 40],
  ["name", "medium", 50],
  ["address", "medium", 20],
  ["ip", "low", 25],
  ["iban", "high", 10],
  ["credit_card", "critical", 5],
  ["ssn", "critical", 3],
  ["password", "critical", 4],
  ["health", "critical", 8],
  ["biometric", "critical", 2],
  ["emotion_workplace", "critical", 1],
];

const HOSTS_PER_LLM = {
  ChatGPT: "chatgpt.com",
  Claude: "claude.ai",
  Gemini: "gemini.google.com",
  Copilot: "copilot.microsoft.com",
  Mistral: "chat.mistral.ai",
  DeepSeek: "chat.deepseek.com",
  Perplexity: "www.perplexity.ai",
};

// Small stable fleet so the Devices page has something useful to show.
const DEVICES = Array.from({ length: 6 }, () => ({
  id: randomUUID(),
  userHint: [
    "alice@example.fr",
    "bob@example.fr",
    "carole.dupont@example.fr",
    "david@example.fr",
    "marketing-1@example.fr",
    "legal-1@example.fr",
  ][Math.floor(Math.random() * 6)],
}));

function pickWeighted(pairs) {
  const total = pairs.reduce((n, [, w]) => n + w, 0);
  let r = Math.random() * total;
  for (const [value, w] of pairs) {
    r -= w;
    if (r <= 0) return value;
  }
  return pairs[pairs.length - 1][0];
}

function makeFindings(action) {
  if (action === "CLEAN") return [];
  const picks = 1 + Math.floor(Math.random() * 3);
  const seen = new Set();
  const findings = [];
  for (let i = 0; i < picks; i++) {
    const [type, severity] = pickWeighted(
      FINDING_TYPES.map(([t, s, w]) => [[t, s], w]),
    );
    if (seen.has(type)) continue;
    seen.add(type);
    findings.push({ type, severity, count: 1 + Math.floor(Math.random() * 3) });
  }
  return findings;
}

function makeEvent(now, spreadDays) {
  const device = DEVICES[Math.floor(Math.random() * DEVICES.length)];
  const llm = pickWeighted(LLM_WEIGHTS);
  const action = pickWeighted(ACTION_WEIGHTS);
  const ts = new Date(now - Math.random() * spreadDays * 86400 * 1000);
  const findings = makeFindings(action);
  return {
    eventId: randomUUID(),
    deviceId: device.id,
    orgId: ORG,
    userHint: device.userHint,
    timestamp: ts.toISOString(),
    hostname: HOSTS_PER_LLM[llm] || "chat.example.com",
    llm,
    action,
    endpoint: `/backend-api/conversation/${randomUUID()}`,
    mode: action === "BLOCKED" ? "block" : "anonymize",
    promptLength: 80 + Math.floor(Math.random() * 1800),
    mappingsCount: findings.reduce((n, f) => n + f.count, 0),
    anonymizedPreview:
      action === "CLEAN"
        ? "Bonjour, peux-tu m'aider à rédiger…"
        : "Bonjour [NAME_1], voici le récapitulatif pour [EMAIL_1]…",
    findings,
    extensionVersion: EXT_VERSION,
    schemaVersion: 1,
  };
}

async function waitForHealth() {
  const url = `${BASE_URL}/v1/health`;
  for (let i = 0; i < 40; i++) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      // swallow — service not up yet
    }
    await new Promise((r) => setTimeout(r, 1500));
  }
  throw new Error(`Health check never returned 200 at ${url}`);
}

async function postBatch(events) {
  const res = await fetch(`${BASE_URL}/v1/events`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${TOKEN}`,
    },
    body: JSON.stringify({ events }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`POST /v1/events ${res.status}: ${text.slice(0, 200)}`);
  }
  return res.json();
}

async function main() {
  console.log(`[seed] Base URL: ${BASE_URL}`);
  console.log(`[seed] Org:      ${ORG}`);
  console.log(`[seed] Total:    ${TOTAL} events across ${DEVICES.length} devices`);
  console.log(`[seed] Waiting for health…`);
  await waitForHealth();
  console.log(`[seed] Backend healthy. Generating and posting events…`);

  const now = Date.now();
  let accepted = 0;
  let duplicates = 0;
  const total = TOTAL;
  for (let sent = 0; sent < total; sent += BATCH_SIZE) {
    const size = Math.min(BATCH_SIZE, total - sent);
    const events = Array.from({ length: size }, () => makeEvent(now, 30));
    const result = await postBatch(events);
    accepted += result.accepted ?? 0;
    duplicates += result.duplicates ?? 0;
    process.stdout.write(`\r[seed] ${sent + size}/${total}`);
  }
  console.log(`\n[seed] Accepted: ${accepted}, duplicates: ${duplicates}`);
  console.log(`[seed] Dashboard: open http://localhost`);
}

main().catch((e) => {
  console.error(`[seed] Failed: ${e.message}`);
  process.exit(1);
});
