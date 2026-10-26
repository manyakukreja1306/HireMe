# AWS assessment pipeline

This SAM project defines the AWS decision support pipeline in `ap-south-1`. It uses a private encrypted S3 bucket, DynamoDB, API Gateway HTTP API, and Node.js 22 Lambda functions. Resume extraction runs inside the Resume Agent Lambda with `pdf-parse` and `mammoth`; there is no EC2 service. OCR is not included.

## Current state

The provided ZIP is implementation material, not a deployed application. The AWS account currently has a legacy stack named `hirely-ai-pipeline`; this implementation uses a separate stack named `hirely-pipeline` with `dev` and `prod` stage parameters. Its buckets and tables are retained if the stack is removed. No stack update or deployment has been performed from this repository.

The new Vercel project, Clerk application, and deployment secrets still need configuration. Vercel holds the Clerk and Supabase settings, `PIPELINE_API_URL`, and `PIPELINE_ASSERTION_SECRET`; it must not receive AWS credentials. Lambda receives Gemini and the HMAC secret server-side. Do not commit `.env`, `.env.deploy`, `samconfig.toml` containing secrets, resume data, or credentials.

## Request flow

1. A Vercel API route verifies the Clerk session, obtains the role from Clerk public metadata, and checks application/job ownership in Supabase.
2. The route calls API Gateway with the Clerk JWT and a timestamped HMAC ownership assertion. API Gateway checks the JWT issuer and `hirely-api` audience; the Public API Lambda verifies the assertion and conditional ownership binding.
3. A candidate's resume goes from Vercel to a five-minute S3 presigned URL. S3 is private, encrypted, and expires the objects after 90 days. The Public API checks size and MIME metadata; the Resume Agent checks file signatures after download.
4. The orchestrator runs resume extraction, matching, interview question generation, answer evaluation, and (only when requirements are met) an unsent recruiter draft. Gemini is called only inside Lambda.
5. Candidate reads return safe progress and feedback. Recruiter reads are scoped to the owned job and include evidence and draft-only outreach.

The allowed API routes are `POST /uploads/resume`, `POST /pipeline/{applicationId}/run`, `GET /pipeline/{applicationId}`, `POST /pipeline/{applicationId}/questions`, and `POST /pipeline/{applicationId}/answers`. Every route uses the Clerk JWT authorizer.

## Local checks

Install Node.js 22, AWS SAM CLI, and dependencies. Then run:

```powershell
npm ci
cd aws-pipeline
npm ci
sam validate --lint --template-file template.yaml
sam build --template-file template.yaml
npm test
```

Root app checks are `npm run lint` and `npm run build`. Local tests use mocks; they do not replace the deployed authorization, upload, and end-to-end checks in the PRD.

## Deployment

1. Create the Clerk development application, add `candidate`/`recruiter` roles to public metadata at sign-up, and create the `hirely-api` JWT template with `aud=hirely-api`. Use the exact issuer URL from Clerk.
2. Create a new Vercel project from the new GitHub repository and deploy once to obtain its URL. Add that exact origin to Clerk, `CLERK_AUTHORIZED_PARTIES`, and the AWS `ProductionOrigin` parameter.
3. Configure private deployment variables without committing them: Clerk keys, Supabase URL/key, `PIPELINE_API_URL` after AWS deployment, and a generated 32+ character `PIPELINE_ASSERTION_SECRET` shared with SAM. Configure Gemini only in Lambda/SAM.
4. Build and create a full CloudFormation change set for `hirely-pipeline` in `ap-south-1`. Inspect the entire change set before execution. The stack is separate from the legacy `hirely-ai-pipeline` stack; do not modify or delete the legacy bucket or table as part of this deployment.
5. Configure Vercel with the SAM `PipelineApiUrl` output and redeploy. Verify missing/expired/wrong-audience tokens, ownership boundaries, S3 upload, scanned-PDF review, candidate-safe reads, answer evaluation, and draft-only outreach with synthetic data.
6. Record stack outputs and verified routes in a secret-free verification note.

The required deployment inputs are not stored in this repository. Do not guess the Clerk issuer or Vercel origin. Do not deploy until the exact values exist and the full change set has been reviewed.
