const fs = require("fs");
const path = require("path");
const { generateBrief } = require("./generate");

const INPUT_DIR = path.join(__dirname, "inputs");
const OUTPUT_DIR = path.join(__dirname, "outputs");

async function main() {
  const inputFiles = fs.readdirSync(INPUT_DIR);
  const csvFile = inputFiles.find((f) => f.endsWith(".csv"));
  const pdfFile = inputFiles.find((f) => f.endsWith(".pdf"));

  if (!csvFile) throw new Error("No .csv file found in inputs/");
  if (!pdfFile) throw new Error("No .pdf file found in inputs/");

  console.log(`CSV: ${csvFile}`);
  console.log(`PDF: ${pdfFile}`);

  const csvText = fs.readFileSync(path.join(INPUT_DIR, csvFile), "utf-8");
  const pdfBuffer = fs.readFileSync(path.join(INPUT_DIR, pdfFile));
  const pdfBase64 = pdfBuffer.toString("base64");

  console.log("Sending to Claude...");
  const { docxBuffer, markdownText } = await generateBrief(csvText, pdfBase64);
  console.log(`Response received (${markdownText.length} chars)`);

  const timestamp = new Date().toISOString().slice(0, 10);
  const docxPath = path.join(OUTPUT_DIR, `creative-brief-${timestamp}.docx`);
  const mdPath = path.join(OUTPUT_DIR, `creative-brief-${timestamp}.md`);
  fs.writeFileSync(docxPath, docxBuffer);
  fs.writeFileSync(mdPath, markdownText);
  console.log(`Brief saved to: ${docxPath}`);
  console.log(`Markdown saved to: ${mdPath}`);
}

main().catch((err) => {
  console.error("Error:", err.message || err);
  process.exit(1);
});
