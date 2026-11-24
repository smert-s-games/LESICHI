-- Lesichi: security + logic fixes.
-- Run ONCE in Supabase SQL Editor AFTER schema.sql / rebook.sql / admin.sql / speakers.sql.
-- Idempotent: safe to run again. Make a backup (Database -> Backups) before the first run.
--
-- What it does:
--  1. bookings can be changed only through RPC (book_session / cancel_booking / admin_*), not directly
--  2. payments cannot be created by the user; purchase_package is removed, orders are created
--     as 'pending' via create_order() and become sessions when admin sets status 'paid'
--  3. Zoom links moved to session_links: visible only to admins and to users booked on that session
--  4. Welcome session is given once per normalized email and only after the email is confirmed
--  5. claim_first_admin is removed (add admins manually, see docs/infrastructure.md)
--  6. book_session / cancel_booking rewritten (no past sessions, cancel deadline 2 h)
--  7. admin_delete_session / admin_set_booking_status refund sessions and recalc seats
--  8. leads: basic length limits
--  9. trigger functions closed for RPC, fixed search_path

begin;

-- ---------------------------------------------------------------- helpers
create or replace function public.normalize_email(p text)
returns text
language sql
immutable
as $$
  select case
    when split_part(lower(trim(p)), '@', 2) in ('gmail.com', 'googlemail.com')
      then replace(split_part(split_part(lower(trim(p)), '@', 1), '+', 1), '.', '') || '@gmail.com'
    else split_part(split_part(lower(trim(p)), '@', 1), '+', 1) || '@' || split_part(lower(trim(p)), '@', 2)
  end;
$$;

create or replace function public.recalc_session_status(p_session_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.sessions s
  set status = case
    when s.max_participants <= (
      select count(*) from public.bookings b
      where b.session_id = s.id and b.status = 'booked'
    ) then 'full'
    else 'open'
  end
  where s.id = p_session_id and s.status in ('open', 'full');
$$;

revoke all on function public.recalc_session_status(uuid) from public, anon, authenticated;

-- ------------------------------------------------- 1. bookings: RPC only
drop policy if exists "bookings_insert_own" on public.bookings;
drop policy if exists "bookings_update_own_or_admin" on public.bookings;
drop policy if exists "bookings_admin_write" on public.bookings;
create policy "bookings_admin_write"
  on public.bookings for all
  using (public.is_admin())
  with check (public.is_admin());

-- ---------------------------------------------- 2. payments / purchases
drop policy if exists "payments_insert_own" on public.payments;
drop function if exists public.purchase_package(text);

alter table public.user_packages
  add column if not exists payment_id uuid references public.payments (id) on delete set null;

create or replace function public.create_order(p_code text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_pkg public.packages%rowtype;
  v_pending int;
  v_id uuid;
begin
  if v_user is null then
    raise exception 'not authenticated';
  end if;
  select * into v_pkg from public.packages where code = p_code and is_active;
  if v_pkg.id is null then
    raise exception 'unknown package';
  end if;
  select count(*) into v_pending
  from public.payments where user_id = v_user and status = 'pending';
  if v_pending >= 5 then
    raise exception 'too many pending orders';
  end if;
  insert into public.payments (user_id, package_id, amount_byn, status, provider)
  values (v_user, v_pkg.id, v_pkg.price_byn, 'pending', 'manual')
  returning id into v_id;
  return v_id;
end;
$$;

revoke all on function public.create_order(text) from public, anon;
grant execute on function public.create_order(text) to authenticated;

create or replace function public.payments_before_update()
returns trigger
language plpgsql
as $$
begin
  if new.status = 'paid' and old.status <> 'paid' and new.paid_at is null then
    new.paid_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists payments_before_update on public.payments;
create trigger payments_before_update
  before update of status on public.payments
  for each row execute function public.payments_before_update();

create or replace function public.payments_apply_status()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pkg public.packages%rowtype;
begin
  if new.status = 'paid' and old.status <> 'paid' then
    if new.package_id is not null
       and not exists (select 1 from public.user_packages where payment_id = new.id) then
      select * into v_pkg from public.packages where id = new.package_id;
      insert into public.user_packages
        (user_id, package_id, sessions_total, sessions_left, source, payment_id)
      values
        (new.user_id, new.package_id, v_pkg.sessions_count, v_pkg.sessions_count, 'purchase', new.id);
    end if;
  elsif new.status in ('refunded', 'failed') and old.status = 'paid' then
    update public.user_packages set sessions_left = 0 where payment_id = new.id;
  end if;
  return new;
end;
$$;

drop trigger if exists payments_apply_status on public.payments;
create trigger payments_apply_status
  after update of status on public.payments
  for each row execute function public.payments_apply_status();

-- ------------------------------------------------------- 3. zoom links
create table if not exists public.session_links (
  session_id uuid primary key references public.sessions (id) on delete cascade,
  zoom_url text not null,
  updated_at timestamptz not null default now()
);

alter table public.session_links enable row level security;

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'sessions' and column_name = 'zoom_url'
  ) then
    insert into public.session_links (session_id, zoom_url)
    select id, zoom_url from public.sessions
    where zoom_url is not null and trim(zoom_url) <> ''
    on conflict (session_id) do nothing;
  end if;
end $$;

drop view if exists public.sessions_with_seats;
alter table public.sessions drop column if exists zoom_url;

create view public.sessions_with_seats as
select
  s.id, s.title, s.room, s.speaker_name, s.speaker_id, s.starts_at,
  s.duration_min, s.max_participants, s.status, s.created_at,
  (s.max_participants - coalesce(b.cnt, 0))::int as seats_left
from public.sessions s
left join (
  select session_id, count(*)::int as cnt
  from public.bookings
  where status = 'booked'
  group by session_id
) b on b.session_id = s.id;

grant select on public.sessions_with_seats to anon, authenticated;

revoke all on public.session_links from anon;

drop policy if exists "session_links_select" on public.session_links;
create policy "session_links_select"
  on public.session_links for select
  using (
    public.is_admin()
    or exists (
      select 1 from public.bookings b
      where b.session_id = session_links.session_id
        and b.user_id = auth.uid()
        and b.status = 'booked'
    )
  );

drop policy if exists "session_links_admin_write" on public.session_links;
create policy "session_links_admin_write"
  on public.session_links for all
  using (public.is_admin())
  with check (public.is_admin());

-- ------------------------------------------ 4. welcome session (once)
create table if not exists public.welcome_claims (
  email_norm text primary key,
  user_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.welcome_claims enable row level security; -- no policies: only the function below touches it

-- people who already got the welcome session before this migration
insert into public.welcome_claims (email_norm, user_id)
select public.normalize_email(p.email), up.user_id
from public.user_packages up
join public.profiles p on p.id = up.user_id
where up.source = 'welcome' and p.email is not null
on conflict (email_norm) do nothing;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', '')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create or replace function public.claim_welcome_session()
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_email text;
  v_confirmed timestamptz;
  v_pkg public.packages%rowtype;
  v_rows int;
begin
  if v_user is null then
    raise exception 'not authenticated';
  end if;
  select email, email_confirmed_at into v_email, v_confirmed
  from auth.users where id = v_user;
  if v_confirmed is null then
    raise exception 'email not confirmed';
  end if;

  select * into v_pkg from public.packages where code = 'single';
  if v_pkg.id is null then
    raise exception 'package missing';
  end if;

  insert into public.welcome_claims (email_norm, user_id)
  values (public.normalize_email(v_email), v_user)
  on conflict (email_norm) do nothing;
  get diagnostics v_rows = row_count;
  if v_rows = 0 then
    return false;
  end if;

  insert into public.user_packages (user_id, package_id, sessions_total, sessions_left, source)
  values (v_user, v_pkg.id, 1, 1, 'welcome');
  return true;
end;
$$;

revoke all on function public.claim_welcome_session() from public, anon;
grant execute on function public.claim_welcome_session() to authenticated;

-- ------------------------------------------------- 5. first-admin hole
drop function if exists public.claim_first_admin();

-- --------------------------------------------- 6. book / cancel rewrite
create or replace function public.book_session(p_session_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_sess public.sessions%rowtype;
  v_existing public.bookings%rowtype;
  v_taken int;
  v_pkg uuid;
  v_booking uuid;
begin
  if v_user is null then
    raise exception 'not authenticated';
  end if;

  select * into v_sess from public.sessions where id = p_session_id for update;
  if v_sess.id is null or v_sess.status not in ('open', 'full') then
    raise exception 'session unavailable';
  end if;
  if v_sess.starts_at <= now() then
    raise exception 'already started';
  end if;

  select * into v_existing
  from public.bookings
  where session_id = p_session_id and user_id = v_user
  for update;
  if v_existing.id is not null and v_existing.status <> 'cancelled' then
    raise exception 'already booked';
  end if;

  select count(*)::int into v_taken
  from public.bookings
  where session_id = p_session_id and status = 'booked';
  if v_taken >= v_sess.max_participants then
    raise exception 'no seats';
  end if;

  select up.id into v_pkg
  from public.user_packages up
  where up.user_id = v_user
    and up.sessions_left > 0
    and (up.expires_at is null or up.expires_at > now())
  order by coalesce(up.expires_at, 'infinity'::timestamptz), up.created_at
  limit 1
  for update;
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

  update public.user_packages set sessions_left = sessions_left - 1 where id = v_pkg;
  perform public.recalc_session_status(p_session_id);
  return v_booking;
end;
$$;

create or replace function public.cancel_booking(p_booking_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_row public.bookings%rowtype;
  v_starts timestamptz;
begin
  if v_user is null then
    raise exception 'not authenticated';
  end if;

  select * into v_row
  from public.bookings
  where id = p_booking_id and user_id = v_user
  for update;
  if v_row.id is null then
    raise exception 'not found';
  end if;
  if v_row.status <> 'booked' then
    raise exception 'not booked';
  end if;

  select starts_at into v_starts from public.sessions where id = v_row.session_id;
  if v_starts is null or v_starts <= now() then
    raise exception 'already started';
  end if;
  -- cancellation deadline: 2 hours before start (change the interval if needed)
  if v_starts - interval '2 hours' <= now() then
    raise exception 'too late to cancel';
  end if;

  update public.bookings set status = 'cancelled' where id = v_row.id;
  if v_row.user_package_id is not null then
    update public.user_packages
    set sessions_left = least(sessions_total, sessions_left + 1)
    where id = v_row.user_package_id;
  end if;
  perform public.recalc_session_status(v_row.session_id);
end;
$$;

revoke all on function public.book_session(uuid) from public, anon;
revoke all on function public.cancel_booking(uuid) from public, anon;
grant execute on function public.book_session(uuid) to authenticated;
grant execute on function public.cancel_booking(uuid) to authenticated;

-- ------------------------------------------------ 7. admin operations
create or replace function public.admin_delete_session(p_session_id uuid)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  v_refunded int := 0;
begin
  if not public.is_admin() then
    raise exception 'forbidden';
  end if;
  for r in
    select id, user_package_id from public.bookings
    where session_id = p_session_id and status = 'booked'
    for update
  loop
    if r.user_package_id is not null then
      update public.user_packages
      set sessions_left = least(sessions_total, sessions_left + 1)
      where id = r.user_package_id;
    end if;
    v_refunded := v_refunded + 1;
  end loop;
  delete from public.sessions where id = p_session_id;
  return v_refunded;
end;
$$;

create or replace function public.admin_set_booking_status(p_booking_id uuid, p_status text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  b public.bookings%rowtype;
  v_max int;
  v_taken int;
  v_pkg uuid;
begin
  if not public.is_admin() then
    raise exception 'forbidden';
  end if;
  if p_status not in ('booked', 'cancelled', 'attended', 'no_show') then
    raise exception 'bad status';
  end if;

  select * into b from public.bookings where id = p_booking_id for update;
  if b.id is null then
    raise exception 'not found';
  end if;
  if b.status = p_status then
    return;
  end if;

  if b.status = 'booked' and p_status = 'cancelled' then
    if b.user_package_id is not null then
      update public.user_packages
      set sessions_left = least(sessions_total, sessions_left + 1)
      where id = b.user_package_id;
    end if;
  elsif b.status = 'cancelled' then
    if p_status <> 'booked' then
      raise exception 'invalid transition';
    end if;
    select max_participants into v_max from public.sessions where id = b.session_id for update;
    select count(*)::int into v_taken
    from public.bookings where session_id = b.session_id and status = 'booked';
    if v_taken >= v_max then
      raise exception 'no seats';
    end if;
    update public.user_packages
    set sessions_left = sessions_left - 1
    where id = b.user_package_id and sessions_left > 0
    returning id into v_pkg;
    if v_pkg is null then
      raise exception 'no sessions left';
    end if;
  end if;

  update public.bookings set status = p_status where id = b.id;
  perform public.recalc_session_status(b.session_id);
end;
$$;

revoke all on function public.admin_delete_session(uuid) from public, anon;
revoke all on function public.admin_set_booking_status(uuid, text) from public, anon;
grant execute on function public.admin_delete_session(uuid) to authenticated;
grant execute on function public.admin_set_booking_status(uuid, text) to authenticated;

-- ------------------------------------------------------- 8. leads
drop policy if exists "leads_insert_public" on public.leads;
create policy "leads_insert_public"
  on public.leads for insert
  with check (
    status = 'new'
    and char_length(contact) between 3 and 200
    and coalesce(char_length(name), 0) <= 200
    and coalesce(char_length(message), 0) <= 2000
  );

-- ------------------------------------- 9. function privileges / search_path
alter function public.normalize_email(text) set search_path = public;
alter function public.payments_before_update() set search_path = public;
alter function public.set_updated_at() set search_path = public;

-- trigger functions must not be callable through /rest/v1/rpc
revoke all on function public.handle_new_user() from public, anon, authenticated;
revoke all on function public.payments_apply_status() from public, anon, authenticated;
revoke all on function public.payments_before_update() from public, anon, authenticated;

commit;
