alter table public.chats drop constraint if exists chats_mode_check;
alter table public.chats
  add constraint chats_mode_check check (mode in ('auto','fast','balanced','deep','max'));
alter table public.chats alter column mode set default 'auto';

create table if not exists public.tool_runs (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  chat_id uuid references public.chats(id) on delete set null,
  tool_name text not null,
  status text not null default 'ok' check (status in ('ok','error')),
  input jsonb not null default '{}'::jsonb,
  output_summary text,
  duration_ms integer,
  created_at timestamptz not null default now()
);

create index if not exists tool_runs_user_created_idx on public.tool_runs(user_id, created_at desc);
create index if not exists tool_runs_chat_idx on public.tool_runs(chat_id);
alter table public.tool_runs enable row level security;

create policy tool_runs_select_own on public.tool_runs
for select to authenticated using ((select auth.uid()) = user_id);
create policy tool_runs_insert_own on public.tool_runs
for insert to authenticated with check ((select auth.uid()) = user_id);
grant select, insert on public.tool_runs to authenticated;

create policy usage_insert_own on public.usage_events
for insert to authenticated with check ((select auth.uid()) = user_id);
grant insert on public.usage_events to authenticated;

create index if not exists document_chunks_fts_idx
on public.document_chunks using gin (to_tsvector('simple', content));

create or replace function public.search_document_chunks_lexical(
  query_text text,
  match_count integer default 8
)
returns table (id uuid, document_id uuid, content text, rank real)
language sql stable security invoker set search_path = public
as $$
  select c.id, c.document_id, c.content,
    ts_rank_cd(to_tsvector('simple', c.content), websearch_to_tsquery('simple', query_text)) as rank
  from public.document_chunks c
  where c.user_id = (select auth.uid())
    and to_tsvector('simple', c.content) @@ websearch_to_tsquery('simple', query_text)
  order by rank desc
  limit greatest(1, least(match_count, 30));
$$;
revoke all on function public.search_document_chunks_lexical(text, integer) from public, anon;
grant execute on function public.search_document_chunks_lexical(text, integer) to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('tensorra-files','tensorra-files',false,15728640,
  array['application/pdf','text/plain','text/markdown','application/json'])
on conflict (id) do update set
  public=excluded.public,
  file_size_limit=excluded.file_size_limit,
  allowed_mime_types=excluded.allowed_mime_types;

create policy tensorra_files_insert_own on storage.objects
for insert to authenticated
with check (bucket_id='tensorra-files' and (storage.foldername(name))[1]=(select auth.uid())::text);
create policy tensorra_files_select_own on storage.objects
for select to authenticated
using (bucket_id='tensorra-files' and (storage.foldername(name))[1]=(select auth.uid())::text);
create policy tensorra_files_delete_own on storage.objects
for delete to authenticated
using (bucket_id='tensorra-files' and (storage.foldername(name))[1]=(select auth.uid())::text);
