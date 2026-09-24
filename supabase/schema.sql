-- Lesichi MVP schema
-- Run once in Supabase SQL Editor

create extension if not exists "pgcrypto";

-- Profiles (1:1 with auth.users)
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text,
  full_name text,
  telegram text,
  level text default 'unknown',
  timezone text default 'Europe/Minsk',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', '')
  );
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Admins
create table if not exists public.admin_users (
  user_id uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer set search_path = public
as $$
  select exists (
    select 1 from public.admin_users au where au.user_id = auth.uid()
  );
$$;

-- Package catalog
create table if not exists public.packages (
  id uuid primary key default gen_random_uuid(),
  code text unique not null,
  title text not null,
  sessions_count int not null check (sessions_count > 0),
  price_byn numeric(10,2) not null check (price_byn >= 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

insert into public.packages (code, title, sessions_count, price_byn) values
  ('single', 'Разовый', 1, 15),
  ('pack4',  '4 созвона', 4, 50),
  ('pack8',  '8 созвонов', 8, 90)
on conflict (code) do nothing;

-- User packages
create table if not exists public.user_packages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  package_id uuid references public.packages (id),
  sessions_total int not null check (sessions_total > 0),
  sessions_left int not null check (sessions_left >= 0),
  source text default 'purchase',
  created_at timestamptz not null default now(),
  expires_at timestamptz
);

create index if not exists user_packages_user_idx on public.user_packages (user_id);

-- Sessions
create table if not exists public.sessions (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  room text,
  speaker_name text,
  starts_at timestamptz not null,
  duration_min int not null default 60,
  max_participants int not null default 6 check (max_participants > 0),
  zoom_url text,
  status text not null default 'open'
    check (status in ('open', 'full', 'done', 'cancelled')),
  created_at timestamptz not null default now()
);

create index if not exists sessions_starts_at_idx on public.sessions (starts_at);

-- Bookings
create table if not exists public.bookings (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  status text not null default 'booked'
    check (status in ('booked', 'cancelled', 'attended', 'no_show')),
  user_package_id uuid references public.user_packages (id),
  created_at timestamptz not null default now(),
  unique (session_id, user_id)
);

create index if not exists bookings_user_idx on public.bookings (user_id);
create index if not exists bookings_session_idx on public.bookings (session_id);

-- Payments
create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  package_id uuid references public.packages (id),
  amount_byn numeric(10,2) not null,
  currency text not null default 'BYN',
  status text not null default 'pending'
    check (status in ('pending', 'paid', 'failed', 'refunded')),
  provider text,
  provider_payment_id text,
  created_at timestamptz not null default now(),
  paid_at timestamptz
);

create index if not exists payments_user_idx on public.payments (user_id);

-- Leads
create table if not exists public.leads (
  id uuid primary key default gen_random_uuid(),
  name text,
  contact text not null,
  source text,
  message text,
  status text not null default 'new'
    check (status in ('new', 'contacted', 'converted', 'closed')),
  created_at timestamptz not null default now()
);

-- updated_at
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists profiles_updated_at on public.profiles;
create trigger profiles_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- RLS
alter table public.profiles enable row level security;
alter table public.admin_users enable row level security;
alter table public.packages enable row level security;
alter table public.user_packages enable row level security;
alter table public.sessions enable row level security;
alter table public.bookings enable row level security;
alter table public.payments enable row level security;
alter table public.leads enable row level security;

create policy "profiles_select_own_or_admin"
  on public.profiles for select
  using (id = auth.uid() or public.is_admin());

create policy "profiles_update_own"
  on public.profiles for update
  using (id = auth.uid())
  with check (id = auth.uid());

create policy "packages_select_all"
  on public.packages for select
  using (is_active = true or public.is_admin());

create policy "packages_admin_all"
  on public.packages for all
  using (public.is_admin())
  with check (public.is_admin());

create policy "user_packages_select_own"
  on public.user_packages for select
  using (user_id = auth.uid() or public.is_admin());

create policy "user_packages_admin_write"
  on public.user_packages for all
  using (public.is_admin())
  with check (public.is_admin());

create policy "sessions_select_public"
  on public.sessions for select
  using (true);

create policy "sessions_admin_write"
  on public.sessions for all
  using (public.is_admin())
  with check (public.is_admin());

create policy "bookings_select_own"
  on public.bookings for select
  using (user_id = auth.uid() or public.is_admin());

create policy "bookings_insert_own"
  on public.bookings for insert
  with check (user_id = auth.uid());

create policy "bookings_update_own_or_admin"
  on public.bookings for update
  using (user_id = auth.uid() or public.is_admin());

create policy "payments_select_own"
  on public.payments for select
  using (user_id = auth.uid() or public.is_admin());

create policy "payments_insert_own"
  on public.payments for insert
  with check (user_id = auth.uid());

create policy "payments_admin_update"
  on public.payments for update
  using (public.is_admin());

create policy "leads_insert_public"
  on public.leads for insert
  with check (true);

create policy "leads_admin_all"
  on public.leads for all
  using (public.is_admin())
  with check (public.is_admin());

create policy "admin_users_select_admin"
  on public.admin_users for select
  using (public.is_admin());

create or replace view public.sessions_with_seats as
select
  s.*,
  (s.max_participants - coalesce(b.cnt, 0))::int as seats_left
from public.sessions s
left join (
  select session_id, count(*)::int as cnt
  from public.bookings
  where status = 'booked'
  group by session_id
) b on b.session_id = s.id;
