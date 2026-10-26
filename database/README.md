# Data storage

Supabase remains the source of truth for the portal's user profiles, jobs, and application records. The assessment pipeline does not write resume content or pipeline results to Supabase.

AWS DynamoDB stores application ownership, job snapshots, assessment progress, resume summaries, evidence ratings, interview questions and answers, outreach drafts, leases, hashes, and audit records. S3 stores private resume objects for 90 days. DynamoDB rows use `PK=APP#<applicationId>` with `SK=META` for application state and additional sort-key records for agent outputs/audit. User rate counters use `PK=USER#<Clerk subject>`.

The target table has on-demand billing, TTL, candidate/recruiter GSIs, and point-in-time recovery in production. The SAM template is the deployment source of truth. Existing portal jobs need the two criteria columns added by [`supabase/migrations/20261026000000_job_assessment_criteria.sql`](../supabase/migrations/20261026000000_job_assessment_criteria.sql).
