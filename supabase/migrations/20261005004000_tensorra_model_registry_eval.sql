create table if not exists private.model_candidates (
  id uuid primary key default gen_random_uuid(),
  candidate_key text not null unique,
  label text not null,
  role text not null check (role in ('fast','deep','vision')),
  stage text not null default 'candidate'
    check (stage in ('candidate','shadow','production','disabled')),
  provider text not null default 'openai-compatible',
  model_name text not null,
  endpoint_hint text,
  config jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists private.model_eval_runs (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid references private.model_candidates(id) on delete set null,
  candidate_key text not null,
  baseline_model text not null,
  candidate_model text not null,
  suite text not null,
  status text not null default 'running'
    check (status in ('running','passed','failed','error')),
  total_cases integer not null default 0,
  completed_cases integer not null default 0,
  baseline_score double precision,
  candidate_score double precision,
  candidate_win_rate double precision,
  baseline_avg_latency_ms double precision,
  candidate_avg_latency_ms double precision,
  category_scores jsonb not null default '{}'::jsonb,
  gate_result jsonb not null default '{}'::jsonb,
  started_at timestamptz not null default now(),
  finished_at timestamptz
);

create table if not exists private.model_eval_results (
  id bigint generated always as identity primary key,
  run_id uuid not null references private.model_eval_runs(id) on delete cascade,
  case_id text not null,
  category text,
  expected_mode text,
  expected_safety text,
  baseline_score double precision,
  candidate_score double precision,
  winner text check (winner in ('baseline','candidate','tie')),
  baseline_latency_ms integer,
  candidate_latency_ms integer,
  baseline_error text,
  candidate_error text,
  notes jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique(run_id, case_id)
);

create table if not exists private.model_promotion_events (
  id bigint generated always as identity primary key,
  candidate_id uuid references private.model_candidates(id) on delete set null,
  candidate_key text not null,
  from_stage text,
  to_stage text not null,
  eval_run_id uuid references private.model_eval_runs(id) on delete set null,
  gate_snapshot jsonb not null default '{}'::jsonb,
  reason text,
  created_at timestamptz not null default now()
);

create index if not exists model_candidates_role_stage_idx
  on private.model_candidates(role, stage);

create index if not exists model_eval_runs_candidate_started_idx
  on private.model_eval_runs(candidate_key, started_at desc);

create index if not exists model_eval_results_run_idx
  on private.model_eval_results(run_id);

create index if not exists model_promotion_events_candidate_idx
  on private.model_promotion_events(candidate_key, created_at desc);

revoke all on table private.model_candidates from public, anon, authenticated;
revoke all on table private.model_eval_runs from public, anon, authenticated;
revoke all on table private.model_eval_results from public, anon, authenticated;
revoke all on table private.model_promotion_events from public, anon, authenticated;
