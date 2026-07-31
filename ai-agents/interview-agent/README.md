# ai-agents/interview-agent/

**Owner:** Manya

## Purpose
Repurposes the existing AI Voice Interview feature, now conditioned on upstream pipeline context rather than the job description alone.

- **Input:** Resume JSON + job description + gap list (from Matching Agent)
- **Output:** tailored interview questions + answer scores, written to DynamoDB

Only runs for candidates who clear the Matching Agent's threshold.

## Planned contents
- `handler.js` (or `.py`) — Lambda entry point
- `prompt.md` — Gemini prompt template for question generation & scoring
- `schema.json` — output JSON schema

## Status
Not yet implemented.
