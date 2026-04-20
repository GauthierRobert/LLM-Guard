/**
 * LLM Guard — Attachment scanner tests
 * Usage : node tests/test-attachment-scanner.js
 *
 * The goal is to exercise the dispatch + metadata logic in `attachment-scanner.js`
 * WITHOUT pulling in pdf.js or tesseract.js. Extractors are stubbed so the tests
 * stay deterministic and fast (< 200 ms total).
 */

const assert = require("assert");
const path = require("path");

// Node 22 has File/Blob as globals; guard for older runtimes.
if (typeof File === "undefined" || typeof Blob === "undefined") {
  console.error("This test requires Node 20+ (File + Blob globals).");
  process.exit(2);
}

const scanner = require(path.join(__dirname, "..", "attachment-scanner.js"));

let passed = 0, failed = 0, total = 0;
async function test(name, fn) {
  total++;
  try {
    await fn();
    passed++;
    console.log(`  \x1b[32m✓\x1b[0m ${name}`);
  } catch (err) {
    failed++;
    console.log(`  \x1b[31m✗\x1b[0m ${name}\n    \x1b[31m${err?.stack || err}\x1b[0m`);
  }
}

function makeFile(content, name, type) {
  const body = content instanceof Uint8Array ? [content] : [content];
  return new File(body, name, { type });
}

// ─── Stub extractors ───────────────────────────────────────────────
function stubExtractor(id, extensions, mime, impl) {
  return {
    id,
    canHandle(file) {
      if (!file) return false;
      if (mime && file.type && mime.test(file.type)) return true;
      if (file.name && extensions.test(file.name)) return true;
      return false;
    },
    async extract(file, opts) {
      return impl(file, opts);
    },
  };
}

(async () => {
  console.log("\n\x1b[1mDispatch + metadata\x1b[0m");

  await test("Returns not-a-file when given a plain object", async () => {
    const r = await scanner.scanAttachment({});
    assert.strictEqual(r.skipped, true);
    assert.strictEqual(r.reason, "not-a-file");
  });

  await test("Returns size error when file exceeds maxSizeBytes", async () => {
    const big = makeFile(new Uint8Array(1024 * 10), "big.pdf", "application/pdf");
    const r = await scanner.scanAttachment(big, {
      maxSizeBytes: 1024,
      extractors: { pdf: stubExtractor("pdf", /\.pdf$/i, /pdf/, async () => ({ text: "X" })) },
    });
    assert.strictEqual(r.truncated, true);
    assert.strictEqual(r.unavailable, true);
    assert.strictEqual(r.reason, "size");
    assert.strictEqual(r.sizeBytes, 1024 * 10);
  });

  await test("Skips unsupported MIME with clear reason", async () => {
    const f = makeFile(Buffer.from("...."), "blob.bin", "application/octet-stream");
    const r = await scanner.scanAttachment(f, { extractors: {} });
    assert.strictEqual(r.skipped, true);
    assert.strictEqual(r.reason, "unsupported-type");
  });

  await test("Skips disabled type without running extractor", async () => {
    let called = false;
    const pdf = stubExtractor("pdf", /\.pdf$/i, /pdf/, async () => { called = true; return { text: "" }; });
    const f = makeFile(Buffer.from("x"), "doc.pdf", "application/pdf");
    const r = await scanner.scanAttachment(f, {
      types: { pdf: false, image: true, text: true },
      extractors: { pdf },
    });
    assert.strictEqual(r.skipped, true);
    assert.strictEqual(r.reason, "type-disabled");
    assert.strictEqual(called, false);
  });

  await test("Populates filename / mimeType / sizeBytes from the File", async () => {
    const text = stubExtractor("text", /\.txt$/i, /text/, async () => ({ text: "hello" }));
    const f = makeFile("hello world", "notes.txt", "text/plain");
    const r = await scanner.scanAttachment(f, { extractors: { text } });
    assert.strictEqual(r.filename, "notes.txt");
    assert.strictEqual(r.mimeType, "text/plain");
    assert.strictEqual(r.sizeBytes, 11);
    assert.strictEqual(r.text, "hello");
    assert.strictEqual(r.extractorId, "text");
  });

  await test("Honors extractor priority: text before pdf before image", async () => {
    const calls = [];
    const text = stubExtractor("text", /\.(txt|md)$/i, /text/, async () => { calls.push("text"); return { text: "t" }; });
    const pdf = stubExtractor("pdf", /\.pdf$/i, /pdf/, async () => { calls.push("pdf"); return { text: "p" }; });
    const image = stubExtractor("image", /\.png$/i, /image/, async () => { calls.push("img"); return { text: "i" }; });

    const pdfFile = makeFile("x", "a.pdf", "application/pdf");
    await scanner.scanAttachment(pdfFile, { extractors: { text, pdf, image } });
    assert.deepStrictEqual(calls, ["pdf"], `expected pdf-only, got ${calls}`);

    calls.length = 0;
    const imgFile = makeFile("x", "a.png", "image/png");
    await scanner.scanAttachment(imgFile, { extractors: { text, pdf, image } });
    assert.deepStrictEqual(calls, ["img"]);
  });

  await test("Reports extract-error without throwing", async () => {
    const pdf = stubExtractor("pdf", /\.pdf$/i, /pdf/, async () => { throw new Error("boom"); });
    const f = makeFile("x", "a.pdf", "application/pdf");
    const r = await scanner.scanAttachment(f, { extractors: { pdf } });
    assert.strictEqual(r.skipped, true);
    assert.strictEqual(r.reason, "extract-error");
    assert.ok(r.error.includes("boom"));
  });

  await test("Flags unavailable vendor library without failing", async () => {
    const pdf = stubExtractor("pdf", /\.pdf$/i, /pdf/, async () => ({ text: "", unavailable: true, kind: "pdf" }));
    const f = makeFile("x", "a.pdf", "application/pdf");
    const r = await scanner.scanAttachment(f, { extractors: { pdf } });
    assert.strictEqual(r.unavailable, true);
    assert.strictEqual(r.text, "");
    assert.strictEqual(r.extractorId, "pdf");
  });

  await test("Surfaces passwordProtected flag from PDF extractor", async () => {
    const pdf = stubExtractor("pdf", /\.pdf$/i, /pdf/, async () => ({ text: "", passwordProtected: true, kind: "pdf" }));
    const f = makeFile("x", "secret.pdf", "application/pdf");
    const r = await scanner.scanAttachment(f, { extractors: { pdf } });
    assert.strictEqual(r.passwordProtected, true);
  });

  await test("Passes maxChars down to extractor", async () => {
    let seen = null;
    const text = stubExtractor("text", /\.txt$/i, /text/, async (_file, opts) => {
      seen = opts;
      return { text: "hello" };
    });
    const f = makeFile("hello", "a.txt", "text/plain");
    await scanner.scanAttachment(f, { maxChars: 123, extractors: { text } });
    assert.strictEqual(seen.maxChars, 123);
  });

  console.log("\n\x1b[1mcollectFiles helper\x1b[0m");

  await test("collectFiles extracts File from FormData", () => {
    const fd = new FormData();
    const f1 = makeFile("a", "one.txt", "text/plain");
    const f2 = makeFile("b", "two.pdf", "application/pdf");
    fd.append("note", "unused-string");
    fd.append("file1", f1);
    fd.append("file2", f2);
    const out = scanner.collectFiles(fd);
    assert.strictEqual(out.length, 2);
    assert.ok(out.every((x) => x instanceof File || x instanceof Blob));
  });

  await test("collectFiles returns singleton for bare File body", () => {
    const f = makeFile("x", "a.txt", "text/plain");
    const out = scanner.collectFiles(f);
    assert.strictEqual(out.length, 1);
    assert.strictEqual(out[0], f);
  });

  await test("collectFiles is a no-op for strings and null", () => {
    assert.deepStrictEqual(scanner.collectFiles(""), []);
    assert.deepStrictEqual(scanner.collectFiles(null), []);
    assert.deepStrictEqual(scanner.collectFiles("{\"x\":1}"), []);
  });

  console.log("\n\x1b[1mReal text extractor\x1b[0m");

  // Load the real text extractor through a sandbox that mimics the browser IIFE.
  const vm = require("vm");
  const fs = require("fs");
  const textSrc = fs.readFileSync(path.join(__dirname, "..", "extractors", "text-extractor.js"), "utf8");
  const sandbox = { window: { __llmGuard: {} }, module: { exports: {} } };
  vm.createContext(sandbox);
  vm.runInContext(textSrc, sandbox);
  const textExtractor = sandbox.module.exports;

  await test("text extractor canHandle() matches text/*, json, xml, csv, md", () => {
    assert.ok(textExtractor.canHandle({ type: "text/plain" }));
    assert.ok(textExtractor.canHandle({ type: "application/json" }));
    assert.ok(textExtractor.canHandle({ type: "text/csv" }));
    assert.ok(textExtractor.canHandle({ name: "notes.md" }));
    assert.ok(!textExtractor.canHandle({ type: "application/pdf" }));
    assert.ok(!textExtractor.canHandle({ type: "image/png" }));
  });

  await test("text extractor reads full content under maxChars", async () => {
    const f = makeFile("alice@example.com\nbob@example.com", "addrs.txt", "text/plain");
    const r = await textExtractor.extract(f, { maxChars: 10_000 });
    assert.ok(r.text.includes("alice@example.com"));
    assert.strictEqual(r.truncated, false);
  });

  await test("text extractor truncates when content exceeds maxChars", async () => {
    const big = "A".repeat(5000);
    const f = makeFile(big, "big.txt", "text/plain");
    const r = await textExtractor.extract(f, { maxChars: 100 });
    assert.strictEqual(r.text.length, 100);
    assert.strictEqual(r.truncated, true);
  });

  console.log("\n\x1b[1misAttachmentAllowlisted\x1b[0m");

  const allowlist = require(path.join(__dirname, "..", "rules", "allowlist.js"));
  await test("sha256 allowlist match short-circuits (string)", () => {
    allowlist.loadAllowlist([{ type: "attachment", pattern: "deadbeef" }]);
    assert.strictEqual(allowlist.isAttachmentAllowlisted("deadbeef", "x.pdf"), true);
    assert.strictEqual(allowlist.isAttachmentAllowlisted("other", "x.pdf"), false);
  });

  await test("filename pattern is allowlisted", () => {
    allowlist.loadAllowlist([{ type: "attachment", pattern: "template.pdf" }]);
    assert.strictEqual(allowlist.isAttachmentAllowlisted("0", "template.pdf"), true);
    assert.strictEqual(allowlist.isAttachmentAllowlisted("0", "other.pdf"), false);
  });

  await test("regex pattern is honored for sha256 prefixes", () => {
    allowlist.loadAllowlist([{ type: "attachment", pattern: "^ab.*", isRegex: true }]);
    assert.strictEqual(allowlist.isAttachmentAllowlisted("abcdef123", "x.pdf"), true);
    assert.strictEqual(allowlist.isAttachmentAllowlisted("xyzabc", "x.pdf"), false);
  });

  console.log(`\n${"=".repeat(50)}`);
  console.log(`Total: ${total}  \x1b[32mPassed: ${passed}\x1b[0m  \x1b[31mFailed: ${failed}\x1b[0m`);
  if (failed > 0) process.exit(1);
})();
