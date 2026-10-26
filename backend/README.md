# Backend

`api/server.ts` is the Express API used by Vercel and local development. Existing portal profiles, jobs, and applications remain in Supabase. Pipeline routes verify Clerk tokens, read roles from Clerk public metadata, check ownership against Supabase, and sign requests to API Gateway with an HMAC ownership assertion.

The AWS implementation is in [`aws-pipeline/`](../aws-pipeline/). Vercel never holds AWS credentials and never calls Lambda directly. Follow the current [PRD](../documentation/PRD.md) and [deployment guide](../aws-pipeline/README.md).
