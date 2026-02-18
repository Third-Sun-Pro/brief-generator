import { describe, it, expect, vi, beforeAll } from "vitest";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { createRequire } from "node:module";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

const sampleBrief = fs.readFileSync(
  path.join(__dirname, "fixtures", "sample-brief.md"),
  "utf-8"
);

const mockCreate = vi.fn().mockResolvedValue({
  content: [{ text: sampleBrief }],
});

// Patch the CJS require cache so generate.js gets our mock Anthropic SDK
const sdkPath = require.resolve("@anthropic-ai/sdk");
const MockAnthropic = class Anthropic {
  constructor() {
    this.messages = { create: mockCreate };
  }
};
MockAnthropic.default = MockAnthropic;
require.cache[sdkPath] = {
  id: sdkPath,
  filename: sdkPath,
  loaded: true,
  exports: MockAnthropic,
};

// Now require generate.js — it will get our mocked SDK
// Clear generate.js from cache first to ensure fresh load with mock
const generatePath = require.resolve("../generate");
delete require.cache[generatePath];
const { generateBrief } = require("../generate");

const fixturesDir = path.join(__dirname, "fixtures");

describe("generateBrief", () => {
  it("returns docxBuffer and markdownText", async () => {
    const csvText = fs.readFileSync(
      path.join(fixturesDir, "sample.csv"),
      "utf-8"
    );
    const pdfBase64 = fs.readFileSync(
      path.join(fixturesDir, "sample.pdf.base64"),
      "utf-8"
    );

    const result = await generateBrief(csvText, pdfBase64);

    expect(result).toHaveProperty("docxBuffer");
    expect(result).toHaveProperty("markdownText");
  });

  it("docxBuffer is a Buffer", async () => {
    const csvText = fs.readFileSync(
      path.join(fixturesDir, "sample.csv"),
      "utf-8"
    );
    const pdfBase64 = fs.readFileSync(
      path.join(fixturesDir, "sample.pdf.base64"),
      "utf-8"
    );

    const { docxBuffer } = await generateBrief(csvText, pdfBase64);

    expect(Buffer.isBuffer(docxBuffer)).toBe(true);
    expect(docxBuffer.length).toBeGreaterThan(0);
  });

  it("markdownText matches the mock response", async () => {
    const csvText = fs.readFileSync(
      path.join(fixturesDir, "sample.csv"),
      "utf-8"
    );
    const pdfBase64 = fs.readFileSync(
      path.join(fixturesDir, "sample.pdf.base64"),
      "utf-8"
    );

    const { markdownText } = await generateBrief(csvText, pdfBase64);

    expect(markdownText).toBe(sampleBrief);
  });
});
