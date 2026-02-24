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

const MAX_ENTRIES = 50;

function addEntry({ clientName, markdown, docxBase64, source }) {
  let entries = readArchive();
  const entry = {
    id: crypto.randomUUID(),
    clientName,
    markdown,
    docxBase64,
    source,
    createdAt: new Date().toISOString(),
  };
  entries.push(entry);
  if (entries.length > MAX_ENTRIES) {
    entries = entries.slice(entries.length - MAX_ENTRIES);
  }
  writeArchive(entries);
  return entry;
}

function listEntries() {
  return readArchive().map(({ id, clientName, createdAt, source }) => ({
    id,
    clientName,
    createdAt,
    source,
  }));
}

function getEntry(id) {
  return readArchive().find((e) => e.id === id) || null;
}

module.exports = { readArchive, writeArchive, addEntry, listEntries, getEntry };
