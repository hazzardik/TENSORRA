alter table public.chats
  add column if not exists pinned_at timestamptz;

alter table public.chats
  alter column title set default 'Новый чат';

update public.chats
set title = 'Новый чат'
where title = 'New chat';

create index if not exists chats_user_pinned_updated_idx
  on public.chats(user_id, pinned_at desc nulls last, updated_at desc);

alter table public.documents
  add column if not exists source_chat_id uuid
  references public.chats(id) on delete cascade;

create index if not exists documents_source_chat_idx
  on public.documents(source_chat_id, created_at desc);
