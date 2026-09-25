-- Run in Supabase SQL Editor. Then add yourself as admin.
-- User id is in Authentication → Users (copy the UUID).

-- insert into public.admin_users (user_id) values ('PASTE-USER-UUID-HERE');

drop policy if exists "profiles_update_admin" on public.profiles;
create policy "profiles_update_admin"
  on public.profiles for update
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists "payments_admin_insert" on public.payments;
create policy "payments_admin_insert"
  on public.payments for insert
  with check (public.is_admin());
