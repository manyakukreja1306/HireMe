# Product Requirements Document
## HireMe — Multi-Agent Generative AI Cloud Platform for Intelligent Hiring Decision Support

**Version:** 2.1 (free-tier / minimal-services revision)
**Course context:** BITE412L Cloud Computing — Project Phase-I
**Base product:** HireMe (existing AI-powered job portal)

---

## 1. Overview

HireMe is an existing full-stack job portal connecting candidates and recruiters, with several independent Gemini-powered AI features (resume checking, mock interviews, recruiter outreach, chatbot). This PRD extends HireMe into a **multi-agent decision support platform** built on a minimal set of AWS services, chosen so the entire project can run on an AWS Free Tier account without incurring standing costs.

Instead of four standalone AI features, a candidate's resume, job match, interview performance, and outreach eligibility flow through a coordinated pipeline of agents that culminate in a single, explainable hiring recommendation — satisfying the assigned topic *"Multi-Agent Generative AI Cloud Platform for Intelligent Decision Support Systems"* while keeping the architecture deliberately small.

---

## 2. Problem Statement

Recruiters manually stitch together signals from a resume, a job description, an interview, and their own judgment to decide whether to move a candidate forward. HireMe's original architecture treats resume analysis, matching, interviews, and outreach as **disconnected features**, each a single AI call with no shared context or aggregated output, and no audit trail for *why* a candidate was or wasn't advanced.

**Proposed solution:** an orchestrated multi-agent pipeline where each stage's output becomes the next stage's input, ending in one aggregated recommendation — built on the smallest cloud footprint that can support it, so the project stays inside free-tier limits.

---

## 3. Goals & Objectives

1. Convert HireMe's four independent AI features into agents with defined roles and explicit hand-offs.
2. Keep the architecture to a small, fixed set of AWS services — no managed orchestration, auth, notification, or monitoring services beyond what those services already include for free.
3. Produce a single, explainable decision output per candidate-job pair.
4. Stay within AWS Always-Free limits for storage and compute, and keep external AI inference usage small enough to run on a free/low-cost API tier.

---

## 4. Target Users / Personas

| Persona | Role | Primary need |
|---|---|---|
| Candidate | Applies to jobs, takes AI interviews | Fast, fair evaluation and clear feedback |
| Recruiter | Posts jobs, reviews candidates | A ranked, reasoned shortlist instead of raw scores |

---

## 5. Core Feature Set

### 5.1 Candidate-facing (existing, retained)
- Job search & filtering (Adzuna / SerpApi integration)
- Resume builder
- Application tracking dashboard
- Real-time chat with recruiters

### 5.2 Recruiter-facing (existing, retained)
- Job posting
- Applicant review dashboard
- Real-time chat with candidates

### 5.3 Multi-Agent Decision Support Pipeline

| Agent | Repurposes | Input | Output |
|---|---|---|---|
| Resume Agent | ATS Resume Checker | Uploaded resume | Structured skills/experience JSON |
| Matching Agent | (new, lightweight) | Resume JSON + job description | Match score % + gap list |
| Interview Agent | AI Voice Interview | Resume JSON + JD + gaps | Tailored questions, answer scores |
| Headhunter Agent | AI Headhunter | Candidate profile (high-match only) | Outreach message draft |
| Orchestrator | (new) | All of the above | Aggregated recommendation + reasoning |

Below-threshold candidates are flagged in the dashboard and the pipeline stops before the (more expensive) interview and outreach stages run — this also keeps AI inference cost down.

---

## 6. Architecture: Minimal AWS Footprint

To fit a free-tier account, orchestration is done **in code**, not with a separate managed workflow service — one Lambda function calls the others directly and aggregates their results, rather than using Step Functions. Auth, notifications, and monitoring are handled as side-effects of the core services rather than as additional managed services.

| # | Service | Role in this project |
|---|---|---|
| 1 | **AWS Lambda** | Hosts every agent (Resume, Matching, Interview, Headhunter) plus one Orchestrator function that invokes them in sequence and branches on the match score |
| 2 | **Amazon S3** | Stores resumes and job description files; also hosts the static React frontend (S3 static website hosting) |
| 3 | **Amazon DynamoDB** | Stores candidates, applications, match scores, and interview results |

**AI reasoning engine (external, non-AWS):** every agent's reasoning step calls the **Google Gemini API** — the same LLM already used by the base product's resume checker, interview, and headhunter features. It is treated the same way the project treats its existing third-party auth provider: a SaaS dependency that sits outside the AWS service count, so it doesn't add to the cloud bill or the architecture's service total.

**What was intentionally dropped, and why:**
- **Step Functions** → replaced by one Lambda invoking the others directly via the AWS SDK. Fewer moving parts, same sequencing/branching logic, one less service on the bill.
- **API Gateway** → the frontend calls Lambda function URLs directly (Lambda supports this natively) instead of provisioning a separate API layer.
- **Cognito** → out of scope for this phase; a simple token check inside the Orchestrator Lambda stands in for auth, or the existing third-party auth integration is kept as-is (it's a third-party SaaS, not an AWS service, so it doesn't count against the core services).
- **SES / SNS** → no separate email/notification service; status changes surface in the existing recruiter/candidate dashboard instead of an email trigger.
- **CloudWatch** → not counted separately since Lambda writes basic logs to CloudWatch automatically at no extra setup or cost; it's a byproduct of using Lambda, not an additional service you provision.
- **A managed AWS AI/ML service** → replaced by direct calls to the Google Gemini API from within each Lambda agent, reusing the LLM integration already built into the base product instead of standing up a new managed inference service.

---

## 7. Data Flow

1. Candidate uploads a resume → stored in S3 → record created in DynamoDB.
2. Orchestrator Lambda invokes Resume Agent → structured data written back to DynamoDB.
3. Orchestrator invokes Matching Agent → match score written to DynamoDB.
4. If score is below threshold: status set to "not advanced," pipeline stops.
5. If above threshold: Orchestrator invokes Interview Agent, then Headhunter Agent, writing each result to DynamoDB.
6. Orchestrator aggregates all stored results into one recommendation, written back to DynamoDB and shown on the recruiter dashboard.

---

## 8. Functional Requirements

1. System must accept a resume upload and job description as pipeline input, storing the resume in S3.
2. Resume Agent must output structured skill/experience data.
3. Matching Agent must produce a numeric match score and a list of specific gaps.
4. Orchestrator must branch on the match score: below threshold → mark as not advanced and stop; above threshold → continue.
5. Interview Agent must generate questions informed by both the resume and the job description.
6. Headhunter Agent must only run for candidates who pass the match threshold.
7. Orchestrator must write one final recommendation record to DynamoDB combining match score, interview score, and a natural-language rationale.
8. Recruiter dashboard must read and display the final recommendation from DynamoDB.

---

## 9. Non-Functional Requirements

- **Cost:** the entire pipeline (Lambda, S3, DynamoDB) must stay inside AWS Always-Free monthly limits; only the external Gemini API calls draw on a separate free/low-cost API quota, and usage should stay low enough (course-project traffic, not production traffic) to avoid exhausting it.
- **Simplicity:** a small, fixed set of AWS services, no managed orchestration/auth/notification layer — trade-off accepted for this phase in exchange for a smaller bill and a simpler diagram.
- **Basic observability:** default Lambda/CloudWatch logs are sufficient for debugging at this scale; no custom dashboards required.

---

## 10. Data Requirements

- Resumes and job description files: S3.
- Candidate/application/match/interview/recommendation records: single DynamoDB table, keyed by candidate ID + job ID.
- No sensitive data should be logged in plaintext in default Lambda logs.

---

## 11. Success Metrics / KPIs

- Pipeline completion rate (executions that reach a final recommendation without failure).
- % of candidates correctly filtered out at the Matching Agent stage before the interview stage runs (cost-saving metric).
- Total monthly Lambda invocations and DynamoDB usage stay within Always-Free limits.
- Gemini API token usage stays within available free/low-cost quota for the semester.

---

## 12. Assumptions & Constraints

- The Gemini API is the only AI dependency in this architecture without a permanent AWS Always-Free allowance; it is covered by its own free/low-cost API tier, so testing volume should stay modest.
- Auth is simplified for this phase (token check in code, or continued use of the existing third-party auth integration) rather than a managed AWS auth service.
- Match threshold (e.g. 70%) is a placeholder and should be tuned or left configurable.
- No separate notification service — status changes are visible in-dashboard only for this phase.

---

## 13. Out of Scope (for this phase)

- Managed orchestration (Step Functions), managed auth (Cognito), managed notifications (SES/SNS), and custom monitoring dashboards (CloudWatch beyond default logs).
- Payment/billing features.
- Mobile native apps.

---

## 14. Suggested Milestones

1. Define agent interfaces (input/output schema) for Resume, Matching, Interview, Headhunter agents.
2. Implement each agent as a separate Lambda function.
3. Implement the Orchestrator Lambda that invokes the four agents in sequence and branches on match score.
4. Wire S3 (files) and DynamoDB (structured data) into each agent.
5. Connect Gemini API calls inside each agent.
6. Build the recruiter-facing view that reads the final recommendation from DynamoDB.
