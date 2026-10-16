-- Job file attachments. Files live in the private storage bucket "job-files"; one row per file here.
-- A file belongs to a job, and usually to one record on it (an invoice, change order, subcontract, ...).
-- record_table/record_id empty = a general job file (uploaded from the Files tab).
-- Storage path: <project_id>/<record_table or 'job'>/<record_id or 'general'>/<random>-<file name>

insert into storage.buckets (id, name, public, file_size_limit)
values ('job-files', 'job-files', false, 52428800)          -- 50 MB per file (free-plan cap)
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit;

create policy "job-files read"   on storage.objects for select to authenticated using (bucket_id = 'job-files' and (select public.is_sdr_user()));
create policy "job-files upload" on storage.objects for insert to authenticated with check (bucket_id = 'job-files' and (select public.is_sdr_user()));
create policy "job-files update" on storage.objects for update to authenticated using (bucket_id = 'job-files' and (select public.is_sdr_user())) with check (bucket_id = 'job-files' and (select public.is_sdr_user()));
create policy "job-files delete" on storage.objects for delete to authenticated using (bucket_id = 'job-files' and (select public.is_sdr_user()));

create table public.attachments (
  id            uuid primary key default gen_random_uuid(),
  project_id    uuid not null references public.projects(id) on delete cascade,
  record_table  text,                 -- e.g. 'invoices', 'change_orders'; null = general job file
  record_id     uuid,
  folder        text,                 -- optional label for general files (Drawings, Permits, ...)
  storage_path  text not null unique,
  filename      text not null,
  size_bytes    bigint,
  mime          text,
  note          text,
  uploaded_by   text default (auth.jwt() ->> 'email'),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index attachments_project_idx on public.attachments(project_id);
create index attachments_record_idx on public.attachments(record_table, record_id);
create trigger trg_attachments_updated before update on public.attachments for each row execute function public.set_updated_at();
alter table public.attachments replica identity full;
alter publication supabase_realtime add table public.attachments;
alter table public.attachments enable row level security;
create policy "sdr read attachments"   on public.attachments for select to authenticated using ((select public.is_sdr_user()));
create policy "sdr insert attachments" on public.attachments for insert to authenticated with check ((select public.is_sdr_user()));
create policy "sdr update attachments" on public.attachments for update to authenticated using ((select public.is_sdr_user())) with check ((select public.is_sdr_user()));
create policy "sdr delete attachments" on public.attachments for delete to authenticated using ((select public.is_sdr_user()));
