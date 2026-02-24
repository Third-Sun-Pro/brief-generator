import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";

let tmpDir;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "archive-test-"));
  process.env.ARCHIVE_DIR = tmpDir;
  // Clear the require cache so archive.js picks up the new env
  const archivePath = require.resolve("../archive");
  delete require.cache[archivePath];
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
  delete process.env.ARCHIVE_DIR;
});

function loadArchive() {
  delete require.cache[require.resolve("../archive")];
  return require("../archive");
}

describe("archive.js", () => {
  it("readArchive returns [] when file is missing", () => {
    const { readArchive } = loadArchive();
    expect(readArchive()).toEqual([]);
  });

  it("readArchive returns [] on invalid JSON", () => {
    const { readArchive } = loadArchive();
    fs.writeFileSync(path.join(tmpDir, "archive.json"), "not json{{{");
    expect(readArchive()).toEqual([]);
  });

  it("addEntry creates dir and file, generates id and createdAt", () => {
    const { addEntry, readArchive } = loadArchive();
    const entry = addEntry({
      clientName: "Acme Corp",
      markdown: "# Brief",
      docxBase64: "ZmFrZQ==",
      source: "generate",
    });

    expect(entry.id).toBeDefined();
    expect(entry.createdAt).toBeDefined();
    expect(entry.clientName).toBe("Acme Corp");
    expect(entry.source).toBe("generate");

    const entries = readArchive();
    expect(entries).toHaveLength(1);
    expect(entries[0].id).toBe(entry.id);
  });

  it("addEntry appends multiple entries", () => {
    const { addEntry, readArchive } = loadArchive();
    addEntry({ clientName: "A", markdown: "a", docxBase64: "a", source: "generate" });
    addEntry({ clientName: "B", markdown: "b", docxBase64: "b", source: "revise" });
    addEntry({ clientName: "C", markdown: "c", docxBase64: "c", source: "generate" });

    expect(readArchive()).toHaveLength(3);
  });

  it("listEntries strips markdown and docxBase64", () => {
    const { addEntry, listEntries } = loadArchive();
    addEntry({ clientName: "Acme", markdown: "# Long brief", docxBase64: "bigdata", source: "generate" });

    const list = listEntries();
    expect(list).toHaveLength(1);
    expect(list[0]).toHaveProperty("id");
    expect(list[0]).toHaveProperty("clientName", "Acme");
    expect(list[0]).toHaveProperty("createdAt");
    expect(list[0]).toHaveProperty("source", "generate");
    expect(list[0]).not.toHaveProperty("markdown");
    expect(list[0]).not.toHaveProperty("docxBase64");
  });

  it("getEntry returns full entry by id", () => {
    const { addEntry, getEntry } = loadArchive();
    const entry = addEntry({ clientName: "Test", markdown: "md", docxBase64: "b64", source: "revise" });

    const found = getEntry(entry.id);
    expect(found).not.toBeNull();
    expect(found.id).toBe(entry.id);
    expect(found.markdown).toBe("md");
    expect(found.docxBase64).toBe("b64");
  });

  it("getEntry returns null for unknown id", () => {
    const { getEntry } = loadArchive();
    expect(getEntry("nonexistent-id")).toBeNull();
  });

  it("addEntry caps at 50 entries, dropping oldest", () => {
    const { addEntry, readArchive } = loadArchive();
    for (let i = 0; i < 55; i++) {
      addEntry({ clientName: `Client ${i}`, markdown: "m", docxBase64: "d", source: "generate" });
    }
    const entries = readArchive();
    expect(entries).toHaveLength(50);
    expect(entries[0].clientName).toBe("Client 5");
    expect(entries[49].clientName).toBe("Client 54");
  });
});
