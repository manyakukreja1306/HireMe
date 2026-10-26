# ai-agents/resume-agent/

**Owner:** Manya

## Purpose
Repurposes the existing ATS Resume Checker feature into the first agent in the pipeline.

- **Input:** uploaded resume (from S3)
- **Output:** structured skills/experience JSON, written to DynamoDB

## Planned contents
- `handler.js` (or `.py`) — Lambda entry point
- `prompt.md` — Gemini prompt template for extraction
- `schema.json` — output JSON schema

## Status
Not yet implemented.
