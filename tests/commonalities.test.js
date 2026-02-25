import { describe, it, expect, vi, beforeAll } from "vitest";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { createRequire } from "node:module";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

const commonalitiesMd =
  "## Areas of Agreement\n\n- Both want a modern site\n\n## Areas of Disagreement\n\n- Color preferences differ";

const mockCreate = vi.fn().mockResolvedValue({
  content: [{ text: commonalitiesMd }],
  usage: { input_tokens: 500, output_tokens: 200 },
});

// Patch the CJS require cache so generate.js gets our mock Anthropic SDK
const sdkPath = require.resolve("@anthropic-ai/sdk");
const MockAnthropic = class Anthropic {
  constructor() {
    this.messages = { create: mockCreate, stream: vi.fn() };
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
const { generateCommonalities, isDecisionMaker } = require("../generate");

const fixturesDir = path.join(__dirname, "fixtures");

describe("generateCommonalities", () => {
  const csv1 = fs.readFileSync(path.join(fixturesDir, "sample.csv"), "utf-8");
  const csv2 = fs.readFileSync(path.join(fixturesDir, "sample-dm.csv"), "utf-8");

  beforeAll(() => {
    mockCreate.mockClear();
  });

  it("returns markdown and docxBuffer", async () => {
    const result = await generateCommonalities([csv1, csv2]);
    expect(result).toHaveProperty("markdown");
    expect(result).toHaveProperty("docxBuffer");
    expect(result.markdown).toBe(commonalitiesMd);
  });

  it("docxBuffer is a Buffer", async () => {
    const result = await generateCommonalities([csv1, csv2]);
    expect(Buffer.isBuffer(result.docxBuffer)).toBe(true);
  });

  it("sends correct number of questionnaires in prompt", async () => {
    mockCreate.mockClear();
    await generateCommonalities([csv1, csv2]);
    const call = mockCreate.mock.calls[0][0];
    const userContent = call.messages[0].content;
    expect(userContent).toContain("2 questionnaire responses");
    expect(userContent).toContain("--- Questionnaire 1");
    expect(userContent).toContain("--- Questionnaire 2");
  });

  it("includes decision-maker tags when present", async () => {
    mockCreate.mockClear();
    // sample-dm.csv has a decision maker column with "yes"
    await generateCommonalities([csv1, csv2]);
    const call = mockCreate.mock.calls[0][0];
    const userContent = call.messages[0].content;
    // csv2 (sample-dm.csv) should be tagged as decision maker
    if (isDecisionMaker(csv2)) {
      expect(userContent).toContain("[DECISION MAKER]");
    }
  });

  it("uses max_tokens of 4000", async () => {
    mockCreate.mockClear();
    await generateCommonalities([csv1, csv2]);
    const call = mockCreate.mock.calls[0][0];
    expect(call.max_tokens).toBe(4000);
  });

  it("uses the expected model", async () => {
    mockCreate.mockClear();
    await generateCommonalities([csv1, csv2]);
    const call = mockCreate.mock.calls[0][0];
    expect(call.model).toBe("claude-sonnet-4-6");
  });
});
