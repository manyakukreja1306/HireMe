# AI agents

The AWS pipeline agents are implemented in `aws-pipeline/src/agents.ts` and orchestrated by `aws-pipeline/src/handlers.ts`. Each agent runs in its own Lambda function and uses the existing Gemini provider from the server-side `@google/genai` SDK. The orchestrator validates job criteria and agent outputs, saves stages to DynamoDB, and requires a human recruiter to review all results.

The subdirectories here are project design notes. They are not separate deployed implementations; use the SAM template and source under `aws-pipeline/` as the runnable pipeline.
