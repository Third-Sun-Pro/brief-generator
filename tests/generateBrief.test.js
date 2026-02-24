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
const { generateBrief, buildRequestParams } = require("../generate");

const fixturesDir = path.join(__dirname, "fixtures");

describe("generateBrief", () => {
  it("returns docxBuffer and markdownText", async () => {
    const csvText = fs.readFileSync(
      path.join(fixturesDir, "sample.csv"),
      "utf-8"
    );

    const result = await generateBrief(csvText, "Test project scope", []);

    expect(result).toHaveProperty("docxBuffer");
    expect(result).toHaveProperty("markdownText");
  });

  it("docxBuffer is a Buffer", async () => {
    const csvText = fs.readFileSync(
      path.join(fixturesDir, "sample.csv"),
      "utf-8"
    );

    const { docxBuffer } = await generateBrief(csvText, "Test project scope", []);

    expect(Buffer.isBuffer(docxBuffer)).toBe(true);
    expect(docxBuffer.length).toBeGreaterThan(0);
  });

  it("markdownText matches the mock response", async () => {
    const csvText = fs.readFileSync(
      path.join(fixturesDir, "sample.csv"),
      "utf-8"
    );

    const { markdownText } = await generateBrief(csvText, "Test scope", []);

    expect(markdownText).toBe(sampleBrief);
  });

  it("includes scope text and note document blocks in API call", async () => {
    const csvText = fs.readFileSync(
      path.join(fixturesDir, "sample.csv"),
      "utf-8"
    );
    const noteFiles = [
      { data: "ZmFrZQ==", mediaType: "application/pdf", title: "Supporting Document 1" },
      { text: "Some notes text", title: "Supporting Document 2" },
    ];

    await generateBrief(csvText, "Build a 10-page website", noteFiles);

    const lastCall = mockCreate.mock.calls[mockCreate.mock.calls.length - 1][0];
    const textBlocks = lastCall.messages[0].content.filter((c) => c.type === "text");
    const docBlocks = lastCall.messages[0].content.filter((c) => c.type === "document");

    // Should have scope text block
    const scopeBlock = textBlocks.find((b) => b.text.includes("PROJECT SCOPE"));
    expect(scopeBlock).toBeDefined();
    expect(scopeBlock.text).toContain("Build a 10-page website");

    // Should have one PDF document block
    expect(docBlocks).toHaveLength(1);

    // Should have text note block
    const noteBlock = textBlocks.find((b) => b.text.includes("Some notes text"));
    expect(noteBlock).toBeDefined();
  });

  it("multi-CSV includes consensus threshold instruction", () => {
    const csvText = fs.readFileSync(
      path.join(fixturesDir, "sample.csv"),
      "utf-8"
    );

    const params = buildRequestParams(
      [csvText, csvText, csvText, csvText],
      "Test scope",
      []
    );

    const textBlocks = params.messages[0].content.filter(
      (c) => c.type === "text"
    );
    const finalText = textBlocks[textBlocks.length - 1].text;

    expect(finalText).toContain("4 respondents");
    expect(finalText).toContain("at least 2 respondents");
    expect(finalText).toContain("Consensus threshold");
  });

  it("single CSV excludes consensus threshold instruction", () => {
    const csvText = fs.readFileSync(
      path.join(fixturesDir, "sample.csv"),
      "utf-8"
    );

    const params = buildRequestParams([csvText], "Test scope", []);

    const textBlocks = params.messages[0].content.filter(
      (c) => c.type === "text"
    );
    const finalText = textBlocks[textBlocks.length - 1].text;

    expect(finalText).not.toContain("Consensus threshold");
  });
});
