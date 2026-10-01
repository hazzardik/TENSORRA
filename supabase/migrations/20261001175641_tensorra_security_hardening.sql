revoke update on public.profiles from authenticated;
grant update (display_name,avatar_url,allow_training) on public.profiles to authenticated;

drop policy if exists feedback_insert_own on public.message_feedback;
create policy feedback_insert_own on public.message_feedback for insert to authenticated
with check (
  (select auth.uid())=user_id
  and exists(select 1 from public.messages m where m.id=message_id and m.user_id=(select auth.uid()) and m.role='assistant')
  and eligible_for_training=coalesce((select p.allow_training from public.profiles p where p.id=(select auth.uid())),false)
);

drop policy if exists feedback_update_own on public.message_feedback;
create policy feedback_update_own on public.message_feedback for update to authenticated
using ((select auth.uid())=user_id)
with check (
  (select auth.uid())=user_id
  and eligible_for_training=coalesce((select p.allow_training from public.profiles p where p.id=(select auth.uid())),false)
);

create or replace function private.handle_new_user()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  insert into public.profiles(id,display_name)
  values(new.id,coalesce(new.raw_user_meta_data->>'display_name',split_part(coalesce(new.email,''),'@',1)))
  on conflict(id) do nothing;
  insert into public.subscriptions(user_id,plan,status) values(new.id,'free','active') on conflict(user_id) do nothing;
  return new;
end;
$$;
revoke all on function private.handle_new_user() from public,anon,authenticated;
