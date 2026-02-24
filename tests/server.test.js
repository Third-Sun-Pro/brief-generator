import { describe, it, expect, vi, beforeAll } from "vitest";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { createRequire } from "node:module";
import request from "supertest";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

// Set env vars before loading server
process.env.APP_PASSWORD = "test-password";
process.env.NODE_ENV = "test";

const mockGenerateBrief = vi.fn().mockResolvedValue({
  docxBuffer: Buffer.from("fake-docx-content"),
  markdownText: "# Mock Brief\n\nThis is a mock brief.",
});

// Patch the CJS require cache so server.js gets our mock generateBrief
const generatePath = require.resolve("../generate");
require.cache[generatePath] = {
  id: generatePath,
  filename: generatePath,
  loaded: true,
  exports: {
    generateBrief: mockGenerateBrief,
    parseInlineFormatting: () => [],
    parseMarkdownToDocxChildren: () => [],
  },
};

// Mock scrape.js so server.js doesn't need cheerio
const scrapePath = require.resolve("../scrape");
require.cache[scrapePath] = {
  id: scrapePath,
  filename: scrapePath,
  loaded: true,
  exports: { scrapeNavigation: vi.fn().mockResolvedValue(null) },
};

// Clear server.js from cache and load with mocked generate
const serverPath = require.resolve("../server");
delete require.cache[serverPath];
const app = require("../server");

const fixturesDir = path.join(__dirname, "fixtures");

async function getAuthCookie(appInstance) {
  const res = await request(appInstance)
    .post("/login")
    .send({ password: "test-password" });
  const setCookie = res.headers["set-cookie"];
  return setCookie[0].split(";")[0];
}

describe("POST /generate", () => {
  let csvBuffer;
  let pdfBuffer;
  let authCookie;

  beforeAll(async () => {
    csvBuffer = fs.readFileSync(path.join(fixturesDir, "sample.csv"));
    const pdfBase64 = fs.readFileSync(
      path.join(fixturesDir, "sample.pdf.base64"),
      "utf-8"
    );
    pdfBuffer = Buffer.from(pdfBase64, "base64");
    authCookie = await getAuthCookie(app);
  });

  it("returns 200 with docxBase64 and markdown when both files provided", async () => {
    const res = await request(app)
      .post("/generate")
      .set("Cookie", authCookie)
      .attach("csv", csvBuffer, "test.csv")
      .attach("pdf", pdfBuffer, "test.pdf");

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("docxBase64");
    expect(res.body).toHaveProperty("markdown");
    expect(typeof res.body.docxBase64).toBe("string");
    expect(typeof res.body.markdown).toBe("string");
  });

  it("returns 400 when CSV is missing", async () => {
    const res = await request(app)
      .post("/generate")
      .set("Cookie", authCookie)
      .attach("pdf", pdfBuffer, "test.pdf");

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error");
  });

  it("returns 400 when PDF is missing", async () => {
    const res = await request(app)
      .post("/generate")
      .set("Cookie", authCookie)
      .attach("csv", csvBuffer, "test.csv");

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error");
  });

  it("returns 400 when both files are missing", async () => {
    const res = await request(app)
      .post("/generate")
      .set("Cookie", authCookie);

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error");
  });

  it("returns 200 with multiple CSVs and PDFs", async () => {
    const res = await request(app)
      .post("/generate")
      .set("Cookie", authCookie)
      .attach("csv", csvBuffer, "test1.csv")
      .attach("csv", csvBuffer, "test2.csv")
      .attach("pdf", pdfBuffer, "test1.pdf")
      .attach("pdf", pdfBuffer, "test2.pdf");

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("docxBase64");
    expect(res.body).toHaveProperty("markdown");

    // Verify generateBrief was called with arrays
    const lastCall = mockGenerateBrief.mock.calls[mockGenerateBrief.mock.calls.length - 1];
    expect(lastCall[0]).toHaveLength(2); // 2 CSVs
    expect(lastCall[1]).toHaveLength(2); // 2 PDFs
  });
});

describe("Authentication", () => {
  let csvBuffer;
  let pdfBuffer;

  beforeAll(() => {
    csvBuffer = fs.readFileSync(path.join(fixturesDir, "sample.csv"));
    const pdfBase64 = fs.readFileSync(
      path.join(fixturesDir, "sample.pdf.base64"),
      "utf-8"
    );
    pdfBuffer = Buffer.from(pdfBase64, "base64");
  });

  it("returns 401 on /generate without auth cookie", async () => {
    const res = await request(app)
      .post("/generate")
      .attach("csv", csvBuffer, "test.csv")
      .attach("pdf", pdfBuffer, "test.pdf");

    expect(res.status).toBe(401);
    expect(res.body).toHaveProperty("error");
  });

  it("returns 200 on /login with correct password and sets cookie", async () => {
    const res = await request(app)
      .post("/login")
      .send({ password: "test-password" });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true });
    expect(res.headers["set-cookie"]).toBeDefined();
    expect(res.headers["set-cookie"][0]).toMatch(/auth_token=/);
  });

  it("returns 401 on /login with wrong password", async () => {
    const res = await request(app)
      .post("/login")
      .send({ password: "wrong-password" });

    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/invalid/i);
  });

  it("GET /auth-check returns true with valid cookie", async () => {
    const authCookie = await getAuthCookie(app);
    const res = await request(app)
      .get("/auth-check")
      .set("Cookie", authCookie);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ authenticated: true });
  });

  it("GET /auth-check returns false without cookie", async () => {
    const res = await request(app).get("/auth-check");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ authenticated: false });
  });
});

describe("File size limits", () => {
  let authCookie;

  beforeAll(async () => {
    authCookie = await getAuthCookie(app);
  });

  it("returns 413 when a file exceeds 20 MB", async () => {
    const oversizedBuffer = Buffer.alloc(21 * 1024 * 1024, "x");
    const res = await request(app)
      .post("/generate")
      .set("Cookie", authCookie)
      .attach("csv", Buffer.from("a,b\n1,2"), "test.csv")
      .attach("pdf", oversizedBuffer, "huge.pdf");

    expect(res.status).toBe(413);
    expect(res.body.error).toMatch(/too large/i);
  });
});
