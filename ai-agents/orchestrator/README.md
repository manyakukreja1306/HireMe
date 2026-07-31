# ai-agents/orchestrator/

**Owner:** Manya

## Purpose
The coordinating Lambda function for the whole pipeline. Invokes the four agents directly via the AWS SDK (no managed workflow service — see PRD §6), branches on the Matching Agent's score, and aggregates all stage outputs into one final recommendation record.

- **Input:** all agent outputs (read from / written to DynamoDB as the pipeline progresses)
- **Output:** one final recommendation record — match score, interview score, and natural-language rationale — written to DynamoDB and read by the recruiter dashboard

## Planned contents
- `handler.js` (or `.py`) — Lambda entry point, sequencing + branching logic
- `aggregate.js` — final recommendation / rationale generation (Gemini call)

## Status
Not yet implemented.
