# Literature Survey — Multi-Agent Generative AI Systems for Hiring Decision Support

**Course context:** BITE412L Cloud Computing — Project Phase-I

---

## 1. Purpose

This survey reviews existing work relevant to HireMe's two core themes: (1) AI-assisted hiring/recruitment systems, and (2) multi-agent orchestration patterns for generative AI pipelines on cloud infrastructure. It is intended to situate HireMe's design choices against prior approaches and to motivate the research gap addressed in `research-gaps.md`.

---

## 2. Survey Areas

### 2.1 AI-Assisted Resume Screening & ATS Systems

Applicant Tracking Systems (ATS) commonly use keyword-matching or embedding-similarity approaches to score resumes against job descriptions. These systems typically:
- Operate as a single-pass classifier or scorer, without a structured hand-off to downstream hiring stages.
- Output a numeric score with limited or no natural-language justification.
- Are not designed to condition later stages (e.g., interview question generation) on their output.

*Relevance to HireMe:* the Resume and Matching Agents build on this line of work but are explicitly designed to pass structured output forward rather than terminate at a score.

### 2.2 LLM-Based Mock Interview and Candidate Evaluation Tools

Recent generative-AI interview tools use large language models to generate interview questions and, in some cases, score candidate responses. Typical designs:
- Generate a fixed or lightly-templated question set independent of a match/gap analysis.
- Run as an isolated feature disconnected from resume screening or recruiter outreach.

*Relevance to HireMe:* the Interview Agent is explicitly conditioned on the Resume Agent's structured output and the Matching Agent's gap list, rather than generating questions from the job description alone.

### 2.3 AI-Assisted Recruiter Outreach / Sourcing Tools

"AI headhunter" style tools draft outreach messages to candidates, generally triggered manually by a recruiter for any candidate profile, without an upstream eligibility gate.

*Relevance to HireMe:* the Headhunter Agent is deliberately gated behind the Matching Agent's threshold, so outreach only runs for candidates likely to be a fit — both a UX improvement and a cost-control measure for the pipeline.

### 2.4 Multi-Agent Orchestration Patterns

Multi-agent generative AI systems in industry and research literature are commonly built with a dedicated orchestration/workflow layer (e.g., managed state-machine services, agent frameworks with a central planner) that sequences agent calls, handles retries, and manages branching logic.

*Relevance to HireMe:* rather than adopting a managed orchestration service, HireMe implements orchestration **in code** within a single coordinating function, trading some resilience/observability features for a smaller, free-tier-compatible footprint — a deliberate scope reduction appropriate to a course project rather than a production system.

### 2.5 Serverless Architectures for AI Pipelines

Serverless compute (function-as-a-service) is widely used to host independent, stateless inference steps, with object storage for unstructured inputs and a managed NoSQL store for pipeline state. This pattern avoids provisioning and managing servers for intermittent, bursty AI workloads.

*Relevance to HireMe:* the project follows this pattern directly — each agent is a stateless function, files live in object storage, and pipeline state lives in a single NoSQL table.

---

## 3. Summary Table

| Area | Common approach in prior work | HireMe's approach |
|---|---|---|
| Resume screening | Isolated scorer, no downstream hand-off | Structured JSON output feeding later agents |
| Interview generation | Generic/templated questions | Questions conditioned on resume + JD + gaps |
| Recruiter outreach | Manually triggered, ungated | Auto-gated behind match threshold |
| Orchestration | Managed workflow/state-machine service | In-code orchestration in a single coordinating function |
| Compute model | Mixed (servers, containers, or serverless) | Fully serverless, free-tier-first |

---

## 4. Sources of Reference

This survey draws on general, publicly documented patterns for ATS systems, LLM-based interview tools, AI sourcing/outreach tools, multi-agent orchestration frameworks, and serverless AI architectures, rather than a single canonical dataset or paper. A formal citation list will be added as specific papers/vendor documentation are selected for the Phase-II literature review.
