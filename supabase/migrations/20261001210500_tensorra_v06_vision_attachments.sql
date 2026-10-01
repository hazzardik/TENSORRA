create table if not exists public.attachments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  chat_id uuid references public.chats(id) on delete cascade,
  message_id uuid references public.messages(id) on delete set null,
  kind text not null default 'image' check (kind in ('image','file')),
  filename text not null,
  mime_type text not null,
  storage_path text not null,
  size_bytes bigint not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists attachments_user_created_idx on public.attachments(user_id, created_at desc);
create index if not exists attachments_chat_idx on public.attachments(chat_id, created_at);

alter table public.attachments enable row level security;

create policy attachments_select_own on public.attachments
for select to authenticated using ((select auth.uid()) = user_id);

create policy attachments_insert_own on public.attachments
for insert to authenticated
with check (
  (select auth.uid()) = user_id
  and (
    chat_id is null
    or exists (
      select 1 from public.chats c
      where c.id = chat_id and c.user_id = (select auth.uid())
    )
  )
);

create policy attachments_delete_own on public.attachments
for delete to authenticated using ((select auth.uid()) = user_id);

grant select, insert, delete on public.attachments to authenticated;

update storage.buckets
set allowed_mime_types = array[
  'application/pdf','text/plain','text/markdown','application/json',
  'image/jpeg','image/png','image/webp'
]
where id = 'tensorra-files';
