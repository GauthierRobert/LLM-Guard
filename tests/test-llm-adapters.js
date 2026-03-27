/**
 * LLM Guard — Tests for LLM adapters (extract/inject)
 * Usage: node tests/test-llm-adapters.js
 */
const { extractPrompt, injectAnonymized, LLM_ADAPTERS } = require("../llm-adapters.js");

let passed = 0, failed = 0, total = 0;
function test(name, fn) {
  total++;
  try { fn(); passed++; console.log(`  \x1b[32m✓\x1b[0m ${name}`); }
  catch (e) { failed++; console.log(`  \x1b[31m✗\x1b[0m ${name}\n    \x1b[31m${e.message}\x1b[0m`); }
}
function assert(c, m) { if (!c) throw new Error(m || "Assertion failed"); }

// ═══════════════════════════════════════════════════════════════
// ChatGPT
// ═══════════════════════════════════════════════════════════════

console.log("\n\x1b[1m\x1b[36m━━━ ChatGPT Adapter ━━━\x1b[0m\n");

test("Extract from ChatGPT messages with content.parts", () => {
  const body = JSON.stringify({
    messages: [{ author: { role: "user" }, content: { parts: ["Hello world"] } }]
  });
  const text = extractPrompt(body, LLM_ADAPTERS.chatgpt);
  assert(text === "Hello world", `Got: ${text}`);
});

test("Extract from ChatGPT messages with string content", () => {
  const body = JSON.stringify({
    messages: [{ role: "user", content: "Test prompt" }]
  });
  const text = extractPrompt(body, LLM_ADAPTERS.chatgpt);
  assert(text === "Test prompt", `Got: ${text}`);
});

test("Extract skips non-user messages", () => {
  const body = JSON.stringify({
    messages: [
      { role: "system", content: "System prompt" },
      { role: "user", content: "User question" },
      { role: "assistant", content: "Response" },
    ]
  });
  const text = extractPrompt(body, LLM_ADAPTERS.chatgpt);
  assert(text === "User question", `Got: ${text}`);
});

test("Inject into ChatGPT body", () => {
  const body = JSON.stringify({
    messages: [{ role: "user", content: "original@email.com" }]
  });
  const result = injectAnonymized(body, "[EMAIL_1]", LLM_ADAPTERS.chatgpt);
  const parsed = JSON.parse(result);
  assert(parsed.messages[0].content === "[EMAIL_1]", `Got: ${parsed.messages[0].content}`);
});

test("Inject into ChatGPT body with parts", () => {
  const body = JSON.stringify({
    messages: [{ author: { role: "user" }, content: { parts: ["hello", "world"] } }]
  });
  const result = injectAnonymized(body, "[ANON]", LLM_ADAPTERS.chatgpt);
  const parsed = JSON.parse(result);
  assert(parsed.messages[0].content.parts[0] === "[ANON]", "First part should be anonymized");
  assert(parsed.messages[0].content.parts[1] === "[ANON]", "Second part should be anonymized");
});

// ═══════════════════════════════════════════════════════════════
// Claude
// ═══════════════════════════════════════════════════════════════

console.log("\n\x1b[1m\x1b[36m━━━ Claude Adapter ━━━\x1b[0m\n");

test("Extract from Claude prompt field", () => {
  const body = JSON.stringify({ prompt: "What is AI?" });
  const text = extractPrompt(body, LLM_ADAPTERS.claude);
  assert(text === "What is AI?", `Got: ${text}`);
});

test("Extract from Claude messages array", () => {
  const body = JSON.stringify({
    messages: [{ role: "user", content: "Hello Claude" }]
  });
  const text = extractPrompt(body, LLM_ADAPTERS.claude);
  assert(text === "Hello Claude", `Got: ${text}`);
});

test("Extract from Claude content blocks", () => {
  const body = JSON.stringify({
    messages: [{ role: "user", content: [{ type: "text", text: "Block text" }] }]
  });
  const text = extractPrompt(body, LLM_ADAPTERS.claude);
  assert(text === "Block text", `Got: ${text}`);
});

test("Inject into Claude prompt field", () => {
  const body = JSON.stringify({ prompt: "original" });
  const result = injectAnonymized(body, "[ANON]", LLM_ADAPTERS.claude);
  const parsed = JSON.parse(result);
  assert(parsed.prompt === "[ANON]", `Got: ${parsed.prompt}`);
});

test("Inject into Claude messages with content blocks", () => {
  const body = JSON.stringify({
    messages: [{ role: "user", content: [{ type: "text", text: "original" }] }]
  });
  const result = injectAnonymized(body, "[ANON]", LLM_ADAPTERS.claude);
  const parsed = JSON.parse(result);
  assert(parsed.messages[0].content[0].text === "[ANON]", "Content block should be anonymized");
});

// ═══════════════════════════════════════════════════════════════
// Gemini
// ═══════════════════════════════════════════════════════════════

console.log("\n\x1b[1m\x1b[36m━━━ Gemini Adapter ━━━\x1b[0m\n");

test("Extract from Gemini contents", () => {
  const body = JSON.stringify({
    contents: [{ role: "user", parts: [{ text: "Gemini question" }] }]
  });
  const text = extractPrompt(body, LLM_ADAPTERS.gemini);
  assert(text === "Gemini question", `Got: ${text}`);
});

test("Inject into Gemini contents", () => {
  const body = JSON.stringify({
    contents: [{ role: "user", parts: [{ text: "original" }] }]
  });
  const result = injectAnonymized(body, "[ANON]", LLM_ADAPTERS.gemini);
  const parsed = JSON.parse(result);
  assert(parsed.contents[0].parts[0].text === "[ANON]", "Part text should be anonymized");
});

// ═══════════════════════════════════════════════════════════════
// Copilot
// ═══════════════════════════════════════════════════════════════

console.log("\n\x1b[1m\x1b[36m━━━ Copilot Adapter ━━━\x1b[0m\n");

test("Extract from Copilot messages with text field", () => {
  const body = JSON.stringify({
    messages: [{ author: "user", text: "Copilot prompt" }]
  });
  const text = extractPrompt(body, LLM_ADAPTERS.copilot);
  assert(text === "Copilot prompt", `Got: ${text}`);
});

test("Inject into Copilot messages", () => {
  const body = JSON.stringify({
    messages: [{ author: "user", text: "original", content: "original" }]
  });
  const result = injectAnonymized(body, "[ANON]", LLM_ADAPTERS.copilot);
  const parsed = JSON.parse(result);
  assert(parsed.messages[0].text === "[ANON]", "text field should be anonymized");
  assert(parsed.messages[0].content === "[ANON]", "content field should be anonymized");
});

// ═══════════════════════════════════════════════════════════════
// Edge cases
// ═══════════════════════════════════════════════════════════════

console.log("\n\x1b[1m\x1b[36m━━━ Edge Cases ━━━\x1b[0m\n");

test("Extract from invalid JSON returns empty string", () => {
  const text = extractPrompt("not valid json", LLM_ADAPTERS.chatgpt);
  assert(text === "not valid json", `Got: ${text}`);
});

test("Extract from empty body returns empty string", () => {
  const text = extractPrompt("", LLM_ADAPTERS.chatgpt);
  assert(text === "", `Got: "${text}"`);
});

test("Inject into invalid JSON returns original body", () => {
  const result = injectAnonymized("not json", "[ANON]", LLM_ADAPTERS.chatgpt);
  assert(result === "not json", `Got: ${result}`);
});

test("Extract from body with no messages returns JSON string", () => {
  const body = JSON.stringify({ model: "gpt-4" });
  const text = extractPrompt(body, LLM_ADAPTERS.chatgpt);
  assert(text === body, `Got: ${text}`);
});

// ═══════════════════════════════════════════════════════════════
// Summary
// ═══════════════════════════════════════════════════════════════

console.log("\n" + "═".repeat(50));
if (failed === 0) {
  console.log(`\x1b[32m\x1b[1m  ✓ ${passed}/${total} tests réussis\x1b[0m`);
} else {
  console.log(`\x1b[31m\x1b[1m  ✗ ${failed} échoué(s) sur ${total}\x1b[0m`);
}
console.log("═".repeat(50) + "\n");
process.exit(failed > 0 ? 1 : 0);
