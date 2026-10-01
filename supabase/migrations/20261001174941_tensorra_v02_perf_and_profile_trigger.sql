create index if not exists document_chunks_user_idx on public.document_chunks(user_id);
create index if not exists memories_source_chat_idx on public.memories(source_chat_id);
create index if not exists usage_events_chat_idx on public.usage_events(chat_id);

create or replace function private.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id,display_name)
  values (new.id,coalesce(new.raw_user_meta_data->>'display_name',split_part(coalesce(new.email,''),'@',1)))
  on conflict (id) do nothing;
  insert into public.subscriptions (user_id,plan,status) values (new.id,'free','active') on conflict (user_id) do nothing;
  return new;
end;
$$;
revoke all on function private.handle_new_user() from public,anon,authenticated;
create trigger on_auth_user_created_tensorra after insert on auth.users for each row execute function private.handle_new_user();
