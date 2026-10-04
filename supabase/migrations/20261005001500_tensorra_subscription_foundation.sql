alter table public.subscriptions
  add column if not exists cancel_at_period_end boolean not null default false,
  add column if not exists trial_end timestamptz,
  add column if not exists metadata jsonb not null default '{}'::jsonb;

create index if not exists subscriptions_provider_customer_idx
  on public.subscriptions(provider, external_customer_id)
  where external_customer_id is not null;

create index if not exists subscriptions_provider_subscription_idx
  on public.subscriptions(provider, external_subscription_id)
  where external_subscription_id is not null;

create table if not exists private.billing_events (
  id bigint generated always as identity primary key,
  provider text not null,
  event_id text not null,
  event_type text not null,
  user_id uuid references auth.users(id) on delete set null,
  payload jsonb not null default '{}'::jsonb,
  processed_at timestamptz,
  created_at timestamptz not null default now(),
  unique(provider, event_id)
);

revoke all on table private.billing_events from public, anon, authenticated;

create or replace function private.sync_profile_plan()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.profiles
  set plan = new.plan
  where id = new.user_id
    and plan is distinct from new.plan;
  return new;
end;
$$;

revoke all on function private.sync_profile_plan() from public, anon, authenticated;

drop trigger if exists subscriptions_sync_profile_plan on public.subscriptions;
create trigger subscriptions_sync_profile_plan
after insert or update of plan on public.subscriptions
for each row execute function private.sync_profile_plan();

update public.profiles p
set plan = s.plan
from public.subscriptions s
where s.user_id = p.id
  and p.plan is distinct from s.plan;
