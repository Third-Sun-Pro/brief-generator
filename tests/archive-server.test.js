import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import { createRequire } from "node:module";
import request from "supertest";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

// Set env vars before loading anything
process.env.APP_PASSWORD = "test-password";
process.env.NODE_ENV = "test";

// Use temp dir for archive so tests don't pollute real data
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "archive-server-test-"));
process.env.ARCHIVE_DIR = tmpDir;

const sampleBrief = "# Creative Brief — Acme Corp\n\nSample brief.";

const mockGenerateBriefStream = vi.fn().mockImplementation(async (csv, pdf, siteContext, onChunk) => {
  onChunk("chunk");
  return {
    docxBuffer: Buffer.from("fake-docx"),
    markdownText: sampleBrief,
    clientName: "Acme Corp",
    params: {
      model: "claude-sonnet-4-6",
      max_tokens: 16000,
      system: "system",
      messages: [{ role: "user", content: "original" }],
    },
  };
});

const mockReviseBriefStream = vi.fn().mockImplementation(async (params, markdown, feedback, onChunk) => {
  onChunk("revised");
  return {
    docxBuffer: Buffer.from("revised-docx"),
    markdownText: "# Creative Brief — Acme Corp\n\nRevised.",
    clientName: "Acme Corp",
  };
});

// Mock generate.js
const generatePath = require.resolve("../generate");
require.cache[generatePath] = {
  id: generatePath,
  filename: generatePath,
  loaded: true,
  exports: {
    generateBrief: vi.fn(),
    generateBriefStream: mockGenerateBriefStream,
    reviseBriefStream: mockReviseBriefStream,
    parseInlineFormatting: () => [],
    parseMarkdownToDocxChildren: () => [],
  },
};

// Mock scrape.js
const scrapePath = require.resolve("../scrape");
require.cache[scrapePath] = {
  id: scrapePath,
  filename: scrapePath,
  loaded: true,
  exports: { scrapeNavigation: vi.fn().mockResolvedValue(null) },
};

// Load server
const serverPath = require.resolve("../server");
delete require.cache[serverPath];
const app = require("../server");

const fixturesDir = path.join(__dirname, "fixtures");

async function getAuthCookie(appInstance) {
  const res = await request(appInstance)
    .post("/login")
    .send({ password: "test-password" });
  return res.headers["set-cookie"][0].split(";")[0];
}

function parseSSE(text) {
  return text
    .split("\n")
    .filter((line) => line.startsWith("data: "))
    .map((line) => JSON.parse(line.slice(6)));
}

describe("Archive endpoints", () => {
  let authCookie;
  let csvBuffer;
  let pdfBuffer;

  beforeAll(async () => {
    csvBuffer = fs.readFileSync(path.join(fixturesDir, "sample.csv"));
    const pdfBase64 = fs.readFileSync(path.join(fixturesDir, "sample.pdf.base64"), "utf-8");
    pdfBuffer = Buffer.from(pdfBase64, "base64");
    authCookie = await getAuthCookie(app);
  });

  beforeEach(() => {
    // Clear archive file between tests
    const archivePath = path.join(tmpDir, "archive.json");
    if (fs.existsSync(archivePath)) fs.unlinkSync(archivePath);
    if (app.sessions) app.sessions.clear();
  });

  it("GET /archive returns 401 without auth", async () => {
    const res = await request(app).get("/archive");
    expect(res.status).toBe(401);
  });

  it("GET /archive returns empty array when no briefs exist", async () => {
    const res = await request(app)
      .get("/archive")
      .set("Cookie", authCookie);
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it("GET /archive/:id returns 404 for unknown id", async () => {
    const res = await request(app)
      .get("/archive/nonexistent-id")
      .set("Cookie", authCookie);
    expect(res.status).toBe(404);
  });

  it("auto-archives on /generate-stream with source 'generate'", async () => {
    const res = await request(app)
      .post("/generate-stream")
      .set("Cookie", authCookie)
      .attach("csv", csvBuffer, "test.csv")
      .attach("pdf", pdfBuffer, "test.pdf");

    expect(res.status).toBe(200);

    // Check archive has the entry
    const archiveRes = await request(app)
      .get("/archive")
      .set("Cookie", authCookie);

    expect(archiveRes.body).toHaveLength(1);
    expect(archiveRes.body[0].clientName).toBe("Acme Corp");
    expect(archiveRes.body[0].source).toBe("generate");
  });

  it("auto-archives on /revise-stream with source 'revise'", async () => {
    // Generate first to create a session
    const genRes = await request(app)
      .post("/generate-stream")
      .set("Cookie", authCookie)
      .attach("csv", csvBuffer, "test.csv")
      .attach("pdf", pdfBuffer, "test.pdf");

    const sessionId = parseSSE(genRes.text).find((e) => e.done).sessionId;

    // Now revise
    await request(app)
      .post("/revise-stream")
      .set("Cookie", authCookie)
      .send({ sessionId, feedback: "make it better" });

    const archiveRes = await request(app)
      .get("/archive")
      .set("Cookie", authCookie);

    // Should have 2 entries: one generate, one revise
    expect(archiveRes.body).toHaveLength(2);
    const sources = archiveRes.body.map((e) => e.source).sort();
    expect(sources).toEqual(["generate", "revise"]);
  });

  it("GET /archive/:id returns full entry with markdown and docxBase64", async () => {
    // Generate to create an archive entry
    await request(app)
      .post("/generate-stream")
      .set("Cookie", authCookie)
      .attach("csv", csvBuffer, "test.csv")
      .attach("pdf", pdfBuffer, "test.pdf");

    const archiveRes = await request(app)
      .get("/archive")
      .set("Cookie", authCookie);

    const entryId = archiveRes.body[0].id;

    const entryRes = await request(app)
      .get("/archive/" + entryId)
      .set("Cookie", authCookie);

    expect(entryRes.status).toBe(200);
    expect(entryRes.body.id).toBe(entryId);
    expect(entryRes.body.markdown).toBeDefined();
    expect(entryRes.body.docxBase64).toBeDefined();
    expect(entryRes.body.clientName).toBe("Acme Corp");
  });

  it("archive failure does not break generation", async () => {
    // Make archive dir read-only to force a write failure
    fs.chmodSync(tmpDir, 0o444);

    const res = await request(app)
      .post("/generate-stream")
      .set("Cookie", authCookie)
      .attach("csv", csvBuffer, "test.csv")
      .attach("pdf", pdfBuffer, "test.pdf");

    // Generation should still succeed
    expect(res.status).toBe(200);
    const events = parseSSE(res.text);
    const doneEvent = events.find((e) => e.done);
    expect(doneEvent).toBeDefined();
    expect(doneEvent.markdown).toBe(sampleBrief);

    // Restore permissions for cleanup
    fs.chmodSync(tmpDir, 0o755);
  });
});
