import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { createRequire } from "node:module";
import request from "supertest";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

// Set env vars before loading server
process.env.APP_PASSWORD = "test-password";
process.env.ANTHROPIC_API_KEY = "test-key";
process.env.NODE_ENV = "test";

const sampleBrief = "# Creative Brief — Acme Corp\n\nOriginal brief content.";
const revisedBrief = "# Creative Brief — Acme Corp\n\nRevised brief content.";

const mockGenerateBrief = vi.fn().mockResolvedValue({
  docxBuffer: Buffer.from("fake-docx"),
  markdownText: sampleBrief,
  clientName: "Acme Corp",
});

const mockGenerateBriefStream = vi.fn().mockImplementation(async (csv, pdf, siteContext, onChunk) => {
  onChunk("streaming chunk");
  return {
    docxBuffer: Buffer.from("fake-docx"),
    markdownText: sampleBrief,
    clientName: "Acme Corp",
    params: {
      model: "claude-sonnet-4-6",
      max_tokens: 16000,
      system: "system prompt",
      messages: [{ role: "user", content: "original" }],
    },
  };
});

const mockReviseBriefStream = vi.fn().mockImplementation(async (params, markdown, feedback, onChunk) => {
  onChunk("revised chunk");
  return {
    docxBuffer: Buffer.from("revised-docx"),
    markdownText: revisedBrief,
    clientName: "Acme Corp",
  };
});

// Patch the CJS require cache so server.js gets our mocks
const generatePath = require.resolve("../generate");
require.cache[generatePath] = {
  id: generatePath,
  filename: generatePath,
  loaded: true,
  exports: {
    generateBrief: mockGenerateBrief,
    generateBriefStream: mockGenerateBriefStream,
    reviseBriefStream: mockReviseBriefStream,
    parseInlineFormatting: () => [],
    parseMarkdownToDocxChildren: () => [],
  },
};

// Mock scrape.js so server.js doesn't need cheerio
const scrapePath = require.resolve("../scrape");
require.cache[scrapePath] = {
  id: scrapePath,
  filename: scrapePath,
  loaded: true,
  exports: { scrapeNavigation: vi.fn().mockResolvedValue(null) },
};

// Clear server.js from cache and load with mocked generate
const serverPath = require.resolve("../server");
delete require.cache[serverPath];
const app = require("../server");

const fixturesDir = path.join(__dirname, "fixtures");

async function getAuthCookie(appInstance) {
  const res = await request(appInstance)
    .post("/login")
    .send({ password: "test-password" });
  const setCookie = res.headers["set-cookie"];
  return setCookie[0].split(";")[0];
}

function parseSSE(text) {
  return text
    .split("\n")
    .filter((line) => line.startsWith("data: "))
    .map((line) => JSON.parse(line.slice(6)));
}

describe("POST /revise-stream", () => {
  let csvBuffer;
  let pdfBuffer;
  let authCookie;

  beforeAll(async () => {
    csvBuffer = fs.readFileSync(path.join(fixturesDir, "sample.csv"));
    const pdfBase64 = fs.readFileSync(path.join(fixturesDir, "sample.pdf.base64"), "utf-8");
    pdfBuffer = Buffer.from(pdfBase64, "base64");
    authCookie = await getAuthCookie(app);
  });

  beforeEach(() => {
    // Clear sessions between tests
    if (app.sessions) app.sessions.clear();
    mockGenerateBriefStream.mockClear();
    mockReviseBriefStream.mockClear();
  });

  it("/generate-stream done event includes sessionId", async () => {
    const res = await request(app)
      .post("/generate-stream")
      .set("Cookie", authCookie)
      .attach("csv", csvBuffer, "test.csv")
      .attach("pdf", pdfBuffer, "test.pdf");

    expect(res.status).toBe(200);
    const events = parseSSE(res.text);
    const doneEvent = events.find((e) => e.done);
    expect(doneEvent).toBeDefined();
    expect(doneEvent.sessionId).toBeDefined();
    expect(typeof doneEvent.sessionId).toBe("string");
  });

  it("returns 400 when sessionId is missing", async () => {
    const res = await request(app)
      .post("/revise-stream")
      .set("Cookie", authCookie)
      .send({ feedback: "make it shorter" });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/sessionId/);
  });

  it("returns 400 when feedback is missing", async () => {
    const res = await request(app)
      .post("/revise-stream")
      .set("Cookie", authCookie)
      .send({ sessionId: "some-id" });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/feedback/);
  });

  it("returns 400 when feedback is empty whitespace", async () => {
    const res = await request(app)
      .post("/revise-stream")
      .set("Cookie", authCookie)
      .send({ sessionId: "some-id", feedback: "   " });

    expect(res.status).toBe(400);
  });

  it("returns 404 for unknown sessionId", async () => {
    const res = await request(app)
      .post("/revise-stream")
      .set("Cookie", authCookie)
      .send({ sessionId: "nonexistent-id", feedback: "make it shorter" });

    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/not found|expired/i);
  });

  it("streams revised brief successfully after generation", async () => {
    // Step 1: Generate to create a session
    const genRes = await request(app)
      .post("/generate-stream")
      .set("Cookie", authCookie)
      .attach("csv", csvBuffer, "test.csv")
      .attach("pdf", pdfBuffer, "test.pdf");

    const genEvents = parseSSE(genRes.text);
    const sessionId = genEvents.find((e) => e.done).sessionId;

    // Step 2: Revise using the session
    const revRes = await request(app)
      .post("/revise-stream")
      .set("Cookie", authCookie)
      .send({ sessionId, feedback: "make it more formal" });

    expect(revRes.status).toBe(200);
    const revEvents = parseSSE(revRes.text);

    const textEvents = revEvents.filter((e) => e.text);
    expect(textEvents.length).toBeGreaterThan(0);

    const doneEvent = revEvents.find((e) => e.done);
    expect(doneEvent).toBeDefined();
    expect(doneEvent.docxBase64).toBeDefined();
    expect(doneEvent.markdown).toBe(revisedBrief);
    expect(doneEvent.sessionId).toBe(sessionId);
  });

  it("supports multiple revisions on the same session", async () => {
    // Generate
    const genRes = await request(app)
      .post("/generate-stream")
      .set("Cookie", authCookie)
      .attach("csv", csvBuffer, "test.csv")
      .attach("pdf", pdfBuffer, "test.pdf");

    const sessionId = parseSSE(genRes.text).find((e) => e.done).sessionId;

    // First revision
    const rev1 = await request(app)
      .post("/revise-stream")
      .set("Cookie", authCookie)
      .send({ sessionId, feedback: "first revision" });

    expect(rev1.status).toBe(200);
    expect(parseSSE(rev1.text).find((e) => e.done)).toBeDefined();

    // Second revision
    const rev2 = await request(app)
      .post("/revise-stream")
      .set("Cookie", authCookie)
      .send({ sessionId, feedback: "second revision" });

    expect(rev2.status).toBe(200);
    expect(parseSSE(rev2.text).find((e) => e.done)).toBeDefined();

    // reviseBriefStream should have been called twice
    expect(mockReviseBriefStream).toHaveBeenCalledTimes(2);
  });

  it("returns 404 for expired session", async () => {
    // Generate to create a session
    const genRes = await request(app)
      .post("/generate-stream")
      .set("Cookie", authCookie)
      .attach("csv", csvBuffer, "test.csv")
      .attach("pdf", pdfBuffer, "test.pdf");

    const sessionId = parseSSE(genRes.text).find((e) => e.done).sessionId;

    // Manually expire the session
    const session = app.sessions.get(sessionId);
    session.createdAt = Date.now() - 31 * 60 * 1000; // 31 min ago

    const res = await request(app)
      .post("/revise-stream")
      .set("Cookie", authCookie)
      .send({ sessionId, feedback: "too late" });

    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/expired/i);
  });
});
