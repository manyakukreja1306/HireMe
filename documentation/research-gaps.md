# Research Gaps — HireMe

**Course context:** BITE412L Cloud Computing — Project Phase-I

This document identifies the gaps in existing approaches (as surveyed in `literature-survey.md`) that HireMe's design is intended to address.

---

## Gap 1: Disconnected AI Features Instead of a Coordinated Pipeline

**Observed in prior work:** Resume screening, interview generation, and recruiter outreach are typically implemented as independent features, each invoked separately with no shared context. A candidate's resume score has no structural relationship to the interview questions they're asked, and outreach can be triggered regardless of match quality.

**Gap:** There is no lightweight, explicitly-chained pipeline where each stage's output becomes the next stage's structured input, culminating in a single decision artifact.

**HireMe's response:** A four-agent pipeline (Resume → Matching → Interview → Headhunter) coordinated by an Orchestrator that passes structured JSON between stages and halts early for below-threshold candidates.

---

## Gap 2: No Single, Explainable Recommendation Per Candidate

**Observed in prior work:** Recruiters see multiple disconnected scores/outputs (a resume score here, an interview transcript there) and must manually synthesize a hiring decision, with no persisted rationale for *why* a decision was made.

**Gap:** Lack of a single aggregated, natural-language-justified recommendation record that a recruiter (or a later audit) can read directly.

**HireMe's response:** The Orchestrator writes one final recommendation record combining match score, interview score, and a natural-language rationale to a single database record per candidate–job pair.

---

## Gap 3: Cost-Blind Pipelines

**Observed in prior work:** AI hiring tools generally run every stage for every candidate, regardless of fit, incurring interview-generation and outreach-drafting costs even for clearly unqualified candidates.

**Gap:** Few systems treat the match-score threshold as a **pipeline control point** that actively prevents downstream (more expensive) stages from running.

**HireMe's response:** The pipeline explicitly branches on the Matching Agent's score — candidates below threshold are marked "not advanced" and the Interview and Headhunter agents never run for them, which is tracked as a success metric (percentage of candidates correctly filtered out before the interview stage).

---

## Gap 4: Multi-Agent Systems Assume Managed Orchestration Infrastructure

**Observed in prior work:** Multi-agent generative AI reference architectures typically assume a managed workflow/state-machine service, a managed API gateway, and managed auth/notification services — appropriate for production systems but heavyweight for a course-scale project.

**Gap:** Limited documented guidance on building a *genuinely* multi-agent, hand-off-based pipeline on a **minimal, free-tier-compatible** cloud footprint, without sacrificing the core multi-agent hand-off structure.

**HireMe's response:** Orchestration is implemented in code inside a single coordinating function; the frontend calls compute functions directly instead of through a managed API layer; auth is a lightweight check or an existing third-party integration; notifications surface in-dashboard instead of through a managed notification service. This is treated as an explicit, documented trade-off (see PRD §6, "What was intentionally dropped, and why") rather than an oversight.

---

## Summary

| Gap | HireMe's mitigation |
|---|---|
| Disconnected AI features | Chained agent pipeline with structured hand-offs |
| No unified, explainable output | Single aggregated recommendation record with rationale |
| Cost-blind execution | Threshold-gated branching that skips expensive stages |
| Heavyweight orchestration assumptions | In-code orchestration on a minimal, free-tier cloud footprint |

These gaps and mitigations will be revisited and refined with formal citations in Phase-II as specific reference papers and vendor architectures are selected for deeper comparison.
