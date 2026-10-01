-- Run only from a trusted server/admin connection.
-- Exports explicitly opt-in rated assistant examples for future TENSORRA fine-tuning.
select
  f.id as feedback_id,
  f.rating,
  f.correction,
  f.mode,
  f.model_name,
  m.chat_id,
  m.content as assistant_answer,
  (
    select um.content
    from public.messages um
    where um.chat_id = m.chat_id
      and um.user_id = m.user_id
      and um.role = 'user'
      and um.created_at < m.created_at
    order by um.created_at desc
    limit 1
  ) as user_prompt,
  f.created_at
from public.message_feedback f
join public.messages m on m.id = f.message_id
join public.profiles p on p.id = f.user_id
where p.allow_training = true
  and f.eligible_for_training = true
  and m.role = 'assistant'
order by f.created_at;
