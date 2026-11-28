begin;

create table if not exists public.crm_clients (
  profile_id uuid primary key references public.profiles (id) on delete cascade,
  lead_id uuid unique references public.leads (id) on delete set null,
  stage text check (stage in (
    'registered', 'new', 'contacted', 'trial_booked', 'trial_attended',
    'awaiting_payment', 'paid', 'active', 'lapsed', 'returned'
  ))
);

alter table public.crm_clients enable row level security;
revoke all on table public.crm_clients from public, anon, authenticated;
grant select, insert, update on table public.crm_clients to authenticated;

drop policy if exists crm_clients_admin on public.crm_clients;
create policy crm_clients_admin on public.crm_clients
  for all to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

create or replace view public.crm_client_overview
with (security_invoker = true)
as
select
  p.id as profile_id,
  p.full_name,
  p.email,
  p.telegram,
  p.level,
  p.created_at,
  l.id as lead_id,
  l.contact as lead_contact,
  l.created_at as lead_created_at,
  c.stage as stage_override,
  trial.status as trial_status,
  trial.title as trial_title,
  trial.speaker_name as trial_speaker,
  latest_order.status as payment_status,
  latest_order.amount_byn,
  latest_order.package_title,
  case
    when latest_order.status = 'paid' then 'paid'
    when latest_order.status = 'pending' then 'awaiting_payment'
    when trial.status = 'attended' then 'trial_attended'
    when trial.status = 'booked' then 'trial_booked'
    when l.status = 'contacted' then 'contacted'
    when l.status = 'new' then 'new'
    else 'registered'
  end as suggested_stage
from public.profiles p
left join public.crm_clients c on c.profile_id = p.id
left join public.leads l on l.id = c.lead_id
left join lateral (
  select b.status, s.title, s.speaker_name
  from public.bookings b
  join public.user_packages up on up.id = b.user_package_id
  join public.sessions s on s.id = b.session_id
  where b.user_id = p.id and up.source = 'welcome'
  order by s.starts_at desc, b.id desc
  limit 1
) trial on true
left join lateral (
  select a.status, a.amount_byn, plan.title as package_title
  from public.payments a
  left join public.packages plan on plan.id = a.package_id
  where a.user_id = p.id
  order by a.created_at desc, a.id desc
  limit 1
) latest_order on true
where (select public.is_admin());

revoke all on table public.crm_client_overview from public, anon, authenticated;
grant select on table public.crm_client_overview to authenticated;

notify pgrst, 'reload schema';
commit;
