-- SDR staff directory (everyone with an @sdandr.com address, plus shared mailboxes).
create table public.sdr_people (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  email         text unique,
  title         text,
  department    text,
  office_phone  text,
  mobile        text,
  location      text,
  kind          text not null default 'person' check (kind in ('person','shared')),
  active        boolean not null default true,
  notes         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create trigger trg_sdr_people_updated before update on public.sdr_people for each row execute function public.set_updated_at();
alter table public.sdr_people replica identity full;
alter publication supabase_realtime add table public.sdr_people;
alter table public.sdr_people enable row level security;
create policy "sdr read sdr_people"   on public.sdr_people for select to authenticated using ((select public.is_sdr_user()));
create policy "sdr insert sdr_people" on public.sdr_people for insert to authenticated with check ((select public.is_sdr_user()));
create policy "sdr update sdr_people" on public.sdr_people for update to authenticated using ((select public.is_sdr_user())) with check ((select public.is_sdr_user()));
create policy "sdr delete sdr_people" on public.sdr_people for delete to authenticated using ((select public.is_sdr_user()));
