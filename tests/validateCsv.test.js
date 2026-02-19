import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { validateCsv } = require("../generate");

describe("validateCsv", () => {
  it("accepts a valid CSV with header and data rows", () => {
    const csv = "name,email,phone\nAlice,alice@example.com,555-1234\nBob,bob@example.com,555-5678";
    expect(() => validateCsv(csv)).not.toThrow();
  });

  it("accepts a CSV with just one data row", () => {
    const csv = "question,answer\nWhat is your name?,Alice";
    expect(() => validateCsv(csv)).not.toThrow();
  });

  it("throws on empty string", () => {
    expect(() => validateCsv("")).toThrow("CSV file is empty");
  });

  it("throws on whitespace-only string", () => {
    expect(() => validateCsv("   \n  \n  ")).toThrow("CSV file is empty");
  });

  it("throws on header-only CSV (no data rows)", () => {
    const csv = "name,email,phone";
    expect(() => validateCsv(csv)).toThrow("CSV has no data rows");
  });

  it("throws when file has no commas (not a CSV)", () => {
    const notCsv = "This is just a plain text file\nwith multiple lines\nbut no commas";
    expect(() => validateCsv(notCsv)).toThrow("does not appear to be a valid CSV");
  });

  it("throws on binary garbage", () => {
    const garbage = "\x00\x01\x02\x03\x04\x05\x06\x07";
    expect(() => validateCsv(garbage)).toThrow("does not appear to be a valid CSV");
  });

  it("includes label prefix when provided", () => {
    expect(() => validateCsv("", "CSV 1")).toThrow("CSV 1: CSV file is empty");
  });

  it("works without label", () => {
    expect(() => validateCsv("")).toThrow("CSV file is empty");
    // Should not have a prefix
    try {
      validateCsv("");
    } catch (e) {
      expect(e.message).not.toMatch(/^CSV \d/);
    }
  });

  it("handles Windows-style line endings (CRLF)", () => {
    const csv = "name,email\r\nAlice,alice@example.com\r\n";
    expect(() => validateCsv(csv)).not.toThrow();
  });
});
