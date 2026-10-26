# Hirely

Hirely is a demo job portal for candidates and recruiters. Its optional AI assisted assessment pipeline provides resume evidence, interview feedback, and recruiter outreach drafts for human review. It never makes hiring decisions or sends messages.

## Stack

- React and Vite on Vercel
- Clerk authentication
- Supabase for existing user, job, and application records
- AWS API Gateway, Lambda, private S3, and DynamoDB for pipeline data
- Gemini called only from server-side Lambda functions

Resume files are uploaded to private S3 and expire after 90 days. Pipeline results do not go to Supabase. See [the pipeline guide](aws-pipeline/README.md) for the implementation and current setup requirements.

## Local development

Use Node.js 22 or newer. Copy `.env.example` to `.env`, fill the existing app's Clerk, Supabase, and job search settings, then run:

```powershell
npm ci
npm run dev
```

The Vercel API is also available locally through `npm run server`. To build the AWS package, install AWS SAM CLI and run the commands in `aws-pipeline/README.md`.

Before using job criteria, apply [`20261026000000_job_assessment_criteria.sql`](supabase/migrations/20261026000000_job_assessment_criteria.sql) to the existing Supabase project. Recruiters can then enter required and preferred criteria when posting a job.

## Demo safety

Use only synthetic or consented test resumes. AI output can be wrong; a person reviews every outcome. Candidate responses never include recruiter-only evidence or outreach drafts.
