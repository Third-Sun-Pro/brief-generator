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

const sampleBrief = "# Creative Brief — Acme Corp\n\nBrief content.";
const commonalitiesMd =
  "## Areas of Agreement\n\n- Both want a modern site\n\n## Areas of Disagreement\n\n- Color preferences differ";

const mockGenerateBrief = vi.fn().mockResolvedValue({
  docxBuffer: Buffer.from("fake-docx"),
  markdownText: sampleBrief,
  clientName: "Acme Corp",
});

const mockGenerateBriefStream = vi.fn().mockImplementation(async (csv, scope, notes, siteContext, onChunk) => {
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
    markdownText: "# Creative Brief — Acme Corp\n\nRevised.",
    clientName: "Acme Corp",
  };
});

const mockGenerateCommonalities = vi.fn().mockResolvedValue({
  markdown: commonalitiesMd,
  docxBuffer: Buffer.from("fake-commonalities-docx"),
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
    generateCommonalities: mockGenerateCommonalities,
    parseInlineFormatting: () => [],
    parseMarkdownToDocxChildren: () => [],
    buildDocx: () => Buffer.from("docx"),
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

// Mock archive.js
const archivePath = require.resolve("../archive");
require.cache[archivePath] = {
  id: archivePath,
  filename: archivePath,
  loaded: true,
  exports: { addEntry: vi.fn(), listEntries: () => [], getEntry: () => null },
};

// Clear server.js from cache and load with mocked deps
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

describe("commonalities integration", () => {
  let csvBuffer;
  let authCookie;

  beforeAll(async () => {
    csvBuffer = fs.readFileSync(path.join(fixturesDir, "sample.csv"));
    authCookie = await getAuthCookie(app);
  });

  beforeEach(() => {
    if (app.sessions) app.sessions.clear();
    mockGenerateBriefStream.mockClear();
    mockReviseBriefStream.mockClear();
    mockGenerateCommonalities.mockClear();
  });

  it("done event includes commonalities when 2+ CSVs uploaded", async () => {
    const res = await request(app)
      .post("/generate-stream")
      .set("Cookie", authCookie)
      .attach("csv", csvBuffer, "q1.csv")
      .attach("csv", csvBuffer, "q2.csv")
      .field("scope", "Test scope");

    expect(res.status).toBe(200);
    const events = parseSSE(res.text);
    const doneEvent = events.find((e) => e.done);
    expect(doneEvent).toBeDefined();
    expect(doneEvent.commonalities).toBeDefined();
    expect(doneEvent.commonalities.markdown).toBe(commonalitiesMd);
    expect(doneEvent.commonalities.docxBase64).toBeTruthy();
  });

  it("done event omits commonalities when 1 CSV uploaded", async () => {
    const res = await request(app)
      .post("/generate-stream")
      .set("Cookie", authCookie)
      .attach("csv", csvBuffer, "q1.csv")
      .field("scope", "Test scope");

    expect(res.status).toBe(200);
    const events = parseSSE(res.text);
    const doneEvent = events.find((e) => e.done);
    expect(doneEvent).toBeDefined();
    expect(doneEvent.commonalities).toBeUndefined();
    expect(mockGenerateCommonalities).not.toHaveBeenCalled();
  });

  it("brief succeeds even if commonalities fails", async () => {
    mockGenerateCommonalities.mockRejectedValueOnce(new Error("API overloaded"));

    const res = await request(app)
      .post("/generate-stream")
      .set("Cookie", authCookie)
      .attach("csv", csvBuffer, "q1.csv")
      .attach("csv", csvBuffer, "q2.csv")
      .field("scope", "Test scope");

    expect(res.status).toBe(200);
    const events = parseSSE(res.text);
    const doneEvent = events.find((e) => e.done);
    expect(doneEvent).toBeDefined();
    expect(doneEvent.docxBase64).toBeTruthy();
    expect(doneEvent.markdown).toBe(sampleBrief);
    expect(doneEvent.commonalities).toBeUndefined();
  });

  it("commonalities not regenerated during revision", async () => {
    // Generate with 2 CSVs first
    const genRes = await request(app)
      .post("/generate-stream")
      .set("Cookie", authCookie)
      .attach("csv", csvBuffer, "q1.csv")
      .attach("csv", csvBuffer, "q2.csv")
      .field("scope", "Test scope");

    const genEvents = parseSSE(genRes.text);
    const genDone = genEvents.find((e) => e.done);
    expect(mockGenerateCommonalities).toHaveBeenCalledTimes(1);

    // Revise
    const revRes = await request(app)
      .post("/revise-stream")
      .set("Cookie", authCookie)
      .send({ sessionId: genDone.sessionId, feedback: "Make it shorter" });

    expect(revRes.status).toBe(200);
    const revEvents = parseSSE(revRes.text);
    const revDone = revEvents.find((e) => e.done);
    expect(revDone).toBeDefined();
    expect(revDone.commonalities).toBeUndefined();
    // Still only 1 call from generation
    expect(mockGenerateCommonalities).toHaveBeenCalledTimes(1);
  });

  it("commonalities called with correct csvTexts array", async () => {
    await request(app)
      .post("/generate-stream")
      .set("Cookie", authCookie)
      .attach("csv", csvBuffer, "q1.csv")
      .attach("csv", csvBuffer, "q2.csv")
      .field("scope", "Test scope");

    expect(mockGenerateCommonalities).toHaveBeenCalledTimes(1);
    const csvTexts = mockGenerateCommonalities.mock.calls[0][0];
    expect(csvTexts).toHaveLength(2);
    expect(csvTexts[0]).toContain("Question");
    expect(csvTexts[1]).toContain("Question");
  });
});
