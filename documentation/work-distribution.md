# Work Distribution — HireMe (Phase-I)

**Course context:** BITE412L Cloud Computing — Project Phase-I
**Team size:** 2

---

## 1. Team Roles Summary

| Member | Primary ownership | Repository folders owned |
|---|---|---|
| **Nishtha** | Frontend + Backend | `frontend/`, `backend/`, `database/` (schema & wiring, not agent logic) |
| **Manya** | AI Agents + AI Orchestration | `ai-agents/` (all five sub-agents including the Orchestrator) |

Both members jointly own `documentation/`, `results/`, and `presentation/`.

---

## 2. Detailed Task Breakdown

### 2.1 Nishtha — Frontend + Backend

| Task | Deliverable | Folder |
|---|---|---|
| Candidate & recruiter UI (job search, application tracking, resume builder, chat) | React/Vite components | `frontend/` |
| Recruiter dashboard that reads and displays the final recommendation | React/Vite dashboard view | `frontend/` |
| Express API layer connecting frontend to the agent pipeline | Node.js/Express routes | `backend/` |
| S3 integration — resume/JD upload and retrieval | Upload/storage handlers | `backend/` |
| DynamoDB integration — reading/writing candidate, application, and recommendation records | Data-access layer | `backend/`, `database/` |
| DynamoDB table schema design (single-table, keyed by candidate ID + job ID) | Schema definition | `database/` |
| Auth handling (lightweight token check / existing third-party auth integration) | Auth middleware | `backend/` |
| Job data integrations (Adzuna, SerpApi) | API integration modules | `backend/` |

### 2.2 Manya — AI Agents + AI Orchestration

| Task | Deliverable | Folder |
|---|---|---|
| Resume Agent — structured skills/experience extraction | Lambda function + prompt design | `ai-agents/resume-agent/` |
| Matching Agent — match score % and gap list generation | Lambda function + prompt design | `ai-agents/matching-agent/` |
| Interview Agent — tailored question generation and answer scoring | Lambda function + prompt design | `ai-agents/interview-agent/` |
| Headhunter Agent — outreach message drafting for high-match candidates | Lambda function + prompt design | `ai-agents/headhunter-agent/` |
| Orchestrator — sequencing, threshold branching, result aggregation, and final rationale generation | Orchestrator Lambda logic | `ai-agents/orchestrator/` |
| Gemini API prompt engineering and response-schema design for every agent | Prompt templates | `ai-agents/` (per-agent) |
| Agent input/output contract definitions (interfaces between pipeline stages) | Interface/schema docs | `ai-agents/`, `documentation/` |

### 2.3 Joint Responsibilities

| Task | Deliverable | Folder |
|---|---|---|
| Product requirements documentation | PRD | `documentation/` |
| Architecture diagram | Diagram + write-up | `documentation/` |
| Literature survey and research gap analysis | Survey + gap docs | `documentation/` |
| Evaluation of pipeline outputs, metrics tracking | Results write-up | `results/` |
| Slide deck and demo preparation | Slides | `presentation/` |

---

## 3. Milestone Ownership 

| # | Milestone | Owner |
|---|---|---|
| 1 | Define agent interfaces (input/output schema) | Manya (agent contracts), Nishtha (consumption points) |
| 2 | Implement each agent as a separate Lambda function | Manya |
| 3 | Implement the Orchestrator Lambda (sequencing + branching) | Manya |
| 4 | Wire S3 (files) and DynamoDB (structured data) into each agent | Nishtha (storage layer), Manya (agent-side calls) |
| 5 | Connect Gemini API calls inside each agent | Manya |
| 6 | Build the recruiter-facing view that reads the final recommendation | Nishtha |

---


