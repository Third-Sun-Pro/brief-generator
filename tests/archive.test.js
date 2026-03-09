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
    const { entry, dropped } = addEntry({
      clientName: "Acme Corp",
      markdown: "# Brief",
      docxBase64: "ZmFrZQ==",
      source: "generate",
    });

    expect(entry.id).toBeDefined();
    expect(entry.createdAt).toBeDefined();
    expect(entry.clientName).toBe("Acme Corp");
    expect(entry.source).toBe("generate");
    expect(dropped).toBe(0);

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

    const result = listEntries();
    expect(result.entries).toHaveLength(1);
    expect(result.total).toBe(1);
    expect(result.limit).toBe(100);
    expect(result.entries[0]).toHaveProperty("id");
    expect(result.entries[0]).toHaveProperty("clientName", "Acme");
    expect(result.entries[0]).toHaveProperty("createdAt");
    expect(result.entries[0]).toHaveProperty("source", "generate");
    expect(result.entries[0]).toHaveProperty("pinned", false);
    expect(result.entries[0]).not.toHaveProperty("markdown");
    expect(result.entries[0]).not.toHaveProperty("docxBase64");
  });

  it("getEntry returns full entry by id", () => {
    const { addEntry, getEntry } = loadArchive();
    const { entry } = addEntry({ clientName: "Test", markdown: "md", docxBase64: "b64", source: "revise" });

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

  it("addEntry caps at 100 entries, dropping oldest unpinned", () => {
    const { addEntry, readArchive, togglePin } = loadArchive();
    for (let i = 0; i < 105; i++) {
      addEntry({ clientName: `Client ${i}`, markdown: "m", docxBase64: "d", source: "generate" });
    }
    const entries = readArchive();
    expect(entries).toHaveLength(100);
    expect(entries[0].clientName).toBe("Client 5");
    expect(entries[99].clientName).toBe("Client 104");
  });

  it("pinned entries are protected from FIFO drop", () => {
    const { addEntry, readArchive, togglePin } = loadArchive();
    // Add 100 entries to fill the archive
    for (let i = 0; i < 100; i++) {
      addEntry({ clientName: `Client ${i}`, markdown: "m", docxBase64: "d", source: "generate" });
    }
    // Pin the very first entry
    const entries = readArchive();
    togglePin(entries[0].id);

    // Add 5 more — should drop unpinned entries but keep the pinned one
    for (let i = 100; i < 105; i++) {
      addEntry({ clientName: `Client ${i}`, markdown: "m", docxBase64: "d", source: "generate" });
    }
    const final = readArchive();
    expect(final).toHaveLength(100);
    // Pinned entry should still be there
    expect(final.some(e => e.clientName === "Client 0" && e.pinned)).toBe(true);
    // Oldest unpinned should be gone
    expect(final.some(e => e.clientName === "Client 1")).toBe(false);
  });

  it("togglePin toggles pinned status", () => {
    const { addEntry, readArchive, togglePin } = loadArchive();
    const { entry } = addEntry({ clientName: "Test", markdown: "m", docxBase64: "d", source: "generate" });
    expect(entry.pinned).toBe(false);

    const pinned = togglePin(entry.id);
    expect(pinned).toBe(true);
    expect(readArchive()[0].pinned).toBe(true);

    const unpinned = togglePin(entry.id);
    expect(unpinned).toBe(false);
    expect(readArchive()[0].pinned).toBe(false);
  });

  it("togglePin returns null for unknown id", () => {
    const { togglePin } = loadArchive();
    expect(togglePin("nonexistent")).toBeNull();
  });
});
