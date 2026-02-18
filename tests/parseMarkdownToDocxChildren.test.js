import { describe, it, expect } from "vitest";
import { parseMarkdownToDocxChildren } from "../generate.js";

// Helpers to extract data from docx Paragraph/TextRun internals
function getPPr(paragraph) {
  return paragraph.root.find((r) => r.rootKey === "w:pPr");
}

function getHeadingStyle(paragraph) {
  const pPr = getPPr(paragraph);
  if (!pPr) return undefined;
  const style = pPr.root.find((r) => r.rootKey === "w:pStyle");
  if (!style) return undefined;
  const attr = style.root.find((r) => r.rootKey === "_attr");
  return attr ? attr.root.val : undefined;
}

function hasBorder(paragraph) {
  const pPr = getPPr(paragraph);
  if (!pPr) return false;
  return !!pPr.root.find((r) => r.rootKey === "w:pBdr");
}

function getIndentLeft(paragraph) {
  const pPr = getPPr(paragraph);
  if (!pPr) return undefined;
  const ind = pPr.root.find((r) => r.rootKey === "w:ind");
  if (!ind) return undefined;
  const attr = ind.root.find((r) => r.rootKey === "_attr");
  return attr ? attr.root.left.value : undefined;
}

function getTextRuns(paragraph) {
  return paragraph.root.filter((r) => r.rootKey === "w:r");
}

function getText(run) {
  const wt = run.root.find((r) => r.rootKey === "w:t");
  return wt ? wt.root[wt.root.length - 1] : "";
}

describe("parseMarkdownToDocxChildren", () => {
  it("returns an empty array for empty string", () => {
    const result = parseMarkdownToDocxChildren("");
    expect(result).toEqual([]);
  });

  it("parses # heading as HEADING_1", () => {
    const result = parseMarkdownToDocxChildren("# My Title");
    expect(result).toHaveLength(1);
    expect(getHeadingStyle(result[0])).toBe("Heading1");
  });

  it("parses ## heading as HEADING_2", () => {
    const result = parseMarkdownToDocxChildren("## Section");
    expect(result).toHaveLength(1);
    expect(getHeadingStyle(result[0])).toBe("Heading2");
  });

  it("parses ### heading as HEADING_3", () => {
    const result = parseMarkdownToDocxChildren("### Subsection");
    expect(result).toHaveLength(1);
    expect(getHeadingStyle(result[0])).toBe("Heading3");
  });

  it("parses - bullet as an indented paragraph with dash prefix", () => {
    const result = parseMarkdownToDocxChildren("- item one");
    expect(result).toHaveLength(1);
    const runs = getTextRuns(result[0]);
    expect(getText(runs[0])).toBe("- ");
    expect(getIndentLeft(result[0])).toBeGreaterThan(0);
  });

  it("parses nested bullets with increased indent", () => {
    const md = "- top level\n  - nested";
    const result = parseMarkdownToDocxChildren(md);
    expect(result).toHaveLength(2);
    const topIndent = getIndentLeft(result[0]);
    const nestedIndent = getIndentLeft(result[1]);
    expect(nestedIndent).toBeGreaterThan(topIndent);
  });

  it("parses [x] checked checkbox", () => {
    const result = parseMarkdownToDocxChildren("[x] Done");
    expect(result).toHaveLength(1);
    const runs = getTextRuns(result[0]);
    expect(getText(runs[0])).toContain("\u2713");
  });

  it("parses [ ] unchecked checkbox", () => {
    const result = parseMarkdownToDocxChildren("[ ] Pending");
    expect(result).toHaveLength(1);
    const runs = getTextRuns(result[0]);
    expect(getText(runs[0])).toBe("[ ] ");
  });

  it("parses --- horizontal rule as a border paragraph", () => {
    const result = parseMarkdownToDocxChildren("---");
    expect(result).toHaveLength(1);
    expect(hasBorder(result[0])).toBe(true);
  });

  it("parses plain text as a normal paragraph", () => {
    const result = parseMarkdownToDocxChildren("Just some text.");
    expect(result).toHaveLength(1);
    expect(getHeadingStyle(result[0])).toBeUndefined();
    expect(hasBorder(result[0])).toBe(false);
    const runs = getTextRuns(result[0]);
    expect(runs.length).toBeGreaterThan(0);
  });

  it("parses multi-line mixed markdown", () => {
    const md = [
      "# Title",
      "",
      "Some paragraph text.",
      "",
      "- bullet one",
      "- bullet two",
      "",
      "---",
      "",
      "[x] checked item",
    ].join("\n");
    const result = parseMarkdownToDocxChildren(md);
    // Title + paragraph + 2 bullets + hr + checkbox = 6
    expect(result).toHaveLength(6);
    expect(getHeadingStyle(result[0])).toBe("Heading1");
    expect(hasBorder(result[4])).toBe(true);
  });
});
