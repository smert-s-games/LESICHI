-- Run once in Supabase SQL Editor.
-- Lets a cancelled booking be booked again instead of hitting the unique key.

create or replace function public.book_session(p_session_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_pkg uuid;
  v_seats int;
  v_booking uuid;
  v_existing public.bookings%rowtype;
begin
  if v_user is null then
    raise exception 'not authenticated';
  end if;

  select (
    s.max_participants - coalesce((
      select count(*)::int from public.bookings b
      where b.session_id = s.id and b.status = 'booked'
    ), 0)
  )
  into v_seats
  from public.sessions s
  where s.id = p_session_id and s.status in ('open', 'full')
  for update;

  if v_seats is null or v_seats < 1 then
    raise exception 'no seats';
  end if;

  select * into v_existing
  from public.bookings
  where session_id = p_session_id and user_id = v_user
  for update;

  if v_existing.id is not null and v_existing.status = 'booked' then
    raise exception 'already booked';
  end if;

  select up.id into v_pkg
  from public.user_packages up
  where up.user_id = v_user
    and up.sessions_left > 0
    and (up.expires_at is null or up.expires_at > now())
  order by up.created_at
  for update
  limit 1;

  if v_pkg is null then
    raise exception 'no sessions left';
  end if;

  if v_existing.id is not null then
    update public.bookings
    set status = 'booked', user_package_id = v_pkg
    where id = v_existing.id
    returning id into v_booking;
  else
    insert into public.bookings (session_id, user_id, user_package_id, status)
    values (p_session_id, v_user, v_pkg, 'booked')
    returning id into v_booking;
  end if;

  update public.user_packages
  set sessions_left = sessions_left - 1
  where id = v_pkg;

  update public.sessions s
  set status = case
    when s.max_participants <= (
      select count(*) from public.bookings b
      where b.session_id = p_session_id and b.status = 'booked'
    ) then 'full'
    else 'open'
  end
  where s.id = p_session_id;

  return v_booking;
end;
$$;

grant execute on function public.book_session(uuid) to authenticated;
