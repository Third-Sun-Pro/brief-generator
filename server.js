require("dotenv").config();
const express = require("express");
const multer = require("multer");
const path = require("path");
const { generateBrief, generateBriefStream } = require("./generate");

const app = express();
const upload = multer({ storage: multer.memoryStorage() });

app.use(express.static(path.join(__dirname, "public")));

app.post(
  "/generate",
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

      console.log(`Generating brief from ${csvFiles.length} CSV(s) and ${pdfFiles.length} PDF(s)...`);
      const { docxBuffer, markdownText, clientName } = await generateBrief(
        csvTexts,
        pdfBase64s
      );
      console.log("Brief generated successfully.");

      res.json({
        docxBase64: docxBuffer.toString("base64"),
        markdown: markdownText,
        clientName: clientName || null,
      });
    } catch (err) {
      console.error("Error:", err.message || err);
      res.status(500).json({ error: err.message || "Something went wrong." });
    }
  }
);

app.post(
  "/generate-stream",
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

      console.log(`Streaming brief from ${csvFiles.length} CSV(s) and ${pdfFiles.length} PDF(s)...`);

      const { docxBuffer, markdownText, clientName } = await generateBriefStream(
        csvTexts,
        pdfBase64s,
        (delta) => {
          res.write(`data: ${JSON.stringify({ text: delta })}\n\n`);
        }
      );

      console.log("Brief generated successfully.");

      res.write(`data: ${JSON.stringify({
        done: true,
        docxBase64: docxBuffer.toString("base64"),
        markdown: markdownText,
        clientName: clientName || null,
      })}\n\n`);
      res.end();
    } catch (err) {
      console.error("Error:", err.message || err);
      res.write(`data: ${JSON.stringify({ error: err.message || "Something went wrong." })}\n\n`);
      res.end();
    }
  }
);

module.exports = app;

if (require.main === module) {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
  });
}
