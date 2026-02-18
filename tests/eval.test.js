import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const RUN_EVAL = process.env.RUN_EVAL === "1";

describe.skipIf(!RUN_EVAL)("LLM eval — brief quality", () => {
  it("sample brief has all required sections", () => {
    const brief = fs.readFileSync(
      path.join(__dirname, "fixtures", "sample-brief.md"),
      "utf-8"
    );

    const requiredSections = [
      "Project Overview",
      "Goals",
      "Target Audience",
      "Scope of Work",
      "Timeline",
    ];

    for (const section of requiredSections) {
      expect(brief).toContain(section);
    }
  });

  it("sample brief contains the client name", () => {
    const brief = fs.readFileSync(
      path.join(__dirname, "fixtures", "sample-brief.md"),
      "utf-8"
    );

    expect(brief).toContain("Acme Corp");
  });

  it("sample brief has no orphaned TBD placeholders", () => {
    const brief = fs.readFileSync(
      path.join(__dirname, "fixtures", "sample-brief.md"),
      "utf-8"
    );

    expect(brief).not.toMatch(/\bTBD\b/i);
  });

  it("Claude rates the brief quality above threshold", async () => {
    const Anthropic = (await import("@anthropic-ai/sdk")).default;
    const client = new Anthropic();

    const brief = fs.readFileSync(
      path.join(__dirname, "fixtures", "sample-brief.md"),
      "utf-8"
    );

    const response = await client.messages.create({
      model: "claude-sonnet-4-5-20250929",
      max_tokens: 1024,
      messages: [
        {
          role: "user",
          content: `You are evaluating the quality of a creative brief for a web design project. Rate it on a scale of 1-10 based on these criteria:
- Completeness: Does it cover project goals, audience, scope, timeline, and deliverables?
- Clarity: Is the writing clear and concise?
- Structure: Is it well-organized with clear sections?
- Actionability: Could a design team start working from this brief?

Here is the brief:

${brief}

Respond with ONLY a JSON object in this exact format: {"score": <number>, "reason": "<one sentence>"}`,
        },
      ],
    });

    const text = response.content[0].text;
    const parsed = JSON.parse(text);

    expect(parsed.score).toBeGreaterThanOrEqual(6);
  }, 30000);
});
