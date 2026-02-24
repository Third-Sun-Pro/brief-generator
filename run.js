const fs = require("fs");
const path = require("path");
const { generateBrief } = require("./generate");

const INPUT_DIR = path.join(__dirname, "inputs");
const OUTPUT_DIR = path.join(__dirname, "outputs");

const NOTE_MEDIA_TYPES = {
  ".pdf": "application/pdf",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
};

async function main() {
  const inputFiles = fs.readdirSync(INPUT_DIR);
  const csvFiles = inputFiles.filter((f) => f.endsWith(".csv"));
  const scopeFile = inputFiles.find((f) => f === "scope.txt") || inputFiles.find((f) => f.endsWith(".txt"));
  const noteExts = [".pdf", ".docx", ".md"];
  const noteFileNames = inputFiles.filter((f) => {
    const ext = path.extname(f).toLowerCase();
    return noteExts.includes(ext) || (ext === ".txt" && f !== (scopeFile || ""));
  });

  if (!csvFiles.length) throw new Error("No .csv file found in inputs/");
  if (!scopeFile) throw new Error("No scope.txt file found in inputs/");

  csvFiles.forEach((f) => console.log(`CSV: ${f}`));
  console.log(`Scope: ${scopeFile}`);
  noteFileNames.forEach((f) => console.log(`Note: ${f}`));

  const csvTexts = csvFiles.map((f) =>
    fs.readFileSync(path.join(INPUT_DIR, f), "utf-8")
  );
  const scopeText = fs.readFileSync(path.join(INPUT_DIR, scopeFile), "utf-8");
  const noteFiles = noteFileNames.map((f, i) => {
    const ext = path.extname(f).toLowerCase();
    const title = noteFileNames.length === 1 ? "Supporting Document" : `Supporting Document ${i + 1}`;
    if (ext === ".txt" || ext === ".md") {
      return { text: fs.readFileSync(path.join(INPUT_DIR, f), "utf-8"), title };
    }
    const mediaType = NOTE_MEDIA_TYPES[ext];
    return { data: fs.readFileSync(path.join(INPUT_DIR, f)).toString("base64"), mediaType, title };
  });

  console.log("Sending to Claude...");
  const { docxBuffer, markdownText, clientName } = await generateBrief(csvTexts, scopeText, noteFiles);
  console.log(`Response received (${markdownText.length} chars)`);

  const timestamp = new Date().toISOString().slice(0, 10);
  const slug = clientName
    ? clientName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "")
    : null;
  const baseName = slug ? `creative-brief-${slug}-${timestamp}` : `creative-brief-${timestamp}`;
  const docxPath = path.join(OUTPUT_DIR, `${baseName}.docx`);
  const mdPath = path.join(OUTPUT_DIR, `${baseName}.md`);
  fs.writeFileSync(docxPath, docxBuffer);
  fs.writeFileSync(mdPath, markdownText);
  console.log(`Brief saved to: ${docxPath}`);
  console.log(`Markdown saved to: ${mdPath}`);
}

main().catch((err) => {
  console.error("Error:", err.message || err);
  process.exit(1);
});
