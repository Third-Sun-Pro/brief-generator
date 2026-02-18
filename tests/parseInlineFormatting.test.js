import { describe, it, expect } from "vitest";
import { parseInlineFormatting } from "../generate.js";

// Helpers to extract data from docx TextRun internals
function getText(run) {
  const wt = run.root.find((r) => r.rootKey === "w:t");
  return wt ? wt.root[wt.root.length - 1] : "";
}

function isBold(run) {
  return !!run.properties.root.find((r) => r.rootKey === "w:b");
}

function isItalic(run) {
  return !!run.properties.root.find((r) => r.rootKey === "w:i");
}

function getSize(run) {
  const sz = run.properties.root.find((r) => r.rootKey === "w:sz");
  return sz ? sz.root[0].root.val : undefined;
}

describe("parseInlineFormatting", () => {
  it("returns a single TextRun for plain text", () => {
    const runs = parseInlineFormatting("hello world");
    expect(runs).toHaveLength(1);
    expect(getText(runs[0])).toBe("hello world");
    expect(isBold(runs[0])).toBe(false);
    expect(isItalic(runs[0])).toBe(false);
  });

  it("parses **bold** text", () => {
    const runs = parseInlineFormatting("**bold**");
    expect(runs).toHaveLength(1);
    expect(getText(runs[0])).toBe("bold");
    expect(isBold(runs[0])).toBe(true);
  });

  it("parses *italic* text", () => {
    const runs = parseInlineFormatting("*italic*");
    expect(runs).toHaveLength(1);
    expect(getText(runs[0])).toBe("italic");
    expect(isItalic(runs[0])).toBe(true);
  });

  it("parses ***bold-italic*** text", () => {
    const runs = parseInlineFormatting("***both***");
    expect(runs).toHaveLength(1);
    expect(getText(runs[0])).toBe("both");
    expect(isBold(runs[0])).toBe(true);
    expect(isItalic(runs[0])).toBe(true);
  });

  it("parses mixed inline formatting", () => {
    const runs = parseInlineFormatting("hello **world** and *stuff*");
    expect(runs).toHaveLength(4);
    expect(getText(runs[0])).toBe("hello ");
    expect(getText(runs[1])).toBe("world");
    expect(isBold(runs[1])).toBe(true);
    expect(getText(runs[2])).toBe(" and ");
    expect(getText(runs[3])).toBe("stuff");
    expect(isItalic(runs[3])).toBe(true);
  });

  it("returns a single TextRun for empty string", () => {
    const runs = parseInlineFormatting("");
    expect(runs).toHaveLength(1);
    expect(getText(runs[0])).toBe("");
  });

  it("respects a custom size parameter", () => {
    const runs = parseInlineFormatting("text", 36);
    expect(runs).toHaveLength(1);
    expect(getSize(runs[0])).toBe(36);
  });
});
