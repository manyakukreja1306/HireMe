# backend/

Node.js / Express API layer for HireMe.

**Owner:** Nishtha

## Purpose
Bridges the frontend and the AWS layer: handles resume/JD uploads to S3, reads/writes candidate and application records in DynamoDB, integrates the Adzuna and SerpApi job-search APIs, and exposes the endpoints the frontend calls (directly, or via Lambda function URLs — see `documentation/PRD.md` §6).

## Planned contents
- `routes/` — Express route handlers
- `services/s3.js` — resume/JD upload & retrieval
- `services/dynamodb.js` — data-access layer for the single-table schema in `database/`
- `middleware/auth.js` — lightweight token check / third-party auth integration

## Status
Scaffolding only — implementation begins in a later phase.
