-- Run once in Supabase SQL Editor.
-- Makes the first logged-in user an admin if admin_users is empty,
-- and lets users see their own admin flag.

drop policy if exists "admin_users_select_admin" on public.admin_users;
create policy "admin_users_select_admin"
  on public.admin_users for select
  using (user_id = auth.uid() or public.is_admin());

create or replace function public.claim_first_admin()
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    return false;
  end if;
  if exists (select 1 from public.admin_users) then
    return exists (select 1 from public.admin_users where user_id = auth.uid());
  end if;
  insert into public.admin_users (user_id) values (auth.uid());
  return true;
end;
$$;

revoke all on function public.claim_first_admin() from public;
grant execute on function public.claim_first_admin() to authenticated;

drop policy if exists "profiles_update_admin" on public.profiles;
create policy "profiles_update_admin"
  on public.profiles for update
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists "payments_admin_insert" on public.payments;
create policy "payments_admin_insert"
  on public.payments for insert
  with check (public.is_admin());
