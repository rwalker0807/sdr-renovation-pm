-- Tasks shown in "Needs attention" (home page = all jobs, job dashboard = that job), assignable to someone in the SDR Directory.
-- project_id empty = a company-wide task (shows on the home page only).
create table public.tasks (
  id            uuid primary key default gen_random_uuid(),
  project_id    uuid references public.projects(id) on delete cascade,
  title         text not null,
  notes         text,
  assignee_id   uuid references public.sdr_people(id) on delete set null,
  due_date      date,
  priority      text not null default 'normal' check (priority in ('normal','high')),
  status        text not null default 'open' check (status in ('open','done')),
  completed_at  timestamptz,
  created_by    text default (auth.jwt() ->> 'email'),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index tasks_project_idx on public.tasks(project_id);
create index tasks_assignee_idx on public.tasks(assignee_id);
create trigger trg_tasks_updated before update on public.tasks for each row execute function public.set_updated_at();
alter table public.tasks replica identity full;
alter publication supabase_realtime add table public.tasks;
alter table public.tasks enable row level security;
create policy "sdr read tasks"   on public.tasks for select to authenticated using ((select public.is_sdr_user()));
create policy "sdr insert tasks" on public.tasks for insert to authenticated with check ((select public.is_sdr_user()));
create policy "sdr update tasks" on public.tasks for update to authenticated using ((select public.is_sdr_user())) with check ((select public.is_sdr_user()));
create policy "sdr delete tasks" on public.tasks for delete to authenticated using ((select public.is_sdr_user()));
