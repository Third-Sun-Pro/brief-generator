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
// CSV validation: basic structure check before sending to API
// ---------------------------------------------------------------------------
function validateCsv(csvText, label) {
  const prefix = label ? `${label}: ` : "";

  if (!csvText || !csvText.trim()) {
    throw new Error(`${prefix}CSV file is empty.`);
  }

  const lines = csvText.trim().split(/\r?\n/).filter((l) => l.trim() !== "");

  if (!lines[0].includes(",")) {
    throw new Error(`${prefix}File does not appear to be a valid CSV (no commas found).`);
  }

  if (lines.length < 2) {
    throw new Error(`${prefix}CSV has no data rows (only a header was found).`);
  }
}

// ---------------------------------------------------------------------------
// Detect whether a CSV respondent is a decision maker
// ---------------------------------------------------------------------------
const DECISION_MAKER_PATTERN = /decision\s*maker/i;
const DECISION_MAKER_YES = /^yes$/i;

function isDecisionMaker(csvText) {
  const lines = csvText.trim().split(/\r?\n/);
  if (lines.length < 2) return false;

  // Try column-based CSV (header row with multiple columns)
  const header = lines[0];
  if (header.includes(",")) {
    // Simple CSV field split (handles quoted fields)
    const splitRow = (row) => {
      const fields = [];
      let current = "";
      let inQuotes = false;
      for (const ch of row) {
        if (ch === '"') { inQuotes = !inQuotes; continue; }
        if (ch === "," && !inQuotes) { fields.push(current.trim()); current = ""; continue; }
        current += ch;
      }
      fields.push(current.trim());
      return fields;
    };

    const headers = splitRow(header);
    const colIdx = headers.findIndex((h) => DECISION_MAKER_PATTERN.test(h));
    if (colIdx === -1) return false;

    // Check first data row
    const values = splitRow(lines[1]);
    return DECISION_MAKER_YES.test(values[colIdx] || "");
  }

  return false;
}

// ---------------------------------------------------------------------------
// Shared: build the API request params from inputs
// ---------------------------------------------------------------------------
function buildRequestParams(csvTexts, scopeText, noteFiles, siteContext) {
  const csvArr = Array.isArray(csvTexts) ? csvTexts.filter(Boolean) : csvTexts ? [csvTexts] : [];
  const notes = Array.isArray(noteFiles) ? noteFiles : [];

  csvArr.forEach((csv, i) => {
    const label = csvArr.length > 1 ? `CSV ${i + 1}` : null;
    validateCsv(csv, label);
  });

  const systemPrompt = fs.readFileSync(
    path.join(__dirname, "system_prompt.md"),
    "utf-8"
  );
  const examples = fs.readFileSync(
    path.join(__dirname, "examples.md"),
    "utf-8"
  );

  const noteBlocks = notes.map((note) => {
    if (note.text) {
      return { type: "text", text: `${note.title}:\n\n${note.text}` };
    }
    return {
      type: "document",
      source: { type: "base64", media_type: note.mediaType, data: note.data },
      title: note.title,
    };
  });

  // Static examples go first (with cache_control) so the prefix is cacheable.
  // This avoids re-processing ~7,700 tokens of examples on every request.
  const contentBlocks = [
    {
      type: "text",
      text: `Here are example briefs to follow for tone, structure, and formatting:\n\n${examples}`,
      cache_control: { type: "ephemeral" },
    },
    { type: "text", text: `PROJECT SCOPE:\n\n${scopeText}` },
    ...noteBlocks,
  ];

  if (csvArr.length > 0) {
    // Detect decision makers for multi-respondent weighting
    const dmFlags = csvArr.map((csv) => isDecisionMaker(csv));

    const csvBlock = csvArr.length === 1
      ? `Here is the client discovery questionnaire (CSV):\n\n${csvArr[0]}`
      : csvArr.map((csv, i) => {
          const tag = dmFlags[i] ? " [DECISION MAKER]" : "";
          return `--- Questionnaire ${i + 1}${tag} ---\n${csv}`;
        }).join("\n\n");

    const csvText = csvArr.length === 1
      ? csvBlock
      : `Here are the client discovery questionnaires (CSVs):\n\n${csvBlock}`;

    contentBlocks.push({ type: "text", text: csvText });
  }

  if (siteContext) {
    contentBlocks.push({ type: "text", text: siteContext });
  }

  const sourceList = [
    "the project scope",
    csvArr.length > 0 ? "questionnaire(s) (CSV)" : null,
    notes.length > 0 ? "supporting documents" : null,
  ].filter(Boolean).join(", ");

  let finalInstruction = `Using ${sourceList} provided above, and following the structure and tone of the examples exactly, generate a complete Creative Brief & Site Plan. Be concise — synthesize responses into patterns and themes rather than restating every answer. Use short, direct sentences. Bullet points should be one line each. Cut filler words and redundant phrasing. Match the length and density of the examples, not longer. Format the output as markdown: use # for the brief title, ## for section headers, ### for subsections, - for bullets, [ ] for checkboxes, and ---------- for section dividers.${csvArr.length === 0 ? " Since no questionnaire was provided, use [NEEDS CLARIFICATION] for any audience, personality, or concern details you cannot infer from the scope alone." : ""}`;

  if (csvArr.length > 1) {
    const respondentCount = csvArr.length;
    const dmFlags = csvArr.map((csv) => isDecisionMaker(csv));
    const dmCount = dmFlags.filter(Boolean).length;
    const minRespondents = Math.max(1, Math.ceil(respondentCount * 0.3));
    finalInstruction += `\n\nIMPORTANT — Consensus threshold: There are ${respondentCount} respondents. Only include ideas, preferences, or details in the brief if they are mentioned by at least ${minRespondents} respondent${minRespondents === 1 ? "" : "s"} (30% of ${respondentCount}). Drop any point that fails to meet this threshold.`;
    if (dmCount > 0) {
      finalInstruction += ` Decision maker responses (marked [DECISION MAKER]) count double toward this threshold — treat each decision maker's response as 2 votes. When preferences conflict, favor decision makers' preferences.`;
    }
  }

  contentBlocks.push({ type: "text", text: finalInstruction });

  return {
    model: process.env.CLAUDE_MODEL || "claude-sonnet-4-6",
    max_tokens: 16000,
    system: [
      {
        type: "text",
        text: systemPrompt,
        cache_control: { type: "ephemeral" },
      },
    ],
    messages: [
      {
        role: "user",
        content: contentBlocks,
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// Extract client name from the brief's title line
// ---------------------------------------------------------------------------
function extractClientName(markdown) {
  const match = markdown.match(/^#\s+.+[\u2014—-]\s*(.+)/m);
  if (match) return match[1].trim();
  const openingMatch = markdown.match(/creative plan for\s+(.+?)\./i);
  if (openingMatch) return openingMatch[1].trim();
  return null;
}

// ---------------------------------------------------------------------------
// Build a DOCX buffer from markdown text
// ---------------------------------------------------------------------------
async function buildDocx(markdownText) {
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
  return Packer.toBuffer(doc);
}

// ---------------------------------------------------------------------------
// generateBrief — blocking, used by CLI (run.js) and tests
// ---------------------------------------------------------------------------
function logUsage(label, usage, durationMs) {
  if (!usage) return;
  const cache = usage.cache_read_input_tokens || 0;
  const cacheCreated = usage.cache_creation_input_tokens || 0;
  console.log(
    `[${label}] ${durationMs}ms | in=${usage.input_tokens} out=${usage.output_tokens} cache_read=${cache} cache_write=${cacheCreated}`
  );
}

async function generateBrief(csvTexts, scopeText, noteFiles, siteContext) {
  const client = new Anthropic({ maxRetries: 5 });
  const params = buildRequestParams(csvTexts, scopeText, noteFiles, siteContext);
  const start = Date.now();
  const response = await client.messages.create(params);
  logUsage("generate", response.usage, Date.now() - start);
  const markdownText = response.content[0].text;
  const clientName = extractClientName(markdownText);
  const docxBuffer = await buildDocx(markdownText);
  return { docxBuffer, markdownText, clientName };
}

// ---------------------------------------------------------------------------
// generateBriefStream — streaming, used by web server SSE endpoint
// ---------------------------------------------------------------------------
async function generateBriefStream(csvTexts, scopeText, noteFiles, siteContext, onChunk) {
  const client = new Anthropic({ maxRetries: 5 });
  const params = buildRequestParams(csvTexts, scopeText, noteFiles, siteContext);
  const start = Date.now();
  const stream = client.messages.stream(params);

  stream.on("text", (delta) => {
    onChunk(delta);
  });

  const finalMessage = await stream.finalMessage();
  logUsage("generate-stream", finalMessage.usage, Date.now() - start);
  const markdownText = finalMessage.content[0].text;
  const clientName = extractClientName(markdownText);
  const docxBuffer = await buildDocx(markdownText);
  return { docxBuffer, markdownText, clientName, params };
}

// ---------------------------------------------------------------------------
// Build revision params: appends assistant + feedback turns to original params
// ---------------------------------------------------------------------------
function buildRevisionParams(originalParams, assistantMarkdown, feedback) {
  return {
    model: originalParams.model,
    max_tokens: originalParams.max_tokens,
    system: originalParams.system,
    messages: [
      ...originalParams.messages,
      { role: "assistant", content: assistantMarkdown },
      { role: "user", content: feedback },
    ],
  };
}

// ---------------------------------------------------------------------------
// reviseBriefStream — streaming revision using multi-turn conversation
// ---------------------------------------------------------------------------
async function reviseBriefStream(originalParams, assistantMarkdown, feedback, onChunk) {
  const client = new Anthropic({ maxRetries: 5 });
  const params = buildRevisionParams(originalParams, assistantMarkdown, feedback);
  const start = Date.now();
  const stream = client.messages.stream(params);

  stream.on("text", (delta) => {
    onChunk(delta);
  });

  const finalMessage = await stream.finalMessage();
  logUsage("revise-stream", finalMessage.usage, Date.now() - start);
  const markdownText = finalMessage.content[0].text;
  const clientName = extractClientName(markdownText);
  const docxBuffer = await buildDocx(markdownText);
  return { docxBuffer, markdownText, clientName };
}

// ---------------------------------------------------------------------------
// generateCommonalities — analyse multiple questionnaires for agreement/disagreement
// ---------------------------------------------------------------------------
async function generateCommonalities(csvTexts) {
  const client = new Anthropic({ maxRetries: 5 });
  const dmFlags = csvTexts.map((csv) => isDecisionMaker(csv));

  const csvBlock = csvTexts
    .map((csv, i) => {
      const tag = dmFlags[i] ? " [DECISION MAKER]" : "";
      return `--- Questionnaire ${i + 1}${tag} ---\n${csv}`;
    })
    .join("\n\n");

  const start = Date.now();
  const response = await client.messages.create({
    model: process.env.CLAUDE_MODEL || "claude-sonnet-4-6",
    max_tokens: 4000,
    system:
      "You are an analyst comparing multiple client questionnaire responses for a web design project. Produce a clear, concise summary of where respondents agree and disagree.",
    messages: [
      {
        role: "user",
        content:
          `Below are ${csvTexts.length} questionnaire responses from different stakeholders for the same project. Analyze them and produce a commonalities document with these sections:\n\n` +
          `## Areas of Agreement\nList topics, preferences, goals, and priorities where respondents broadly align. Group related agreements together. Quote or paraphrase specific shared language where helpful.\n\n` +
          `## Areas of Disagreement\nList topics where respondents gave conflicting or notably different answers. For each, briefly note each respondent's position.\n\n` +
          `## Notable Unique Perspectives\nIf any single respondent raised an important point that no one else mentioned (but that seems valuable rather than just an outlier), note it here.\n\n` +
          `Be concise. Use bullets. Do not restate the raw data — synthesize and summarize. Format output as markdown.\n\n${csvBlock}`,
      },
    ],
  });

  logUsage("commonalities", response.usage, Date.now() - start);
  const markdown = response.content[0].text;
  const docxBuffer = await buildDocx(markdown);
  return { markdown, docxBuffer };
}

module.exports = { generateBrief, generateBriefStream, reviseBriefStream, generateCommonalities, buildRequestParams, buildRevisionParams, extractClientName, validateCsv, isDecisionMaker, parseInlineFormatting, parseMarkdownToDocxChildren, buildDocx };
