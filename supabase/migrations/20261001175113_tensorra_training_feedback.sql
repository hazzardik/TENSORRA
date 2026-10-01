alter table public.profiles add column if not exists allow_training boolean not null default false;
create table if not exists public.message_feedback (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  message_id uuid not null references public.messages(id) on delete cascade,
  rating smallint not null check (rating in (-1,1)),
  correction text,
  mode text check (mode in ('fast','balanced','deep','max')),
  model_name text,
  eligible_for_training boolean not null default false,
  created_at timestamptz not null default now(),
  unique(user_id,message_id)
);
create index feedback_user_created_idx on public.message_feedback(user_id,created_at desc);
create index feedback_message_idx on public.message_feedback(message_id);
alter table public.message_feedback enable row level security;
create policy feedback_select_own on public.message_feedback for select to authenticated using ((select auth.uid())=user_id);
create policy feedback_insert_own on public.message_feedback for insert to authenticated with check ((select auth.uid())=user_id and exists(select 1 from public.messages m where m.id=message_id and m.user_id=(select auth.uid()) and m.role='assistant'));
create policy feedback_update_own on public.message_feedback for update to authenticated using ((select auth.uid())=user_id) with check ((select auth.uid())=user_id);
create policy feedback_delete_own on public.message_feedback for delete to authenticated using ((select auth.uid())=user_id);
grant select,insert,update,delete on public.message_feedback to authenticated;
