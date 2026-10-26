# Frontend

The React/Vite application lives in `src/`. It retains Hirely's job search, candidate and recruiter dashboards, chat, and interview features. `src/components/PipelineAssessment.tsx` shows assessment progress, candidate-safe interview feedback, recruiter evidence, and draft-only outreach.

The frontend never calls AWS directly. Its Vercel API routes verify Clerk sessions, check Supabase application/job ownership, sign the ownership assertion, and call API Gateway. Resume bytes go from the server to a short-lived private S3 upload URL. See the current [product requirements](../documentation/PRD.md) and [pipeline setup](../aws-pipeline/README.md).
