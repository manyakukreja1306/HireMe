# Orchestrator agent

The Lambda entry point in `aws-pipeline/src/handlers.ts` sequences resume extraction, matching, interview question generation/evaluation, and draft-only outreach. It records progress in DynamoDB and uses a per-application lease plus input hashes to make retries safe.

The orchestrator does not accept or reject candidates. It records `PENDING`, `PROCESSING`, `COMPLETE`, `NEEDS_REVIEW`, or `FAILED` and leaves every hiring decision to a person. The current detailed requirements are in [`documentation/PRD.md`](../../documentation/PRD.md).
