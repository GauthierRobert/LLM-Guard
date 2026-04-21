/**
 * LLM Guard — Tests for Layer 4 Presidio wiring.
 *
 * The extension-side integration uses `Layer4Classifier` from
 * layer4-local.js with a `presidioUrl`. These tests stub `global.fetch`
 * to simulate a real Presidio service and verify:
 *   - init() succeeds when /health returns 200
 *   - classify() maps Presidio entities to our findings shape
 *   - entities below score_threshold are omitted by Presidio, so the
 *     stubbed response drives what shows up
 *   - a down service returns ready=false and classify() yields []
 */

const { PresidioClassifier, Layer4Classifier } = require("../layer4-local.js");

let passed = 0, failed = 0, total = 0;
function test(name, fn) {
  total++;
  return Promise.resolve()
    .then(fn)
    .then(() => { passed++; console.log(`  \x1b[32m✓\x1b[0m ${name}`); })
    .catch((e) => { failed++; console.log(`  \x1b[31m✗\x1b[0m ${name}\n    \x1b[31m${e.message}\x1b[0m`); });
}
function assert(c, m) { if (!c) throw new Error(m || "Assertion failed"); }
function eq(a, b, m) { if (a !== b) throw new Error(`${m || "not equal"}\n      expected: ${JSON.stringify(b)}\n      got:      ${JSON.stringify(a)}`); }

function mockFetch(routes) {
  return async function mocked(url, opts) {
    for (const [match, handler] of Object.entries(routes)) {
      if (url.endsWith(match)) return handler(url, opts);
    }
    throw new Error(`unexpected fetch to ${url}`);
  };
}

function jsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

async function run() {
  console.log("\n\x1b[1m🧠 Layer 4 — PresidioClassifier\x1b[0m");

  await test("init() sets ready=true when /health returns 200", async () => {
    global.fetch = mockFetch({
      "/health": () => jsonResponse({ status: "ok" }),
    });
    const p = new PresidioClassifier("http://fake.presidio:5001");
    await p.init();
    assert(p.ready, "expected ready=true");
  });

  await test("init() leaves ready=false when /health fails", async () => {
    global.fetch = async () => { throw new Error("ECONNREFUSED"); };
    const p = new PresidioClassifier("http://nope:5001");
    await p.init();
    assert(!p.ready, "expected ready=false after connection failure");
  });

  await test("classify() returns empty when not ready and unreachable", async () => {
    global.fetch = async () => { throw new Error("ECONNREFUSED"); };
    const p = new PresidioClassifier("http://nope:5001");
    const findings = await p.classify("Bonjour Marie Dubois.");
    eq(Array.isArray(findings), true);
    eq(findings.length, 0);
  });

  await test("classify() maps Presidio PERSON to 'Nom de personne' with high severity", async () => {
    global.fetch = mockFetch({
      "/health": () => jsonResponse({ status: "ok" }),
      "/analyze": () => jsonResponse([
        { entity_type: "PERSON", start: 8, end: 20, score: 0.92 },
      ]),
    });
    const p = new PresidioClassifier("http://fake.presidio:5001");
    await p.init();
    const findings = await p.classify("Bonjour Marie Dubois.");
    eq(findings.length, 1);
    eq(findings[0].type, "Nom de personne");
    eq(findings[0].severity, "high");
    eq(findings[0].layer, "presidio");
    eq(findings[0].matches[0], "Marie Dubois");
    assert(findings[0].confidence >= 0.9, "confidence preserved");
  });

  await test("classify() maps CREDIT_CARD to critical severity", async () => {
    global.fetch = mockFetch({
      "/health": () => jsonResponse({ status: "ok" }),
      "/analyze": () => jsonResponse([
        { entity_type: "CREDIT_CARD", start: 0, end: 19, score: 0.99 },
      ]),
    });
    const p = new PresidioClassifier("http://fake.presidio:5001");
    await p.init();
    const findings = await p.classify("4111 1111 1111 1111 hi");
    eq(findings[0].type, "Carte bancaire");
    eq(findings[0].severity, "critical");
  });

  await test("classify() merges multiple entity types", async () => {
    global.fetch = mockFetch({
      "/health": () => jsonResponse({ status: "ok" }),
      "/analyze": () => jsonResponse([
        { entity_type: "PERSON", start: 0, end: 5, score: 0.8 },
        { entity_type: "LOCATION", start: 10, end: 15, score: 0.7 },
      ]),
    });
    const p = new PresidioClassifier("http://fake.presidio:5001");
    await p.init();
    const findings = await p.classify("Alice est à Paris.");
    eq(findings.length, 2);
    assert(findings.some((f) => f.type === "Nom de personne"));
    assert(findings.some((f) => f.type === "Lieu"));
  });

  console.log("\n\x1b[1m🧠 Layer 4 — Layer4Classifier orchestrator\x1b[0m");

  await test("orchestrator picks Presidio when presidioUrl set and service up", async () => {
    global.fetch = mockFetch({
      "/health": () => jsonResponse({ status: "ok" }),
      "/analyze": () => jsonResponse([]),
    });
    const l4 = new Layer4Classifier({ presidioUrl: "http://fake.presidio:5001", enableBrowserNLP: false });
    await l4.init();
    eq(l4.getType(), "presidio");
    assert(l4.activeClassifier, "activeClassifier should be set");
  });

  await test("orchestrator returns null classifier when Presidio down and browser NLP disabled", async () => {
    global.fetch = async () => { throw new Error("down"); };
    const l4 = new Layer4Classifier({ presidioUrl: "http://nope:5001", enableBrowserNLP: false });
    await l4.init();
    eq(l4.activeClassifier, null);
    eq(l4.getType(), null);
    const findings = await l4.classify("whatever");
    eq(findings.length, 0);
  });

  console.log("\n\x1b[1m🧠 Layer 4 — PresidioClassifier.analyzeSpans\x1b[0m");

  await test("analyzeSpans() returns raw spans when ready", async () => {
    global.fetch = mockFetch({
      "/health": () => jsonResponse({ status: "ok" }),
      "/analyze": () => jsonResponse([
        { entity_type: "PERSON", start: 8, end: 20, score: 0.92 },
        { entity_type: "LOCATION", start: 25, end: 30, score: 0.75 },
      ]),
    });
    const p = new PresidioClassifier("http://fake.presidio:5001");
    await p.init();
    const spans = await p.analyzeSpans("Bonjour Marie Dubois vit à Paris.");
    eq(spans.length, 2);
    eq(spans[0].entity_type, "PERSON");
    eq(spans[0].start, 8);
    eq(spans[0].end, 20);
    eq(spans[1].entity_type, "LOCATION");
  });

  await test("analyzeSpans() returns [] when not ready", async () => {
    global.fetch = async () => { throw new Error("ECONNREFUSED"); };
    const p = new PresidioClassifier("http://nope:5001");
    const spans = await p.analyzeSpans("test");
    eq(spans.length, 0);
  });

  await test("analyzeSpans() returns [] on non-ok response", async () => {
    global.fetch = mockFetch({
      "/health": () => jsonResponse({ status: "ok" }),
      "/analyze": () => jsonResponse({ error: "bad request" }, 400),
    });
    const p = new PresidioClassifier("http://fake.presidio:5001");
    await p.init();
    const spans = await p.analyzeSpans("test");
    eq(spans.length, 0);
  });

  // Wait for all tests to finish before reporting
  console.log(`\n\x1b[1m${passed}/${total} tests passed\x1b[0m`);
  if (failed > 0) process.exit(1);
}

run();
