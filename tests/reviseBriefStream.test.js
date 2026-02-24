import { describe, it, expect, vi } from "vitest";
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

const revisedBrief = "# Revised Brief — Acme Corp\n\n## Project Overview\n\nRevised content here.";

let capturedParams = null;

const mockStream = {
  on: vi.fn((event, cb) => {
    if (event === "text") cb("revised chunk");
  }),
  finalMessage: vi.fn().mockResolvedValue({
    content: [{ text: revisedBrief }],
  }),
};

const mockStreamFn = vi.fn().mockReturnValue(mockStream);

// Patch the CJS require cache so generate.js gets our mock Anthropic SDK
const sdkPath = require.resolve("@anthropic-ai/sdk");
const MockAnthropic = class Anthropic {
  constructor() {
    this.messages = {
      create: vi.fn().mockResolvedValue({ content: [{ text: sampleBrief }] }),
      stream: (...args) => {
        capturedParams = args[0];
        return mockStreamFn(...args);
      },
    };
  }
};
MockAnthropic.default = MockAnthropic;
require.cache[sdkPath] = {
  id: sdkPath,
  filename: sdkPath,
  loaded: true,
  exports: MockAnthropic,
};

// Clear generate.js from cache and load with mock
const generatePath = require.resolve("../generate");
delete require.cache[generatePath];
const { generateBriefStream, reviseBriefStream, buildRevisionParams } = require("../generate");

const fixturesDir = path.join(__dirname, "fixtures");

describe("buildRevisionParams", () => {
  it("produces correct 3-turn message structure", () => {
    const originalParams = {
      model: "claude-sonnet-4-6",
      max_tokens: 16000,
      system: "You are a strategist.",
      messages: [
        { role: "user", content: [{ type: "text", text: "original request" }] },
      ],
    };

    const result = buildRevisionParams(originalParams, "assistant response", "make it shorter");

    expect(result.model).toBe("claude-sonnet-4-6");
    expect(result.max_tokens).toBe(16000);
    expect(result.system).toBe("You are a strategist.");
    expect(result.messages).toHaveLength(3);
    expect(result.messages[0]).toEqual(originalParams.messages[0]);
    expect(result.messages[1]).toEqual({ role: "assistant", content: "assistant response" });
    expect(result.messages[2]).toEqual({ role: "user", content: "make it shorter" });
  });

  it("does not mutate the original params", () => {
    const originalParams = {
      model: "claude-sonnet-4-6",
      max_tokens: 16000,
      system: "system",
      messages: [{ role: "user", content: "hello" }],
    };
    const originalLength = originalParams.messages.length;

    buildRevisionParams(originalParams, "response", "feedback");

    expect(originalParams.messages).toHaveLength(originalLength);
  });
});

describe("reviseBriefStream", () => {
  it("returns docxBuffer, markdownText, and clientName", async () => {
    const originalParams = {
      model: "claude-sonnet-4-6",
      max_tokens: 16000,
      system: "system",
      messages: [{ role: "user", content: "original" }],
    };

    const onChunk = vi.fn();
    const result = await reviseBriefStream(originalParams, sampleBrief, "make it shorter", onChunk);

    expect(result).toHaveProperty("docxBuffer");
    expect(result).toHaveProperty("markdownText");
    expect(result).toHaveProperty("clientName");
    expect(Buffer.isBuffer(result.docxBuffer)).toBe(true);
    expect(result.markdownText).toBe(revisedBrief);
  });

  it("calls onChunk during streaming", async () => {
    const originalParams = {
      model: "claude-sonnet-4-6",
      max_tokens: 16000,
      system: "system",
      messages: [{ role: "user", content: "original" }],
    };

    const onChunk = vi.fn();
    await reviseBriefStream(originalParams, sampleBrief, "make it shorter", onChunk);

    expect(onChunk).toHaveBeenCalledWith("revised chunk");
  });

  it("sends feedback as the last user message to the API", async () => {
    const originalParams = {
      model: "claude-sonnet-4-6",
      max_tokens: 16000,
      system: "system",
      messages: [{ role: "user", content: "original" }],
    };

    capturedParams = null;
    await reviseBriefStream(originalParams, sampleBrief, "be more formal", vi.fn());

    expect(capturedParams).not.toBeNull();
    const messages = capturedParams.messages;
    expect(messages[messages.length - 1]).toEqual({ role: "user", content: "be more formal" });
    expect(messages[messages.length - 2]).toEqual({ role: "assistant", content: sampleBrief });
  });
});

describe("generateBriefStream", () => {
  it("returns params alongside other fields", async () => {
    const csvText = fs.readFileSync(path.join(fixturesDir, "sample.csv"), "utf-8");

    // Override stream mock for this test to return sampleBrief
    mockStream.finalMessage.mockResolvedValueOnce({ content: [{ text: sampleBrief }] });

    const result = await generateBriefStream(csvText, "Test project scope", [], null, vi.fn());

    expect(result).toHaveProperty("params");
    expect(result.params).toHaveProperty("model");
    expect(result.params).toHaveProperty("messages");
    expect(result.params).toHaveProperty("system");
  });
});
