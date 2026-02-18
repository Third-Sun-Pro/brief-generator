require("dotenv").config();
const express = require("express");
const multer = require("multer");
const path = require("path");
const { generateBrief } = require("./generate");

const app = express();
const upload = multer({ storage: multer.memoryStorage() });

app.use(express.static(path.join(__dirname, "public")));

app.post(
  "/generate",
  upload.fields([
    { name: "csv", maxCount: 1 },
    { name: "pdf", maxCount: 1 },
  ]),
  async (req, res) => {
    try {
      const csvFileObj = req.files && req.files["csv"] && req.files["csv"][0];
      const pdfFileObj = req.files && req.files["pdf"] && req.files["pdf"][0];

      if (!csvFileObj || !pdfFileObj) {
        return res
          .status(400)
          .json({ error: "Both a CSV and PDF file are required." });
      }

      const csvText = csvFileObj.buffer.toString("utf-8");
      const pdfBase64 = pdfFileObj.buffer.toString("base64");

      console.log("Generating brief...");
      const { docxBuffer, markdownText } = await generateBrief(
        csvText,
        pdfBase64
      );
      console.log("Brief generated successfully.");

      res.json({
        docxBase64: docxBuffer.toString("base64"),
        markdown: markdownText,
      });
    } catch (err) {
      console.error("Error:", err.message || err);
      res.status(500).json({ error: err.message || "Something went wrong." });
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
