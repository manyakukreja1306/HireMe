-- Explicit, job-related criteria used by Hirely's evidence-based assessment.
-- Existing job records remain valid and start with empty criteria arrays.
alter table public.jobs
  add column if not exists required_skills text[] not null default array[]::text[],
  add column if not exists preferred_skills text[] not null default array[]::text[];
