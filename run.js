const fs = require("fs");
const path = require("path");
const { generateBrief } = require("./generate");

const INPUT_DIR = path.join(__dirname, "inputs");
const OUTPUT_DIR = path.join(__dirname, "outputs");

async function main() {
  const inputFiles = fs.readdirSync(INPUT_DIR);
  const csvFiles = inputFiles.filter((f) => f.endsWith(".csv"));
  const pdfFiles = inputFiles.filter((f) => f.endsWith(".pdf"));

  if (!csvFiles.length) throw new Error("No .csv file found in inputs/");
  if (!pdfFiles.length) throw new Error("No .pdf file found in inputs/");

  csvFiles.forEach((f) => console.log(`CSV: ${f}`));
  pdfFiles.forEach((f) => console.log(`PDF: ${f}`));

  const csvTexts = csvFiles.map((f) =>
    fs.readFileSync(path.join(INPUT_DIR, f), "utf-8")
  );
  const pdfBase64s = pdfFiles.map((f) =>
    fs.readFileSync(path.join(INPUT_DIR, f)).toString("base64")
  );

  console.log("Sending to Claude...");
  const { docxBuffer, markdownText } = await generateBrief(csvTexts, pdfBase64s);
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
