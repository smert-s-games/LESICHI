-- Run once in Supabase SQL Editor.
-- Speakers live in their own table. Existing session names are copied in.

create table if not exists public.speakers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  origin text,
  bio text,
  topic text,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.sessions
  add column if not exists speaker_id uuid references public.speakers (id) on delete set null;

insert into public.speakers (name, topic)
select distinct trim(s.speaker_name), nullif(trim(s.room), '')
from public.sessions s
where s.speaker_name is not null
  and trim(s.speaker_name) <> ''
  and not exists (
    select 1 from public.speakers sp
    where lower(sp.name) = lower(trim(s.speaker_name))
  );

update public.sessions s
set speaker_id = sp.id
from public.speakers sp
where s.speaker_id is null
  and lower(trim(s.speaker_name)) = lower(sp.name);

alter table public.speakers enable row level security;

drop policy if exists "speakers_select_public" on public.speakers;
create policy "speakers_select_public"
  on public.speakers for select
  using (is_active or public.is_admin());

drop policy if exists "speakers_admin_write" on public.speakers;
create policy "speakers_admin_write"
  on public.speakers for all
  using (public.is_admin())
  with check (public.is_admin());

grant select on public.speakers to anon, authenticated;
grant insert, update, delete on public.speakers to authenticated;
