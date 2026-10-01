create extension if not exists vector with schema extensions;
create schema if not exists private;

create or replace function private.set_updated_at()
returns trigger language plpgsql set search_path = public as $$
begin new.updated_at = now(); return new; end;
$$;
revoke all on function private.set_updated_at() from public, anon, authenticated;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  avatar_url text,
  plan text not null default 'free' check (plan in ('free','plus','pro','team')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.chats (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null default 'New chat',
  mode text not null default 'balanced' check (mode in ('fast','balanced','deep','max')),
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  chat_id uuid not null references public.chats(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('user','assistant','system','tool')),
  content text not null,
  model_name text,
  input_tokens integer,
  output_tokens integer,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table public.memories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  source_chat_id uuid references public.chats(id) on delete set null,
  category text not null default 'fact',
  content text not null,
  importance smallint not null default 5 check (importance between 1 and 10),
  embedding extensions.vector(384),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  last_used_at timestamptz
);

create table public.documents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  filename text not null,
  mime_type text,
  storage_path text,
  size_bytes bigint,
  status text not null default 'pending' check (status in ('pending','processing','ready','failed')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table public.document_chunks (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.documents(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  chunk_index integer not null,
  content text not null,
  token_count integer,
  embedding extensions.vector(384),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique(document_id, chunk_index)
);

create table public.usage_events (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  chat_id uuid references public.chats(id) on delete set null,
  event_type text not null,
  provider text,
  model_name text,
  input_tokens integer,
  output_tokens integer,
  latency_ms integer,
  estimated_cost_usd numeric(12,6),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table public.subscriptions (
  user_id uuid primary key references auth.users(id) on delete cascade,
  plan text not null default 'free' check (plan in ('free','plus','pro','team')),
  status text not null default 'active',
  provider text,
  external_customer_id text,
  external_subscription_id text,
  current_period_end timestamptz,
  updated_at timestamptz not null default now()
);

create index chats_user_updated_idx on public.chats(user_id, updated_at desc);
create index messages_chat_created_idx on public.messages(chat_id, created_at);
create index messages_user_created_idx on public.messages(user_id, created_at desc);
create index memories_user_created_idx on public.memories(user_id, created_at desc);
create index documents_user_created_idx on public.documents(user_id, created_at desc);
create index chunks_document_idx on public.document_chunks(document_id, chunk_index);
create index usage_user_created_idx on public.usage_events(user_id, created_at desc);
create index memories_embedding_hnsw on public.memories using hnsw (embedding extensions.vector_cosine_ops);
create index chunks_embedding_hnsw on public.document_chunks using hnsw (embedding extensions.vector_cosine_ops);

create trigger profiles_set_updated_at before update on public.profiles for each row execute function private.set_updated_at();
create trigger chats_set_updated_at before update on public.chats for each row execute function private.set_updated_at();
create trigger subscriptions_set_updated_at before update on public.subscriptions for each row execute function private.set_updated_at();

alter table public.profiles enable row level security;
alter table public.chats enable row level security;
alter table public.messages enable row level security;
alter table public.memories enable row level security;
alter table public.documents enable row level security;
alter table public.document_chunks enable row level security;
alter table public.usage_events enable row level security;
alter table public.subscriptions enable row level security;

create policy profiles_select_own on public.profiles for select to authenticated using ((select auth.uid()) = id);
create policy profiles_insert_own on public.profiles for insert to authenticated with check ((select auth.uid()) = id);
create policy profiles_update_own on public.profiles for update to authenticated using ((select auth.uid()) = id) with check ((select auth.uid()) = id);
create policy chats_select_own on public.chats for select to authenticated using ((select auth.uid()) = user_id);
create policy chats_insert_own on public.chats for insert to authenticated with check ((select auth.uid()) = user_id);
create policy chats_update_own on public.chats for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy chats_delete_own on public.chats for delete to authenticated using ((select auth.uid()) = user_id);
create policy messages_select_own on public.messages for select to authenticated using ((select auth.uid()) = user_id and exists (select 1 from public.chats c where c.id = chat_id and c.user_id = (select auth.uid())));
create policy messages_insert_own on public.messages for insert to authenticated with check ((select auth.uid()) = user_id and exists (select 1 from public.chats c where c.id = chat_id and c.user_id = (select auth.uid())));
create policy messages_delete_own on public.messages for delete to authenticated using ((select auth.uid()) = user_id);
create policy memories_select_own on public.memories for select to authenticated using ((select auth.uid()) = user_id);
create policy memories_insert_own on public.memories for insert to authenticated with check ((select auth.uid()) = user_id);
create policy memories_update_own on public.memories for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy memories_delete_own on public.memories for delete to authenticated using ((select auth.uid()) = user_id);
create policy documents_select_own on public.documents for select to authenticated using ((select auth.uid()) = user_id);
create policy documents_insert_own on public.documents for insert to authenticated with check ((select auth.uid()) = user_id);
create policy documents_update_own on public.documents for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy documents_delete_own on public.documents for delete to authenticated using ((select auth.uid()) = user_id);
create policy chunks_select_own on public.document_chunks for select to authenticated using ((select auth.uid()) = user_id);
create policy chunks_insert_own on public.document_chunks for insert to authenticated with check ((select auth.uid()) = user_id and exists (select 1 from public.documents d where d.id = document_id and d.user_id = (select auth.uid())));
create policy chunks_delete_own on public.document_chunks for delete to authenticated using ((select auth.uid()) = user_id);
create policy usage_select_own on public.usage_events for select to authenticated using ((select auth.uid()) = user_id);
create policy subscriptions_select_own on public.subscriptions for select to authenticated using ((select auth.uid()) = user_id);

grant usage on schema public to authenticated;
grant select, insert, update, delete on public.profiles to authenticated;
grant select, insert, update, delete on public.chats to authenticated;
grant select, insert, delete on public.messages to authenticated;
grant select, insert, update, delete on public.memories to authenticated;
grant select, insert, update, delete on public.documents to authenticated;
grant select, insert, delete on public.document_chunks to authenticated;
grant select on public.usage_events to authenticated;
grant select on public.subscriptions to authenticated;

create function public.match_memories(query_embedding extensions.vector(384), match_count integer default 8, min_similarity double precision default 0.25)
returns table (id uuid, content text, category text, importance smallint, similarity double precision)
language sql stable security invoker set search_path = public, extensions as $$
  select m.id,m.content,m.category,m.importance,1-(m.embedding <=> query_embedding) similarity
  from public.memories m
  where m.user_id=(select auth.uid()) and m.embedding is not null and 1-(m.embedding <=> query_embedding)>=min_similarity
  order by m.embedding <=> query_embedding limit greatest(1,least(match_count,50));
$$;

create function public.match_document_chunks(query_embedding extensions.vector(384), match_count integer default 8, min_similarity double precision default 0.25)
returns table (id uuid, document_id uuid, content text, similarity double precision)
language sql stable security invoker set search_path = public, extensions as $$
  select c.id,c.document_id,c.content,1-(c.embedding <=> query_embedding) similarity
  from public.document_chunks c
  where c.user_id=(select auth.uid()) and c.embedding is not null and 1-(c.embedding <=> query_embedding)>=min_similarity
  order by c.embedding <=> query_embedding limit greatest(1,least(match_count,50));
$$;
revoke all on function public.match_memories(extensions.vector,integer,double precision) from public,anon;
grant execute on function public.match_memories(extensions.vector,integer,double precision) to authenticated;
revoke all on function public.match_document_chunks(extensions.vector,integer,double precision) from public,anon;
grant execute on function public.match_document_chunks(extensions.vector,integer,double precision) to authenticated;
