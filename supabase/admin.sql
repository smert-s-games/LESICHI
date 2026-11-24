-- Run once in Supabase SQL Editor.
-- Lets users see their own admin flag and lets admins edit profiles / add payments.
-- NOTE: claim_first_admin() was removed on purpose (see hardening.sql). Add admins manually:
--   insert into public.admin_users (user_id) values ('<uuid>');

drop policy if exists "admin_users_select_admin" on public.admin_users;
create policy "admin_users_select_admin"
  on public.admin_users for select
  using (user_id = auth.uid() or public.is_admin());

drop policy if exists "profiles_update_admin" on public.profiles;
create policy "profiles_update_admin"
  on public.profiles for update
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists "payments_admin_insert" on public.payments;
create policy "payments_admin_insert"
  on public.payments for insert
  with check (public.is_admin());
