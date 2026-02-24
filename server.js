require("dotenv").config();
const express = require("express");
const multer = require("multer");
const crypto = require("crypto");
const path = require("path");
const cookieParser = require("cookie-parser");
const rateLimit = require("express-rate-limit");
const { generateBrief, generateBriefStream, reviseBriefStream } = require("./generate");
const { scrapeNavigation } = require("./scrape");

const app = express();
const upload = multer({ storage: multer.memoryStorage() });

const APP_PASSWORD = process.env.APP_PASSWORD || "";
const AUTH_SECRET = APP_PASSWORD; // used as HMAC key

// ---------------------------------------------------------------------------
// Auth token helpers — HMAC-SHA256 signed cookies
// ---------------------------------------------------------------------------
function createAuthToken() {
  const timestamp = Date.now().toString();
  const hmac = crypto.createHmac("sha256", AUTH_SECRET).update(timestamp).digest("hex");
  return `${timestamp}.${hmac}`;
}

function verifyAuthToken(token) {
  if (!token || !AUTH_SECRET) return false;
  const parts = token.split(".");
  if (parts.length !== 2) return false;
  const [timestamp, signature] = parts;
  const expected = crypto.createHmac("sha256", AUTH_SECRET).update(timestamp).digest("hex");
  if (expected.length !== signature.length) return false;
  const valid = crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
  if (!valid) return false;
  // 24-hour expiry
  const age = Date.now() - parseInt(timestamp, 10);
  return age < 24 * 60 * 60 * 1000;
}

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------
function requireAuth(req, res, next) {
  const token = req.cookies && req.cookies.auth_token;
  if (!verifyAuthToken(token)) {
    return res.status(401).json({ error: "Authentication required." });
  }
  next();
}

const isTest = process.env.NODE_ENV === "test";

const apiLimiter = isTest
  ? (_req, _res, next) => next()
  : rateLimit({
      windowMs: 15 * 60 * 1000,
      max: 10,
      standardHeaders: true,
      legacyHeaders: false,
      message: { error: "Too many requests. Please try again later." },
    });

const loginLimiter = isTest
  ? (_req, _res, next) => next()
  : rateLimit({
      windowMs: 15 * 60 * 1000,
      max: 5,
      standardHeaders: true,
      legacyHeaders: false,
      message: { error: "Too many login attempts. Please try again later." },
    });

app.use(cookieParser());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// ---------------------------------------------------------------------------
// Auth endpoints
// ---------------------------------------------------------------------------
app.post("/login", loginLimiter, (req, res) => {
  const { password } = req.body;
  if (password !== APP_PASSWORD) {
    return res.status(401).json({ error: "Invalid password." });
  }
  const token = createAuthToken();
  res.cookie("auth_token", token, {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    maxAge: 24 * 60 * 60 * 1000,
  });
  res.json({ success: true });
});

app.get("/auth-check", (req, res) => {
  const token = req.cookies && req.cookies.auth_token;
  res.json({ authenticated: verifyAuthToken(token) });
});

app.post("/logout", (_req, res) => {
  res.clearCookie("auth_token");
  res.json({ success: true });
});

// ---------------------------------------------------------------------------
// In-memory session store for revision mode
// ---------------------------------------------------------------------------
const sessions = new Map();
const SESSION_TTL = 30 * 60 * 1000; // 30 minutes

function createSession(params, markdown) {
  const id = crypto.randomUUID();
  sessions.set(id, { params, markdown, createdAt: Date.now() });
  return id;
}

function getSession(id) {
  const session = sessions.get(id);
  if (!session) return null;
  if (Date.now() - session.createdAt > SESSION_TTL) {
    sessions.delete(id);
    return null;
  }
  session.createdAt = Date.now();
  return session;
}

const cleanupInterval = setInterval(() => {
  const now = Date.now();
  for (const [id, session] of sessions) {
    if (now - session.createdAt > SESSION_TTL) {
      sessions.delete(id);
    }
  }
}, 5 * 60 * 1000);
cleanupInterval.unref();

app.post(
  "/generate",
  requireAuth,
  apiLimiter,
  upload.fields([
    { name: "csv", maxCount: 10 },
    { name: "pdf", maxCount: 10 },
  ]),
  async (req, res) => {
    try {
      const csvFiles = req.files && req.files["csv"];
      const pdfFiles = req.files && req.files["pdf"];

      if (!csvFiles || !csvFiles.length || !pdfFiles || !pdfFiles.length) {
        return res
          .status(400)
          .json({ error: "At least one CSV and one PDF file are required." });
      }

      const csvTexts = csvFiles.map((f) => f.buffer.toString("utf-8"));
      const pdfBase64s = pdfFiles.map((f) => f.buffer.toString("base64"));

      let siteContext = null;
      const siteUrl = req.body.siteUrl;
      if (siteUrl && siteUrl.trim()) {
        try {
          console.log(`Scraping navigation from ${siteUrl}...`);
          siteContext = await scrapeNavigation(siteUrl.trim());
          console.log("Site navigation scraped successfully.");
        } catch (err) {
          console.warn("Site scraping failed (continuing without):", err.message);
        }
      }

      console.log(`Generating brief from ${csvFiles.length} CSV(s) and ${pdfFiles.length} PDF(s)...`);
      const { docxBuffer, markdownText, clientName } = await generateBrief(
        csvTexts,
        pdfBase64s,
        siteContext
      );
      console.log("Brief generated successfully.");

      res.json({
        docxBase64: docxBuffer.toString("base64"),
        markdown: markdownText,
        clientName: clientName || null,
      });
    } catch (err) {
      console.error("Error:", err.message || err);
      res.status(500).json({ error: cleanErrorMessage(err) });
    }
  }
);

app.post(
  "/generate-stream",
  requireAuth,
  apiLimiter,
  upload.fields([
    { name: "csv", maxCount: 10 },
    { name: "pdf", maxCount: 10 },
  ]),
  async (req, res) => {
    const csvFiles = req.files && req.files["csv"];
    const pdfFiles = req.files && req.files["pdf"];

    if (!csvFiles || !csvFiles.length || !pdfFiles || !pdfFiles.length) {
      return res
        .status(400)
        .json({ error: "At least one CSV and one PDF file are required." });
    }

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");

    try {
      const csvTexts = csvFiles.map((f) => f.buffer.toString("utf-8"));
      const pdfBase64s = pdfFiles.map((f) => f.buffer.toString("base64"));

      let siteContext = null;
      const siteUrl = req.body.siteUrl;
      if (siteUrl && siteUrl.trim()) {
        try {
          console.log(`Scraping navigation from ${siteUrl}...`);
          siteContext = await scrapeNavigation(siteUrl.trim());
          console.log("Site navigation scraped successfully.");
        } catch (err) {
          console.warn("Site scraping failed (continuing without):", err.message);
        }
      }

      console.log(`Streaming brief from ${csvFiles.length} CSV(s) and ${pdfFiles.length} PDF(s)...`);

      const { docxBuffer, markdownText, clientName, params } = await generateBriefStream(
        csvTexts,
        pdfBase64s,
        siteContext,
        (delta) => {
          res.write(`data: ${JSON.stringify({ text: delta })}\n\n`);
        }
      );

      console.log("Brief generated successfully.");

      const sessionId = createSession(params, markdownText);

      res.write(`data: ${JSON.stringify({
        done: true,
        docxBase64: docxBuffer.toString("base64"),
        markdown: markdownText,
        clientName: clientName || null,
        sessionId,
      })}\n\n`);
      res.end();
    } catch (err) {
      console.error("Error:", err.message || err);
      res.write(`data: ${JSON.stringify({ error: cleanErrorMessage(err) })}\n\n`);
      res.end();
    }
  }
);

app.post("/revise-stream", requireAuth, apiLimiter, async (req, res) => {
  const { sessionId, feedback } = req.body;

  if (!sessionId || !feedback || !feedback.trim()) {
    return res
      .status(400)
      .json({ error: "sessionId and feedback are required." });
  }

  const session = getSession(sessionId);
  if (!session) {
    return res
      .status(404)
      .json({ error: "Session not found or expired. Please generate a new brief." });
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  try {
    console.log(`Revising brief for session ${sessionId}...`);

    const { docxBuffer, markdownText, clientName } = await reviseBriefStream(
      session.params,
      session.markdown,
      feedback.trim(),
      (delta) => {
        res.write(`data: ${JSON.stringify({ text: delta })}\n\n`);
      }
    );

    session.markdown = markdownText;
    session.createdAt = Date.now();

    console.log("Brief revised successfully.");

    res.write(`data: ${JSON.stringify({
      done: true,
      docxBase64: docxBuffer.toString("base64"),
      markdown: markdownText,
      clientName: clientName || null,
      sessionId,
    })}\n\n`);
    res.end();
  } catch (err) {
    console.error("Revision error:", err.message || err);
    res.write(`data: ${JSON.stringify({ error: cleanErrorMessage(err) })}\n\n`);
    res.end();
  }
});

function cleanErrorMessage(err) {
  if (err.status === 429) return "Rate limit reached. Please wait a minute and try again.";
  if (err.status === 401) return "API key is missing or invalid. Check your .env file.";
  if (err.status === 400) return "The request was too large. Try with fewer or smaller files.";
  if (err.status >= 500) return "The AI service is temporarily unavailable. Please try again.";
  return err.message || "Something went wrong.";
}

module.exports = app;
module.exports.sessions = sessions;

if (require.main === module) {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
  });
}
