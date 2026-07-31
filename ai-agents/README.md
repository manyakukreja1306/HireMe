# ai-agents/

Multi-agent AI pipeline for HireMe.

**Owner:** Manya

## Purpose
Contains every AI agent in the decision-support pipeline, each implemented as an independent AWS Lambda function, plus the Orchestrator that sequences them, branches on the match-score threshold, and aggregates the final recommendation. See `documentation/PRD.md` §5.3 and §6 for the full pipeline design.

## Sub-folders
| Folder | Agent | Input → Output |
|---|---|---|
| `resume-agent/` | Resume Agent | Uploaded resume → structured skills/experience JSON |
| `matching-agent/` | Matching Agent | Resume JSON + job description → match score % + gap list |
| `interview-agent/` | Interview Agent | Resume JSON + JD + gaps → tailored questions + answer scores |
| `headhunter-agent/` | Headhunter Agent | High-match candidate profile → outreach message draft |
| `orchestrator/` | Orchestrator | All agent outputs → aggregated recommendation + rationale |

## Shared conventions (planned)
- Every agent calls the Google Gemini API for its reasoning step (see PRD §6).
- Every agent reads/writes DynamoDB via the shared data-access layer in `backend/`.
- Input/output contracts for each agent will be documented in each sub-folder's README as they're finalized.

## Status
Scaffolding only — implementation begins in a later phase (see `documentation/PRD.md`, Milestones 1–3, 5).
