# Brief Generator

AI-powered creative brief & site plan generator for Third Sun Productions, a web design agency in Salt Lake City specializing in nonprofits and small businesses.

## What It Does

Takes client discovery questionnaires (optional CSVs) + project scope → generates professional Creative Brief & Site Plan documents using Claude AI. Supports multi-respondent consensus analysis, decision-maker weighting, revision workflow, and archiving.

## Tech Stack

Node.js + Express 5, Anthropic SDK, vanilla HTML/CSS/JS frontend. Tests with Vitest + Supertest.

## How to Run

```bash
node server.js          # Start server on port 3000
npm test                # Run all tests (8 test files)
npm run test:watch      # Tests in watch mode
npm run test:eval       # Run eval tests only (requires RUN_EVAL=1)
```

## Environment Variables (.env)

- `ANTHROPIC_API_KEY` — required
- `APP_PASSWORD` — required (for web UI login)
- `CLAUDE_MODEL` — optional, defaults to claude-sonnet-4-6
- `ARCHIVE_DIR` — optional, defaults to ./data
- `PORT` — optional, defaults to 3000

## Key Files

- `server.js` — Express app, auth, streaming endpoints, session management
- `generate.js` — Claude integration, brief generation, DOCX conversion, consensus logic
- `system_prompt.md` — Instructions to Claude for generating briefs (includes Joomla platform context)
- `template.md` — Brief structure/boilerplate
- `examples.md` — Few-shot examples for Claude (cached for token efficiency)
- `scrape.js` — Optional website nav scraping
- `archive.js` — JSON-based brief archive (50 entry limit)
- `public/index.html` — Single-page web UI

## Architecture

- Auth: HMAC-SHA256 signed cookies, 24hr expiry
- Rate limiting: 10 req/15min (API), 5 attempts/15min (login)
- Streaming: Server-Sent Events for real-time generation
- Sessions: 30min TTL for revision conversations
- Archive: JSON file in /data, newest 50 entries kept
- File uploads: multer, 20MB per file, max 20 files

## Important Context

- All client sites are built on Joomla CMS — the system prompt includes platform-aware guidance
- Briefs are client-facing documents — no technical jargon in output
- Multi-respondent consensus threshold: 30% agreement minimum
- Decision makers' responses count double
- Deployed to Hostinger, pushed via git

## Git

- Remote: github.com/Third-Sun-Pro/brief-generator (public — required for scheduled remote agents)
- .env is gitignored (was previously tracked, fixed Feb 2026)
