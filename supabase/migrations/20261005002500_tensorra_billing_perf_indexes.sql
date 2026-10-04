create index if not exists billing_events_user_id_idx
  on private.billing_events(user_id)
  where user_id is not null;

create index if not exists attachments_message_id_idx
  on public.attachments(message_id)
  where message_id is not null;
