import { describe, it, expect, vi, beforeAll } from "vitest";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { createRequire } from "node:module";
import request from "supertest";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

const mockGenerateBrief = vi.fn().mockResolvedValue({
  docxBuffer: Buffer.from("fake-docx-content"),
  markdownText: "# Mock Brief\n\nThis is a mock brief.",
});

// Patch the CJS require cache so server.js gets our mock generateBrief
const generatePath = require.resolve("../generate");
require.cache[generatePath] = {
  id: generatePath,
  filename: generatePath,
  loaded: true,
  exports: {
    generateBrief: mockGenerateBrief,
    parseInlineFormatting: () => [],
    parseMarkdownToDocxChildren: () => [],
  },
};

// Clear server.js from cache and load with mocked generate
const serverPath = require.resolve("../server");
delete require.cache[serverPath];
const app = require("../server");

const fixturesDir = path.join(__dirname, "fixtures");

describe("POST /generate", () => {
  let csvBuffer;
  let pdfBuffer;

  beforeAll(() => {
    csvBuffer = fs.readFileSync(path.join(fixturesDir, "sample.csv"));
    const pdfBase64 = fs.readFileSync(
      path.join(fixturesDir, "sample.pdf.base64"),
      "utf-8"
    );
    pdfBuffer = Buffer.from(pdfBase64, "base64");
  });

  it("returns 200 with docxBase64 and markdown when both files provided", async () => {
    const res = await request(app)
      .post("/generate")
      .attach("csv", csvBuffer, "test.csv")
      .attach("pdf", pdfBuffer, "test.pdf");

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("docxBase64");
    expect(res.body).toHaveProperty("markdown");
    expect(typeof res.body.docxBase64).toBe("string");
    expect(typeof res.body.markdown).toBe("string");
  });

  it("returns 400 when CSV is missing", async () => {
    const res = await request(app)
      .post("/generate")
      .attach("pdf", pdfBuffer, "test.pdf");

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error");
  });

  it("returns 400 when PDF is missing", async () => {
    const res = await request(app)
      .post("/generate")
      .attach("csv", csvBuffer, "test.csv");

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error");
  });

  it("returns 400 when both files are missing", async () => {
    const res = await request(app).post("/generate");

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error");
  });

  it("returns 200 with multiple CSVs and PDFs", async () => {
    const res = await request(app)
      .post("/generate")
      .attach("csv", csvBuffer, "test1.csv")
      .attach("csv", csvBuffer, "test2.csv")
      .attach("pdf", pdfBuffer, "test1.pdf")
      .attach("pdf", pdfBuffer, "test2.pdf");

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("docxBase64");
    expect(res.body).toHaveProperty("markdown");

    // Verify generateBrief was called with arrays
    const lastCall = mockGenerateBrief.mock.calls[mockGenerateBrief.mock.calls.length - 1];
    expect(lastCall[0]).toHaveLength(2); // 2 CSVs
    expect(lastCall[1]).toHaveLength(2); // 2 PDFs
  });
});
