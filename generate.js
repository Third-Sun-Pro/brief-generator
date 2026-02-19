require("dotenv").config();
const fs = require("fs");
const path = require("path");
const Anthropic = require("@anthropic-ai/sdk");
const {
  Document,
  Paragraph,
  TextRun,
  HeadingLevel,
  Packer,
  convertInchesToTwip,
} = require("docx");

const FONT = "Calibri";
const BODY_SIZE = 24;     // 12pt (half-points)
const H1_SIZE = 36;       // 18pt
const H2_SIZE = 28;       // 14pt
const H3_SIZE = 26;       // 13pt

// ---------------------------------------------------------------------------
// Inline formatting parser: handles **bold**, *italic*, ***bold-italic***, URLs
// ---------------------------------------------------------------------------
function parseInlineFormatting(text, size) {
  const sz = size || BODY_SIZE;
  const runs = [];
  const regex =
    /(\*\*\*(.+?)\*\*\*|\*\*(.+?)\*\*|\*(.+?)\*)/g;

  let lastIndex = 0;
  let match;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      runs.push(new TextRun({ text: text.slice(lastIndex, match.index), font: FONT, size: sz, color: "000000" }));
    }

    if (match[2]) {
      runs.push(new TextRun({ text: match[2], bold: true, italics: true, font: FONT, size: sz, color: "000000" }));
    } else if (match[3]) {
      runs.push(new TextRun({ text: match[3], bold: true, font: FONT, size: sz, color: "000000" }));
    } else if (match[4]) {
      runs.push(new TextRun({ text: match[4], italics: true, font: FONT, size: sz, color: "000000" }));
    }

    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) {
    runs.push(new TextRun({ text: text.slice(lastIndex), font: FONT, size: sz, color: "000000" }));
  }

  if (runs.length === 0) {
    runs.push(new TextRun({ text, font: FONT, size: sz, color: "000000" }));
  }

  return runs;
}

// ---------------------------------------------------------------------------
// Markdown-to-DOCX parser: converts each line into Paragraph objects
// ---------------------------------------------------------------------------
function parseMarkdownToDocxChildren(markdown) {
  const lines = markdown.split("\n");
  const children = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (line.trim() === "") continue;

    if (/^[-=_]{3,}\s*$/.test(line.trim())) {
      children.push(
        new Paragraph({
          border: {
            bottom: { style: "single", size: 6, space: 1, color: "999999" },
          },
          spacing: { after: 200 },
        })
      );
      continue;
    }

    const headingMatch = line.match(/^(#{1,3})\s+(.*)/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const sizeMap = { 1: H1_SIZE, 2: H2_SIZE, 3: H3_SIZE };
      const headingMap = {
        1: HeadingLevel.HEADING_1,
        2: HeadingLevel.HEADING_2,
        3: HeadingLevel.HEADING_3,
      };
      children.push(
        new Paragraph({
          heading: headingMap[level],
          children: parseInlineFormatting(headingMatch[2], sizeMap[level]),
          spacing: { before: 240, after: 120 },
        })
      );
      continue;
    }

    const checkboxMatch = line.match(/^\[( |x)\]\s*(.*)/);
    if (checkboxMatch) {
      const checked = checkboxMatch[1] === "x";
      const prefix = checked ? "[\u2713] " : "[ ] ";
      children.push(
        new Paragraph({
          indent: { left: convertInchesToTwip(0.35) },
          children: [
            new TextRun({ text: prefix, font: FONT, size: BODY_SIZE, color: "000000" }),
            ...parseInlineFormatting(checkboxMatch[2]),
          ],
          spacing: { after: 0 },
        })
      );
      continue;
    }

    const bulletMatch = line.match(/^(\s*)[-*]\s+(.*)/);
    if (bulletMatch) {
      const indent = bulletMatch[1].length;
      const level = Math.min(Math.floor(indent / 2), 3);
      const indentInches = 0.35 + level * 0.35;
      children.push(
        new Paragraph({
          indent: { left: convertInchesToTwip(indentInches) },
          children: [
            new TextRun({ text: "- ", font: FONT, size: BODY_SIZE, color: "000000" }),
            ...parseInlineFormatting(bulletMatch[2]),
          ],
          spacing: { after: 0 },
        })
      );
      continue;
    }

    children.push(
      new Paragraph({
        children: parseInlineFormatting(line),
        spacing: { after: 120 },
      })
    );
  }

  return children;
}

// ---------------------------------------------------------------------------
// generateBrief — core logic shared by CLI (run.js) and web (server.js)
// ---------------------------------------------------------------------------
async function generateBrief(csvTexts, pdfBase64s) {
  // Normalize to arrays for backward compatibility
  const csvArr = Array.isArray(csvTexts) ? csvTexts : [csvTexts];
  const pdfArr = Array.isArray(pdfBase64s) ? pdfBase64s : [pdfBase64s];

  const systemPrompt = fs.readFileSync(
    path.join(__dirname, "system_prompt.md"),
    "utf-8"
  );
  const examples = fs.readFileSync(
    path.join(__dirname, "examples.md"),
    "utf-8"
  );

  const client = new Anthropic();

  // Build document blocks for each PDF
  const pdfBlocks = pdfArr.map((data, i) => ({
    type: "document",
    source: {
      type: "base64",
      media_type: "application/pdf",
      data,
    },
    title: pdfArr.length === 1 ? "Project Contract" : `Project Contract ${i + 1}`,
  }));

  // Build a single text block with all CSVs
  const csvBlock = csvArr.length === 1
    ? `Here is the client discovery questionnaire (CSV):\n\n${csvArr[0]}`
    : csvArr.map((csv, i) => `--- Questionnaire ${i + 1} ---\n${csv}`).join("\n\n");

  const csvText = csvArr.length === 1
    ? csvBlock
    : `Here are the client discovery questionnaires (CSVs):\n\n${csvBlock}`;

  const response = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 16000,
    system: systemPrompt,
    messages: [
      {
        role: "user",
        content: [
          ...pdfBlocks,
          {
            type: "text",
            text: csvText,
          },
          {
            type: "text",
            text: `Here are example briefs to follow for tone, structure, and formatting:\n\n${examples}`,
          },
          {
            type: "text",
            text: "Using the contract(s) (PDF) and questionnaire(s) (CSV) provided above, and following the structure and tone of the examples exactly, generate a complete Creative Brief & Site Plan. Be concise — use short, direct sentences. Avoid filler words, redundant phrasing, and overly wordy descriptions. Every sentence should earn its place. Format the output as markdown: use # for the brief title, ## for section headers, ### for subsections, - for bullets, [ ] for checkboxes, and ---------- for section dividers.",
          },
        ],
      },
    ],
  });

  const markdownText = response.content[0].text;

  const docChildren = parseMarkdownToDocxChildren(markdownText);

  const doc = new Document({
    creator: "Third Sun Productions",
    title: "Creative Brief",
    description: "Creative Brief & Site Plan",
    sections: [
      {
        properties: {
          page: {
            margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 },
          },
        },
        children: docChildren,
      },
    ],
  });

  const docxBuffer = await Packer.toBuffer(doc);

  return { docxBuffer, markdownText };
}

module.exports = { generateBrief, parseInlineFormatting, parseMarkdownToDocxChildren };
