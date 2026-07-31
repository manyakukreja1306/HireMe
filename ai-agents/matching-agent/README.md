# ai-agents/matching-agent/

**Owner:** Manya

## Purpose
New, lightweight agent that scores a candidate against a job description.

- **Input:** Resume Agent's structured JSON + job description
- **Output:** numeric match score (%) + list of specific gaps, written to DynamoDB

This agent's output is the branch point for the Orchestrator: below the configured threshold, the pipeline stops before the Interview and Headhunter agents run (see PRD §5.3, §8).

## Planned contents
- `handler.js` (or `.py`) — Lambda entry point
- `prompt.md` — Gemini prompt template for scoring/gap analysis
- `schema.json` — output JSON schema

## Status
Not yet implemented.
