-- Apply after hardening.sql and before entering group levels in the admin panel.
begin;

alter table public.sessions add column if not exists level text;

create or replace view public.sessions_with_seats as
select
  s.id, s.title, s.room, s.speaker_name, s.speaker_id, s.starts_at,
  s.duration_min, s.max_participants, s.status, s.created_at,
  (s.max_participants - coalesce(b.cnt, 0))::int as seats_left,
  s.level
from public.sessions s
left join (
  select session_id, count(*)::int as cnt
  from public.bookings
  where status = 'booked'
  group by session_id
) b on b.session_id = s.id;

commit;
