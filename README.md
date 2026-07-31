# HireMe — Multi-Agent Generative AI Cloud Platform for Intelligent Hiring Decision Support

**Course context:** BITE412L Cloud Computing — Project Phase-I

---

## 1. Project Title

**HireMe** — Multi-Agent Generative AI Cloud Platform for Intelligent Hiring Decision Support

HireMe extends an existing AI-powered job portal (React + Node.js/Express + MongoDB, with Gemini-powered AI features for resume checking, mock interviews, and recruiter outreach) into a **coordinated multi-agent decision-support pipeline**, built on a deliberately small AWS footprint so the entire project can run on an AWS Free Tier account.

---

## 2. Team Members

| Name | Responsibility |
|---|---|
| **Nishtha** | Frontend + Backend (job portal UI, Express/API layer, S3 & DynamoDB integration, recruiter/candidate dashboards) |
| **Manya** | AI Agents + AI Orchestration (Resume, Matching, Interview, Headhunter agents; Orchestrator logic; prompt design; agent hand-offs) |

See [`documentation/work-distribution.md`](documentation/work-distribution.md) for the detailed task breakdown.

---

## 3. Problem Statement

Recruiters manually stitch together signals from a resume, a job description, an interview, and their own judgment to decide whether to move a candidate forward. The original job-portal architecture treats resume analysis, matching, interviews, and outreach as **disconnected features** — each a single, isolated AI call with no shared context, no aggregated output, and no audit trail for *why* a candidate was or wasn't advanced.

---

## 4. Objectives

1. Convert the portal's independent AI features into **agents** with defined roles and explicit hand-offs, so each stage's output becomes the next stage's input.
2. Keep the cloud architecture to a **minimal AWS footprint** — no managed orchestration, auth, or notification services beyond what the core services already include for free.
3. Produce a single, **explainable hiring recommendation** per candidate–job pair, combining match score, interview performance, and a natural-language rationale.
4. Stay within AWS Always-Free limits for storage/compute, and keep external AI inference usage light enough to run on course-project traffic rather than production traffic.
5. Stop the pipeline early (before the interview/outreach stages) for candidates who don't clear the match threshold, to save cost and recruiter time.

---

## 5. Proposed Architecture / Framework

HireMe is built as an **orchestrated agent pipeline**: a candidate's resume, job match, interview performance, and outreach eligibility flow through four specialized agents coordinated by a single Orchestrator, ending in one aggregated recommendation.

```
 Candidate                                   Recruiter
 uploads resume                              views dashboard
      │                                            ▲
      ▼                                            │
 ┌─────────────┐        ┌────────────────────────────────────┐
 │  Amazon S3  │        │      Amazon DynamoDB                │
 │ resumes/JDs │◄──────►│ candidates · applications ·         │
 │ static site │        │ match scores · interview results ·  │
 └─────────────┘        │ final recommendations               │
        │                └────────────────────────────────────┘
        ▼                              ▲
 ┌───────────────────────── AWS Lambda ─────────────────────────┐
 │                                                                │
 │   ┌───────────────┐   ┌────────────────┐                      │
 │   │ Resume Agent  │──►│ Matching Agent │──► score < threshold │
 │   └───────────────┘   └────────────────┘        │             │
 │                                │ pass            ▼             │
 │                                ▼            "not advanced"     │
 │                       ┌────────────────┐    (pipeline stops)   │
 │                       │ Interview Agent│                       │
 │                       └────────────────┘                       │
 │                                │                                │
 │                                ▼                                │
 │                       ┌────────────────┐                        │
 │                       │Headhunter Agent│                        │
 │                       └────────────────┘                        │
 │                                │                                 │
 │                                ▼                                 │
 │                       ┌────────────────┐                         │
 │                       │  Orchestrator  │─── aggregates all       │
 │                       │    Lambda      │    results + writes     │
 │                       └────────────────┘    final recommendation │
 └────────────────────────────────────────────────────────────────┘
                                 │
                                 ▼
                     Google Gemini API (external)
              shared reasoning engine for every agent
```

A rendered version of this diagram is also available at [`documentation/architecture-diagram.svg`](documentation/architecture-diagram.svg).

### Pipeline stages

| Agent | Repurposes | Input | Output |
|---|---|---|---|
| Resume Agent | ATS Resume Checker | Uploaded resume | Structured skills/experience JSON |
| Matching Agent | (new, lightweight) | Resume JSON + job description | Match score % + gap list |
| Interview Agent | AI Voice Interview | Resume JSON + JD + gaps | Tailored questions, answer scores |
| Headhunter Agent | AI Headhunter | Candidate profile (high-match only) | Outreach message draft |
| Orchestrator | (new) | All of the above | Aggregated recommendation + reasoning |

### Design principles

- **Orchestration in code, not a managed workflow service** — one Orchestrator Lambda invokes the other agent Lambdas directly and branches on the match score, instead of provisioning a separate workflow/state-machine service.
- **Direct Lambda invocation** — the frontend calls Lambda function URLs directly rather than provisioning a separate API layer.
- **Lightweight auth** — a simple token check inside the Orchestrator, or the existing third-party auth integration, stands in for a managed auth service.
- **In-dashboard status, no separate notification service** — status changes surface directly in the recruiter/candidate dashboard.
- **Default logging only** — Lambda's built-in logs are sufficient for debugging at this scale; no custom monitoring dashboards.
- **External AI reasoning** — every agent's reasoning step calls out to the Google Gemini API (already used in the base product), kept as a third-party SaaS dependency rather than a managed AWS AI service, so it doesn't add to the AWS service count.

---

## 6. Technology Stack

| Layer | Technology |
|---|---|
| Frontend | React, Vite, TypeScript |
| Backend / API | Node.js, Express |
| Cloud compute | AWS Lambda (agents + orchestrator) |
| Object storage | Amazon S3 (resumes, job descriptions, static site hosting) |
| Database | Amazon DynamoDB (candidates, applications, scores, interview results, recommendations) |
| AI / LLM reasoning | Google Gemini API |
| Job data integrations | Adzuna API, SerpApi |
| Auth | Existing third-party auth integration / lightweight token check |
| Version control & CI | Git, GitHub |

---

## 7. Dataset Details

HireMe does not use a static training dataset. Its data is **generated at runtime** from user activity:

- **Resumes & job descriptions** — uploaded by candidates and recruiters, stored in S3.
- **Job listings** — pulled live from the Adzuna and SerpApi job-search APIs.
- **Candidate/application/match/interview/recommendation records** — generated by the agent pipeline and stored in DynamoDB.

No external labeled dataset is required; the Matching and Interview agents reason directly over the resume/JD pair via the Gemini API rather than a trained classifier.

---

## 8. Repository Structure

```
HireMe/
├── README.md                  ← you are here
├── frontend/                  ← React/Vite candidate & recruiter UI
├── backend/                   ← Express API layer, S3/DynamoDB integration
├── ai-agents/                 ← Resume, Matching, Interview, Headhunter agents + Orchestrator
│   ├── resume-agent/
│   ├── matching-agent/
│   ├── interview-agent/
│   ├── headhunter-agent/
│   └── orchestrator/
├── database/                  ← DynamoDB table schema & seed/sample data
├── documentation/             ← PRD, architecture diagram, literature survey, research gaps, work distribution
├── results/                   ← Evaluation results, metrics, screenshots (populated in later phases)
└── presentation/              ← Slide deck(s) and demo materials
```

Every folder contains its own `README.md` describing its purpose and current status.

---

## 9. Project Status

This repository currently reflects **Phase-I**: requirements, architecture, and repository scaffolding. Implementation (agent code, Lambda functions, dashboard) is planned for subsequent phases — see [`documentation/PRD.md`](documentation/PRD.md) for the full requirements document and [`documentation/work-distribution.md`](documentation/work-distribution.md) for milestone ownership.
