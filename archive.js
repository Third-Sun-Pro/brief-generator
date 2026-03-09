const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const DATA_DIR = process.env.ARCHIVE_DIR || path.join(__dirname, "data");
const ARCHIVE_PATH = path.join(DATA_DIR, "archive.json");

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function readArchive() {
  try {
    const data = fs.readFileSync(ARCHIVE_PATH, "utf-8");
    return JSON.parse(data);
  } catch {
    return [];
  }
}

function writeArchive(entries) {
  ensureDataDir();
  fs.writeFileSync(ARCHIVE_PATH, JSON.stringify(entries, null, 2));
}

const MAX_ENTRIES = 100;

function addEntry({ clientName, markdown, docxBase64, source }) {
  let entries = readArchive();
  const entry = {
    id: crypto.randomUUID(),
    clientName,
    markdown,
    docxBase64,
    source,
    pinned: false,
    createdAt: new Date().toISOString(),
  };
  entries.push(entry);
  let dropped = 0;
  if (entries.length > MAX_ENTRIES) {
    // Only drop unpinned entries, oldest first
    const unpinned = entries.filter(e => !e.pinned);
    const toDrop = entries.length - MAX_ENTRIES;
    if (unpinned.length >= toDrop) {
      const dropIds = new Set(unpinned.slice(0, toDrop).map(e => e.id));
      entries = entries.filter(e => !dropIds.has(e.id));
      dropped = toDrop;
    }
  }
  writeArchive(entries);
  return { entry, dropped };
}

function listEntries() {
  const entries = readArchive();
  return {
    entries: entries.map(({ id, clientName, createdAt, source, pinned }) => ({
      id,
      clientName,
      createdAt,
      source,
      pinned: !!pinned,
    })),
    total: entries.length,
    limit: MAX_ENTRIES,
  };
}

function getEntry(id) {
  return readArchive().find((e) => e.id === id) || null;
}

function deleteEntry(id) {
  const entries = readArchive();
  const idx = entries.findIndex((e) => e.id === id);
  if (idx === -1) return false;
  entries.splice(idx, 1);
  writeArchive(entries);
  return true;
}

function togglePin(id) {
  const entries = readArchive();
  const entry = entries.find((e) => e.id === id);
  if (!entry) return null;
  entry.pinned = !entry.pinned;
  writeArchive(entries);
  return entry.pinned;
}

module.exports = { readArchive, writeArchive, addEntry, listEntries, getEntry, deleteEntry, togglePin };
