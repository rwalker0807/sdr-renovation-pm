-- Job classification, project vendor assignments, vendor location, Trello custom fields.

-- ---------- projects: job type + type-specific fields ----------
alter table public.projects
  add column job_type text not null default 'renovation' check (job_type in ('renovation','loss','gc')),
  add column billed_to text,
  -- Water / fire loss
  add column loss_type text,
  add column loss_date date,
  add column claim_number text,
  add column carrier text,
  add column xactimate_amount numeric(14,2),
  add column ems_amount numeric(14,2),
  add column rebuild_amount numeric(14,2),
  add column encircle_url text,
  -- GC
  add column invoice_amount numeric(14,2),
  add column scope_description text,
  add column po_number text,
  add column invoiced_date date;

-- ---------- vendors: city / state ----------
alter table public.vendors add column city text, add column state text;

-- ---------- vendors assigned to a project ----------
create table public.project_vendors (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references public.projects(id) on delete cascade,
  vendor_id   uuid not null references public.vendors(id) on delete cascade,
  role        text,                 -- what they're doing on this job (defaults to their trade)
  amount      numeric(14,2),        -- quoted / agreed amount, optional
  notes       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (project_id, vendor_id)
);
create index on public.project_vendors (vendor_id);
create trigger trg_project_vendors_updated before update on public.project_vendors for each row execute function public.set_updated_at();
alter table public.project_vendors replica identity full;
alter publication supabase_realtime add table public.project_vendors;
alter table public.project_vendors enable row level security;
create policy "sdr read project_vendors"   on public.project_vendors for select to authenticated using ((select public.is_sdr_user()));
create policy "sdr insert project_vendors" on public.project_vendors for insert to authenticated with check ((select public.is_sdr_user()));
create policy "sdr update project_vendors" on public.project_vendors for update to authenticated using ((select public.is_sdr_user())) with check ((select public.is_sdr_user()));
create policy "sdr delete project_vendors" on public.project_vendors for delete to authenticated using ((select public.is_sdr_user()));

-- ---------- Trello card custom fields ----------
alter table public.trello_cards
  add column client text,
  add column invoice_to text,
  add column claim_id text,
  add column encircle_url text,
  add column custom_fields jsonb not null default '{}';
