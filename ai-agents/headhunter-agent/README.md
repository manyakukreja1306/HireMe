# ai-agents/headhunter-agent/

**Owner:** Manya

## Purpose
Repurposes the existing AI Headhunter feature as the pipeline's final agent, gated behind the match threshold.

- **Input:** candidate profile (high-match candidates only)
- **Output:** outreach message draft, written to DynamoDB

## Planned contents
- `handler.js` (or `.py`) — Lambda entry point
- `prompt.md` — Gemini prompt template for outreach drafting
- `schema.json` — output JSON schema

## Status
Not yet implemented.
