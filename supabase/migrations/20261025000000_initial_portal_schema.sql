-- Initial Hirely portal schema. API access uses the server-only Supabase service key
-- after Clerk authentication and authorization; browser roles receive no table grants.
begin;

create table if not exists public.profiles (
  uid text primary key,
  email text not null default '',
  role text not null check (role in ('candidate', 'recruiter')),
  name text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.jobs (
  id text primary key,
  title text not null,
  company text not null,
  location text not null default '',
  type text not null default 'Full-time',
  salary text not null default '',
  category text not null default 'Other',
  description text not null default '',
  required_skills text[] not null default array[]::text[],
  preferred_skills text[] not null default array[]::text[],
  employer_id text not null references public.profiles(uid) on delete restrict,
  posted_at text not null default '',
  logo text not null default '',
  document_url text,
  created_at timestamptz not null default now()
);

create table if not exists public.applications (
  id text primary key,
  job_id text not null,
  employer_id text references public.profiles(uid) on delete set null,
  candidate_id text not null references public.profiles(uid) on delete restrict,
  candidate_name text not null default '',
  candidate_email text not null default '',
  applied_at bigint not null default (extract(epoch from now()) * 1000)::bigint,
  status text not null default 'pending' check (status in ('pending', 'reviewed', 'accepted', 'rejected', 'on_hold')),
  resume_url text not null default ''
);

create table if not exists public.messages (
  id text primary key,
  application_id text not null references public.applications(id) on delete cascade,
  sender_id text not null references public.profiles(uid) on delete restrict,
  content text not null,
  timestamp bigint not null default (extract(epoch from now()) * 1000)::bigint,
  is_ai boolean not null default false,
  is_video_call_request boolean not null default false,
  video_call_status text check (video_call_status in ('pending', 'accepted', 'rejected')),
  video_call_url text
);

alter table public.jobs add column if not exists required_skills text[] not null default array[]::text[];
alter table public.jobs add column if not exists preferred_skills text[] not null default array[]::text[];

create index if not exists jobs_created_at_idx on public.jobs (created_at desc);
create index if not exists jobs_employer_id_idx on public.jobs (employer_id);
create index if not exists applications_candidate_id_idx on public.applications (candidate_id, applied_at desc);
create index if not exists applications_employer_id_idx on public.applications (employer_id, applied_at desc);
create index if not exists applications_job_id_idx on public.applications (job_id);
create index if not exists messages_application_timestamp_idx on public.messages (application_id, timestamp);

alter table public.profiles enable row level security;
alter table public.jobs enable row level security;
alter table public.applications enable row level security;
alter table public.messages enable row level security;

revoke all on public.profiles, public.jobs, public.applications, public.messages from anon, authenticated;
grant all on public.profiles, public.jobs, public.applications, public.messages to service_role;

commit;
