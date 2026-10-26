# Hirely — Product Requirements Document (End Product)

*Version 1.0 · 26 October 2026 · Target: AWS (ap-south-1) + Vercel + Clerk*

## 0. Notes from reviewing the repo

These decisions are locked for this PRD. They replace the earlier assumptions drawn from the old repo and handoff:

- **New repository, new Vercel project.** The old repo and both old Vercel URLs are not used anywhere. The new Vercel URL is written `<NEW_VERCEL_URL>` and is filled in after the first deploy.
- **AWS is the primary backend.** DynamoDB holds all pipeline data, plus a small ownership record for every application the pipeline touches. The pipeline never calls Supabase.
- **Supabase is optional and limited.** It stays only for existing portal data (users, jobs, applications) that the current app already reads. If you move that data to DynamoDB later, Supabase can be dropped. MongoDB is not used.
- **No EC2.** Resume text extraction runs in Lambda (section 6.3). The stack is S3, Lambda, DynamoDB and API Gateway, plus CloudWatch and IAM.
- **Nothing from the new architecture is deployed yet.** This PRD describes the finished product, not the current state.

## 1. Product summary

Hirely is a job portal for candidates and recruiters, extended with an AWS-hosted hiring decision-support pipeline. A candidate uploads a resume for a job application. Serverless agents parse it, match it against the job's criteria with cited evidence, and run an interview-feedback loop. Recruiters get an explainable evidence report and an unsent outreach draft. Candidates get safe, constructive feedback.

**Core principle: the system supports humans; it never decides.** It does not accept or reject, does not invent evidence, and does not send messages on its own.

## 2. Goals and non-goals

### Goals

- Keep every existing Hirely screen, route and workflow working.
- Let candidates upload a resume and follow assessment progress live.
- Give recruiters per-criterion evidence with citations from the resume.
- Run the whole pipeline on S3, Lambda, DynamoDB and API Gateway.
- Keep AWS and Gemini credentials server-side only.
- Enforce ownership so a user only ever sees their own applications or jobs.

### Non-goals

- Amazon Bedrock (cost).
- Automated accept/reject decisions.
- Auto-sending recruiter emails or messages.
- OCR for scanned resumes (v1 flags them for human review instead).
- Replacing Supabase, job search, mock interviews or the existing assistant.

## 3. Users and workflows

### 3.1 Candidate

1. Signs in with Clerk and opens an application they own.
2. Uploads a PDF, DOCX or TXT resume (max 2 MB).
3. Sees status: *Uploaded → Parsing → Matching → Interview → Complete / Needs review*.
4. Answers generated interview questions with real, typed answers.
5. Sees candidate-safe feedback, never recruiter scores or internal notes.

### 3.2 Recruiter

1. Signs in with Clerk and opens a job and application they own.
2. Reviews required and preferred criteria, each marked full / partial / missing with a resume quote.
3. Reviews interview feedback only after the candidate has actually answered.
4. Reviews an outreach draft and, if they choose, sends it outside the system.

## 4. Functional requirements

### 4.1 Authentication and authorization

| ID | Requirement |
| --- | --- |
| AUTH-1 | Users authenticate with Clerk. The browser never calls AWS Lambdas directly. |
| AUTH-2 | Vercel API routes verify the Clerk session and confirm the user owns the application (candidate) or job (recruiter), using Supabase if the portal data lives there, and then write or refresh the ownership record in DynamoDB. |
| AUTH-3 | Vercel forwards the Clerk JWT plus a timestamped HMAC ownership assertion to API Gateway. |
| AUTH-4 | API Gateway validates the JWT against the exact Clerk issuer and the `hirely-api` audience. |
| AUTH-5 | The Public API Lambda verifies the HMAC, checks its subject matches the JWT subject, rejects stale timestamps, and applies conditional DynamoDB ownership checks. |
| AUTH-6 | Candidate responses exclude recruiter-only fields. Recruiter responses are scoped to their own jobs. |

### 4.2 Resume upload (S3)

| ID | Requirement |
| --- | --- |
| UP-1 | Accept only PDF, DOCX, TXT. Reject other MIME types, oversize files (> 2,000,000 bytes) and malformed application IDs. |
| UP-2 | `POST /uploads/resume` returns a short-lived presigned S3 URL bound to the authorized application. |
| UP-3 | Bytes go straight to a private bucket under `resumes/`. Encryption on, public access blocked, 90-day lifecycle expiry. |
| UP-4 | Validate magic bytes server-side after upload, not only the declared MIME type. |
| UP-5 | On upload completion the pipeline can be started for that application only. |

### 4.3 Document processing

| ID | Requirement |
| --- | --- |
| DOC-1 | Extract text from PDF, DOCX and TXT and return basic section hints (experience, education, skills). |
| DOC-2 | If a PDF has little or no extractable text, warn that it appears scanned and set the case to `NEEDS_REVIEW`. No OCR in v1. |
| DOC-3 | Never log resume contents. |

### 4.4 Agent pipeline (Lambda)

The Orchestrator Lambda runs agents in sequence and stores progress and results in DynamoDB.

| Agent | Purpose | Output |
| --- | --- | --- |
| Resume | Structure the parsed resume into skills, experience, education. | Structured profile with source spans. |
| Matching | Score the profile against job criteria. | Per-criterion evidence rating and an overall score or `null`. |
| Interview | Generate questions, then evaluate real candidate answers. | Per-answer scores and candidate-safe feedback. |
| Headhunter | Draft recruiter outreach. | Unsent draft only. |

**Rules**

- **Matching score:** required criteria 70%, preferred 30%. If only one category exists it takes the full weight. Full evidence = 1, partial = 0.5, missing = 0.
- **Threshold:** default 70, configurable.
- **Insufficient data:** if criteria are absent or evidence is thin, the score is `null` and the case is `NEEDS_REVIEW`. Never invent a number.
- **Interview weights:** relevance 40%, specific actions/evidence 30%, outcome/learning 20%, clarity 10%.
- **Completion:** generated questions do not count. Interview is complete only when every saved question has a real answer and a valid evaluation.
- **Headhunter** runs only when the match threshold is met and a valid interview evaluation exists. It produces a draft, never a send.
- **No `NOT_ADVANCED` automated outcome.** Allowed states: `PENDING`, `PROCESSING`, `COMPLETE`, `NEEDS_REVIEW`, `FAILED`.
- **Concurrency:** per-application lease in DynamoDB; output hashes make reruns idempotent.
- **Grounding:** every claim in recruiter output cites a resume excerpt. Claims without a citation are dropped.

### 4.5 API surface (API Gateway HTTP API)

| Method and path | Who | Behaviour |
| --- | --- | --- |
| `POST /uploads/resume` | Candidate | Validate metadata, bind key to application, return presigned URL. |
| `POST /pipeline/{applicationId}/run` | Candidate or recruiter (owner) | Start or resume orchestration. |
| `GET /pipeline/{applicationId}` | Candidate or recruiter (owner) | Return role-appropriate status and results. |
| `POST /pipeline/{applicationId}/answers` | Candidate | Save an interview answer and trigger evaluation. |
| `POST /pipeline/{applicationId}/questions` | Owner | Generate interview questions. |

The exact route list in `aws-pipeline/template.yaml` and `src/handlers.ts` remains the source of truth. Every route requires a valid Clerk JWT.

### 4.6 Frontend

- `PipelineAssessment` component in the existing app: upload, progress, results.
- Candidate view: status, safe feedback, interview Q&A.
- Recruiter view: criteria table with evidence quotes, scores, interview feedback, draft outreach with a clear **Draft — not sent** label.
- Explicit **Needs human review** banner whenever a score is `null` or a PDF looked scanned.
- Loading, empty, error and retry states for every call.

## 5. Data model (DynamoDB)

One on-demand table, keys `PK` / `SK` (existing table is retained, not replaced).

| PK | SK | Contents |
| --- | --- | --- |
| `APP#<applicationId>` | `META` | Owner subject, job ID, status, lease, timestamps. |
| `APP#<applicationId>` | `RESUME#<hash>` | S3 key, extraction summary, warnings. |
| `APP#<applicationId>` | `MATCH#<hash>` | Criteria ratings, evidence quotes, score or null. |
| `APP#<applicationId>` | `QUESTION#<n>` | Question text. |
| `APP#<applicationId>` | `ANSWER#<n>` | Candidate answer, evaluation. |
| `APP#<applicationId>` | `DRAFT#<n>` | Outreach draft, `sent: false`. |

Supabase (optional) remains the source for existing portal records such as users, jobs and applications. DynamoDB stores all pipeline state and an ownership record per application, so the AWS side never needs Supabase access. Consider a TTL attribute so pipeline items expire alongside the 90-day S3 retention.

### 5.1 What lives where

Supabase is the source of truth for the portal. DynamoDB holds everything the AWS pipeline creates. No record is stored in both places, except the job snapshot, which is a deliberate copy.

| Data | Store | Why |
| --- | --- | --- |
| Jobs posted by recruiters | Supabase | Recruiters search, filter and edit them; relational queries fit |
| User profiles and existing application records | Supabase | Already used by the portal screens |
| Resume files | S3 (private bucket) | Binary files, 90-day expiry |
| Pipeline stage and progress per application | DynamoDB | Looked up by application ID; polled by the UI |
| Parsed resume summary | DynamoDB | Pipeline output, tied to one application |
| Job snapshot (title, required and preferred criteria, threshold) | DynamoDB | Copied from Supabase when a run starts, so results stay reproducible if the recruiter later edits the job |
| Match evidence and score | DynamoDB | Pipeline output |
| Interview questions, answers and evaluations | DynamoDB | Pipeline output |
| Outreach drafts (`sent` always false) | DynamoDB | Pipeline output |
| Ownership record (candidate and recruiter user IDs per application) | DynamoDB | Lets the AWS side check access without calling Supabase |
| Run lease and idempotency hashes | DynamoDB | Prevents concurrent or duplicate runs |
| Audit trail (prompt version, input and output hashes) | DynamoDB | Explainability and debugging |
| Per-user daily run counter | DynamoDB | Rate limit that protects Gemini usage |

**Flow at run time:** the Vercel route reads the job and application from Supabase, confirms the caller owns them, then sends the criteria and the ownership assertion to API Gateway. The Lambdas write the snapshot and the ownership record to DynamoDB. After that, the AWS side never contacts Supabase.

**Rules**

- Never copy job posts into DynamoDB for browsing or search. Edits would drift out of sync.
- Never store resume text or pipeline results in Supabase.
- The only link between the two stores is the application ID and the job ID.
- If Supabase is later replaced, only the Vercel routes change; the AWS side is untouched.

## 6. Architecture

### 6.1 Flow

```text
Browser (React/Vite on Vercel)
   -> Vercel API route: Clerk verify + Supabase ownership + HMAC assertion
   -> API Gateway HTTP API (Clerk JWT authorizer)
   -> Public API Lambda
        -> S3 (presigned uploads, private bucket)
        -> DynamoDB (state, leases)
        -> Orchestrator Lambda -> Resume -> Matching -> Interview -> Headhunter
                                  (Gemini called server-side)
```

### 6.2 AWS services

- **S3:** private encrypted resume bucket, `resumes/` prefix, 90-day lifecycle, CORS limited to the production origin.
- **Lambda (Node.js 22):** Public API, Orchestrator, Resume, Matching, Interview, Headhunter.
- **DynamoDB:** on-demand pipeline table.
- **API Gateway v2:** HTTP API with JWT authorizer, throttling and CORS for the production origin only.
- **CloudWatch Logs:** request IDs, status and safe error codes only.
- **IAM:** one least-privilege role per function.

### 6.3 Document extraction decision

The handoff uses an EC2 service with Elastic IP, Certbot and systemd. That adds cost, patching and certificate upkeep, and it is not on your service list.

**Recommended:** run extraction inside a Document Lambda (or inside the Resume agent) using `pdf-parse` and `mammoth`, reading from S3 directly. This removes EC2, EBS, the Elastic IP and TLS renewal, and keeps the stack to the four services you named.

**Fallback:** keep EC2 only if a library you need cannot run in Lambda's size or time limits.

### 6.4 Why serverless fits

Traffic is bursty and low-volume. Lambda, API Gateway and DynamoDB on-demand cost nothing when idle and scale without servers to patch.

## 7. Security and privacy

- No secrets in Git, ZIPs, READMEs or logs. `.env.deploy` stays ignored.
- Gemini key and HMAC secret live in Lambda environment (or SSM Parameter Store / Secrets Manager); Vercel holds only `PIPELINE_API_URL` and the HMAC secret.
- Vercel holds **no** AWS access keys. Remove the old OIDC role and direct-AWS variables once nothing depends on them.
- Presigned URLs expire in minutes. Ownership is checked before every read and write.
- Never log resume text, tokens, HMAC values or API keys.
- Resumes expire after 90 days. Provide a way to delete a candidate's data on request.
- Treat resume text as untrusted input to the model: instruct agents to ignore instructions embedded in resumes (prompt injection).
- Human review applies to every outcome.

## 8. Responsible-AI requirements

This is a hiring tool, so these are product requirements, not extras.

- Show recruiters *why*: every score links to cited evidence.
- Do not score on protected attributes. Strip or ignore name, age, gender, photo and similar fields before matching.
- Keep an audit trail of inputs, prompt version and output hash for each run.
- Tell candidates that AI assists the review and that a person makes the decision.
- This is a demo or course project: use only synthetic or consented test resumes and label the app as a demo. Revisit privacy and automated-hiring rules before any real-applicant use.

## 9. Non-functional requirements

| Area | Target |
| --- | --- |
| Upload to start of processing | under 5 s |
| Full pipeline for one resume | under 90 s typical, with progress updates |
| Availability | Best effort on managed services; retry transient Gemini and Lambda failures with backoff |
| Lambda timeouts | Agents 60 s, Orchestrator step-driven so no single call exceeds limits |
| Cost | Idle cost near zero; alarm on monthly spend |
| Observability | Structured logs, error-rate and duration alarms, a dead-letter queue for failed runs |

## 10. Configuration

**AWS stack parameters:** `CLERK_ISSUER`, `GEMINI_API_KEY` (NoEcho), `PIPELINE_ASSERTION_SECRET`, `ALLOWED_ORIGINS`, match threshold.

**Vercel:** `PIPELINE_API_URL`, `PIPELINE_ASSERTION_SECRET`, Clerk keys, Supabase keys, `CLERK_AUTHORIZED_PARTIES`, job-search keys.

**Clerk:** JWT template `hirely-api` with `aud = hirely-api`.

## 11. Delivery plan

1. **Repo cleanup.** Merge `dev` into the new repo, remove stale MongoDB references from the README, confirm no secrets are tracked.
2. **Local config.** Fill `CLERK_ISSUER` and `GEMINI_API_KEY` in the ignored deploy file; create the Clerk `hirely-api` template.
3. **Build and test.** Install SAM CLI, run `sam validate --lint`, `sam build`, then the offline test suites.
4. **Change set.** Create a full `UPDATE` change set for `hirely-ai-pipeline`. Confirm the bucket and table are not replaced. Execute only the complete set.
5. **Verify AWS.** Check outputs, routes, the authorizer, S3 upload and a real run with a test application.
6. **Connect Vercel.** Set the new variables, remove old AWS variables, redeploy.
7. **Verify end to end.** Test candidate and recruiter boundaries, the `NEEDS_REVIEW` paths and the draft-only outreach.
8. **Write a verification note** listing stack outputs and tested routes, with no secrets.

## 12. Acceptance criteria

- API Gateway rejects missing, expired or wrong-audience JWTs; the Public API rejects bad or stale assertions.
- A candidate cannot read another candidate's application; a recruiter cannot read a job they don't own.
- An uploaded resume lands in the private bucket and produces an evidence-cited result.
- Missing evidence yields `null` score and `NEEDS_REVIEW`, never an invented number.
- Interview feedback appears only after real answers exist.
- Outreach stays a draft; nothing is sent automatically.
- No Bedrock resources, no AWS keys in Vercel, no secrets in the repo.
- Existing S3 bucket and DynamoDB table survive the update unchanged.
- Logs contain no resume text or credentials.

## 13. Risks and open questions

| Risk or question | Mitigation or next step |
| --- | --- |
| Gemini free-tier limits or charges | Rate-limit per user, cache by output hash, set a budget alarm. |
| Lambda cold starts and size with PDF libraries | Bundle with esbuild, tune memory, measure. |
| Scanned PDFs are common | Show a clear message in v1; add Amazon Textract later only if you accept its cost. |
| Supabase scope creep | Keep Supabase to existing portal data only; all new data goes to DynamoDB. |
| Prompt injection via resumes | Isolate resume text, validate model output against a schema, cite-or-drop. |
| Bias and legal exposure | Section 8 controls plus a legal review before real use. |
| New Vercel URL unknown until first deploy | Set it in ALLOWED\_ORIGINS, Clerk and CLERK\_AUTHORIZED\_PARTIES, then redeploy the stack. |

## 14. Future scope (not v1)

- OCR for scanned resumes.
- Bulk resume ranking per job, with recruiter-controlled shortlists.
- Email integration where a recruiter clicks to send an approved draft.
- Analytics dashboard for pipeline outcomes and review rates.

## 15. Detailed specifications

Sections 15 to 21 add build-level detail to everything above.

### 15.1 Environments and naming

| Item | Value |
| --- | --- |
| GitHub repo | New repository, one clean initial commit |
| Vercel project | New project linked to the new repo; URL `<NEW_VERCEL_URL>` |
| AWS region | `ap-south-1` |
| Stack name | Pick a new name (for example `hirely-pipeline`) so it cannot collide with the old stack |
| Branches | `main` = production, `dev` = integration |
| Stages | `dev` and `prod` parameter; same template, different table and bucket names |

### 15.2 DynamoDB design

One on-demand table named `hirely-pipeline-<stage>`. Partition key `PK` (string), sort key `SK` (string). TTL attribute `expiresAt` (epoch seconds, 90 days after creation) so items expire with the S3 objects. Point-in-time recovery on in prod.

| Entity | PK | SK | Key attributes |
| --- | --- | --- | --- |
| Application meta | `APP#<appId>` | `META` | `candidateSub`, `recruiterSub`, `jobId`, `status`, `stage`, `leaseOwner`, `leaseUntil`, `createdAt`, `updatedAt`, `version` |
| Job criteria snapshot | `APP#<appId>` | `JOB` | `title`, `required[]`, `preferred[]`, `threshold`, `snapshotHash` |
| Resume | `APP#<appId>` | `RESUME#<contentHash>` | `s3Key`, `mime`, `sizeBytes`, `charCount`, `warnings[]`, `sections` |
| Match result | `APP#<appId>` | `MATCH#<inputHash>` | `criteria[]` (id, rating, evidence quote, char span), `score` or null, `needsReview` |
| Question | `APP#<appId>` | `Q#<nn>` | `text`, `criterionId`, `createdAt` |
| Answer | `APP#<appId>` | `A#<nn>` | `answerText`, `submittedAt`, `evaluation` (four weighted scores, feedback) |
| Draft | `APP#<appId>` | `DRAFT#<nn>` | `subject`, `body`, `sent` (always false), `createdAt` |
| Audit | `APP#<appId>` | `AUDIT#<timestamp>` | `agent`, `promptVersion`, `inputHash`, `outputHash`, `durationMs`, `result` |

**Global secondary indexes**

- `GSI1` (`candidateSub`, `updatedAt`): list a candidate's applications.
- `GSI2` (`recruiterSub`, `updatedAt`): list a recruiter's applications; `jobId` as an optional filter.

**Write rules**

- Every state change uses a conditional write on `version` to prevent lost updates.
- The lease is `leaseOwner` plus `leaseUntil` on META; a run starts only if the lease is empty or expired.
- Writing the META item for the first time requires the HMAC-signed ownership assertion. Later writes require the stored `candidateSub` or `recruiterSub` to match the caller.
- A stored item larger than 350 KB is rejected; DynamoDB's hard limit is 400 KB.

### 15.3 API contracts

All requests carry `Authorization: Bearer <Clerk JWT>` and `X-Ownership-Assertion: <timestamp>.<base64 HMAC>`. All responses are JSON and include `requestId`.

| Route | Request body | Success response |
| --- | --- | --- |
| `POST /uploads/resume` | `applicationId`, `fileName`, `mimeType`, `sizeBytes` | 200 `uploadUrl`, `s3Key`, `expiresInSeconds` (300) |
| `POST /pipeline/{id}/run` | `{}` | 202 `status: PROCESSING` |
| `GET /pipeline/{id}` | none | 200 role-filtered view (see below) |
| `POST /pipeline/{id}/questions` | `{}` | 200 `questions[]` |
| `POST /pipeline/{id}/answers` | `questionId`, `answerText` (max 4,000 chars) | 200 `evaluation` status |

**Error codes:** `400 invalid_request`, `401 invalid_token`, `403 not_owner`, `403 stale_assertion`, `404 not_found`, `409 run_in_progress`, `413 file_too_large`, `415 unsupported_type`, `422 unreadable_document`, `429 rate_limited`, `502 model_unavailable`, `500 internal_error`. Messages never include resume text, tokens or secrets.

**Candidate view** returns stage, status, resume warnings, interview questions, the candidate's own answers and safe feedback. **Recruiter view** adds per-criterion evidence, scores, the audit summary and the outreach draft.

### 15.4 Lambda specifications

| Function | Memory | Timeout | Trigger | Needs |
| --- | --- | --- | --- | --- |
| PublicApi | 512 MB | 15 s | API Gateway | S3 put-signing on `resumes/*`, DynamoDB read/write, invoke Orchestrator |
| Orchestrator | 512 MB | 300 s | Async invoke from PublicApi | DynamoDB, invoke the four agents |
| ResumeAgent | 1024 MB | 60 s | Orchestrator | S3 read on `resumes/*`, DynamoDB, Gemini |
| MatchingAgent | 512 MB | 60 s | Orchestrator | DynamoDB, Gemini |
| InterviewAgent | 512 MB | 60 s | Orchestrator, PublicApi | DynamoDB, Gemini |
| HeadhunterAgent | 512 MB | 60 s | Orchestrator | DynamoDB, Gemini |

All functions: Node.js 22, ARM64 (cheaper), 14-day log retention, reserved concurrency of 5 on the agents to cap Gemini spend. Failed async invocations go to a dead-letter SQS queue; that queue is the only extra service and is optional.

## 16. Pipeline state machine

Stages run in order: `UPLOADED`, `PARSING`, `MATCHING`, `INTERVIEW_PENDING`, `INTERVIEW_EVALUATING`, `DRAFTING`, `COMPLETE`. Any stage can move to `NEEDS_REVIEW` or `FAILED`.

- `PARSING` to `NEEDS_REVIEW`: fewer than 200 characters extracted (likely scanned) or the file is unreadable.
- `MATCHING` to `NEEDS_REVIEW`: the job has no criteria, or fewer than half of the criteria could be rated.
- `MATCHING` to `INTERVIEW_PENDING`: always, so a candidate below threshold still gets feedback, but `DRAFTING` is blocked.
- `INTERVIEW_EVALUATING` to `DRAFTING`: only if the score is at least the threshold and every question has an evaluated answer.
- `FAILED`: retried up to 2 times with exponential backoff, then surfaced with a safe error code and a manual retry button.

## 17. Agent output schemas

Each agent calls Gemini with a fixed prompt version and requests JSON only. The Lambda validates the output against a schema and discards anything that fails.

- **Resume agent:** `skills[]`, `experience[]` (role, employer, dates, bullet quotes), `education[]`.
- **Matching agent:** per criterion `{criterionId, rating: full | partial | missing, evidence: exact quote, startChar, endChar}`. The Lambda checks that the quote really appears in the resume text; if not, the rating becomes `missing`.
- **Interview agent:** questions tied to a criterion; evaluation `{relevance, evidence, outcome, clarity}` each 0 to 100, plus 2 to 4 candidate-safe feedback sentences.
- **Headhunter agent:** `{subject, body}` that references only verified evidence and contains no scores.

Prompt-injection defence: resume text is wrapped in delimiters, the system prompt says to treat it as data, and outputs are schema-checked and quote-verified.

## 18. Frontend requirements

- Poll `GET /pipeline/{id}` every 3 seconds while status is `PROCESSING`, then stop. Back off to 10 seconds after 60 seconds.
- Show a progress stepper using the stages in section 16.
- Show a **Needs human review** banner with the reason.
- Recruiter draft panel is labelled **Draft, not sent** and offers copy-to-clipboard only.
- All errors show a plain message and a retry action; no raw error codes for candidates.
- Accessibility: keyboard-operable upload, labelled status updates, sufficient colour contrast.

## 19. Testing plan

| Level | What |
| --- | --- |
| Unit | HMAC verify and stale-timestamp rejection; score maths; threshold edge cases; `null` score path; schema validation; quote verification |
| Integration (local) | SAM local invoke of each Lambda with DynamoDB Local |
| Authorization | Candidate A cannot read candidate B; candidate cannot see recruiter fields; wrong-audience and expired JWTs rejected |
| File handling | Valid PDF, DOCX, TXT; scanned PDF; 2 MB plus 1 byte; wrong extension with PDF bytes; password-protected PDF |
| End to end | One real run with a test application on the deployed stack |
| Safety | Resume containing injected instructions must not change scores or the draft |

## 20. Cost controls

The design targets near-zero idle cost. Set an AWS Budget alarm at a low monthly figure before first deploy. Cap Gemini usage with reserved concurrency, a per-user daily run limit (suggested 5), and output-hash caching so unchanged resumes are never re-processed. Check the current AWS Free Tier and Gemini quota terms yourself; they change.

## 21. Decisions

All questions are now answered (26 October 2026):

1. **Portal data location (confirmed).** Supabase stores the jobs recruiters post and stays the source of truth for portal data. Only the pipeline moves to DynamoDB. See section 5.1 for the full split.
2. **Clerk:** must be created as part of this project. See section 22.
3. **Resumes:** exactly one active resume per application. A new upload for the same application is rejected with `409 resume_exists`.
4. **Match threshold:** one global value, default 70, set as a stack parameter. No per-job override.
5. **Purpose:** demo or course project. Use only synthetic or consented test resumes.

## 22. Clerk setup requirements

Clerk does not exist yet for this project, so setup is part of the work.

1. Create a Clerk application and enable email and password sign-in (add Google if wanted).
2. Give each user a role, `candidate` or `recruiter`, stored in Clerk public metadata and set at sign-up. The Vercel routes read it; the AWS side only uses the user ID (`sub`).
3. Create a JWT template named `hirely-api` with the audience claim set to `hirely-api`.
4. Copy the exact issuer URL from the Clerk dashboard into the stack parameter `CLERK_ISSUER`. Do not guess it.
5. Add the publishable key and secret key to Vercel (secret key as a server-only variable).
6. After the first deploy, add `<NEW_VERCEL_URL>` to the Clerk allowed origins and to `CLERK_AUTHORIZED_PARTIES`.
7. Use the Clerk development instance for the demo; a production instance needs a custom domain.

**Done when:** a candidate and a recruiter can each sign in, a token from `hirely-api` is accepted by API Gateway, and a token with another audience is rejected.
