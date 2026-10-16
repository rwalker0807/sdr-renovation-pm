-- Crew scheduler: the whole schedule (crew, vehicles, jobs, assignments) is one JSON document,
-- shared live between every signed-in SDR user.
create table public.crew_schedule (
  id text primary key,
  state jsonb not null,
  write_id text,             -- lets a browser ignore the echo of its own save
  updated_by text default (auth.jwt() ->> 'email'),
  updated_at timestamptz not null default now()
);
create trigger trg_crew_schedule_updated before update on public.crew_schedule for each row execute function public.set_updated_at();
alter table public.crew_schedule replica identity full;
alter publication supabase_realtime add table public.crew_schedule;
alter table public.crew_schedule enable row level security;
create policy "sdr read crew_schedule" on public.crew_schedule for select to authenticated using ((select public.is_sdr_user()));
create policy "sdr insert crew_schedule" on public.crew_schedule for insert to authenticated with check ((select public.is_sdr_user()));
create policy "sdr update crew_schedule" on public.crew_schedule for update to authenticated using ((select public.is_sdr_user())) with check ((select public.is_sdr_user()));
