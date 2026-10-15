-- =====================================================================
-- SDR Renovation PM — core schema
-- Run in Supabase SQL editor (or `supabase db push`).
-- Every project-scoped table carries project_id so one database serves
-- all renovation projects.
-- =====================================================================

-- gen_random_uuid() is built into Postgres 13+

-- ---------- helpers ----------
create or replace function public.set_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at = now();
  return new;
end $$;

-- Only signed-in users with an SDR email can see or change data.
-- To admit outside users (owner reps, lenders), replace with a project_members check.
create or replace function public.is_sdr_user() returns boolean
language sql stable set search_path = '' as $$
  select coalesce(lower(auth.jwt() ->> 'email') like '%@sdandr.com', false)
$$;

-- ---------- reference tables ----------
create table projects (
  id                uuid primary key default gen_random_uuid(),
  code              text unique,                -- e.g. 26-327
  name              text not null,
  address           text,
  client            text,
  contract_value    numeric(14,2) default 0,
  start_date        date,
  target_completion date,
  status            text not null default 'active'
                    check (status in ('precon','active','closeout','complete','on_hold')),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create table vendors (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  trade         text,
  contact_name  text,
  email         text,
  phone         text,
  coi_expires   date,
  license_no    text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- ---------- budget ----------
create table budget_lines (
  id               uuid primary key default gen_random_uuid(),
  project_id       uuid not null references projects(id) on delete cascade,
  cost_code        text not null,               -- e.g. 09-6500
  division         text,                        -- CSI division / category
  description      text not null,
  original_budget  numeric(14,2) not null default 0,
  notes            text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (project_id, cost_code)
);

-- ---------- buyout ----------
create table buyout_packages (
  id                 uuid primary key default gen_random_uuid(),
  project_id         uuid not null references projects(id) on delete cascade,
  budget_line_id     uuid references budget_lines(id) on delete set null,
  package            text not null,             -- scope package name
  budget_amount      numeric(14,2) default 0,
  bid_due            date,
  target_award       date,
  status             text not null default 'not_started'
                     check (status in ('not_started','bidding','leveling','awarded','contracted')),
  bids_received      int default 0,
  awarded_vendor_id  uuid references vendors(id) on delete set null,
  awarded_amount     numeric(14,2),
  notes              text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

-- ---------- subcontracts & purchase orders ----------
create table commitments (
  id                 uuid primary key default gen_random_uuid(),
  project_id         uuid not null references projects(id) on delete cascade,
  kind               text not null default 'subcontract' check (kind in ('subcontract','po')),
  number             text,                      -- SC-001 / PO-014
  vendor_id          uuid references vendors(id) on delete set null,
  budget_line_id     uuid references budget_lines(id) on delete set null,
  buyout_package_id  uuid references buyout_packages(id) on delete set null,
  description        text,
  amount             numeric(14,2) not null default 0,
  retainage_pct      numeric(5,2) default 10,
  status             text not null default 'draft'
                     check (status in ('draft','out_for_signature','executed','closed')),
  executed_date      date,
  coi_received       boolean default false,
  scope_doc_url      text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create table change_orders (
  id              uuid primary key default gen_random_uuid(),
  project_id      uuid not null references projects(id) on delete cascade,
  co_number       text,
  kind            text not null check (kind in ('owner','sub')),  -- owner CO = budget; sub CO = cost
  budget_line_id  uuid references budget_lines(id) on delete set null,
  commitment_id   uuid references commitments(id) on delete set null,
  description     text,
  amount          numeric(14,2) not null default 0,
  status          text not null default 'pending' check (status in ('pending','approved','rejected')),
  co_date         date,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- ---------- materials ----------
create table material_buys (
  id              uuid primary key default gen_random_uuid(),
  project_id      uuid not null references projects(id) on delete cascade,
  budget_line_id  uuid references budget_lines(id) on delete set null,
  vendor_id       uuid references vendors(id) on delete set null,
  item            text not null,
  quantity        numeric(12,2) default 0,
  unit            text,
  unit_cost       numeric(12,2) default 0,
  po_number       text,
  order_date      date,
  need_by         date,
  delivered_date  date,
  status          text not null default 'quoted'
                  check (status in ('quoted','ordered','shipped','delivered','installed')),
  location        text,                         -- where it's staged / building
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- ---------- invoices / pay apps ----------
create table invoices (
  id              uuid primary key default gen_random_uuid(),
  project_id      uuid not null references projects(id) on delete cascade,
  vendor_id       uuid references vendors(id) on delete set null,
  commitment_id   uuid references commitments(id) on delete set null,
  budget_line_id  uuid references budget_lines(id) on delete set null,
  invoice_number  text,
  invoice_date    date,
  period_end      date,
  amount          numeric(14,2) not null default 0,
  retainage_held  numeric(14,2) default 0,
  status          text not null default 'received'
                  check (status in ('received','approved','paid','disputed')),
  paid_date       date,
  file_url        text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- ---------- onsite progress ----------
create table progress (
  id            uuid primary key default gen_random_uuid(),
  project_id    uuid not null references projects(id) on delete cascade,
  building      text not null,                  -- "Bldg 01"
  unit          text,                           -- optional unit-level tracking
  activity      text not null,                  -- "Roofing", "Kitchens", ...
  pct_complete  numeric(5,2) not null default 0 check (pct_complete between 0 and 100),
  status        text default 'not_started'
                check (status in ('not_started','in_progress','complete','blocked')),
  updated_by    text,
  notes         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (project_id, building, unit, activity)
);

-- ---------- scope gaps ----------
create table scope_gaps (
  id              uuid primary key default gen_random_uuid(),
  project_id      uuid not null references projects(id) on delete cascade,
  title           text not null,
  description     text,
  trade_a         text,                         -- the two scopes the gap sits between
  trade_b         text,
  budget_line_id  uuid references budget_lines(id) on delete set null,
  est_cost        numeric(14,2) default 0,
  status          text not null default 'open'
                  check (status in ('open','assigned','priced','resolved')),
  owner           text,
  resolution      text,
  raised_date     date default current_date,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- ---------- specs & scopes ----------
create table specs (
  id            uuid primary key default gen_random_uuid(),
  project_id    uuid not null references projects(id) on delete cascade,
  section       text not null,                  -- CSI section, e.g. 07 31 13
  title         text not null,
  product       text,
  manufacturer  text,
  revision      text,
  status        text default 'draft' check (status in ('draft','issued','approved','superseded')),
  doc_url       text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table scopes (
  id              uuid primary key default gen_random_uuid(),
  project_id      uuid not null references projects(id) on delete cascade,
  trade           text not null,
  commitment_id   uuid references commitments(id) on delete set null,
  inclusions      text,
  exclusions      text,
  clarifications  text,
  revision        text,
  doc_url         text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- ---------- indexes ----------
create index on budget_lines (project_id);
create index on buyout_packages (project_id);
create index on commitments (project_id);
create index on change_orders (project_id);
create index on material_buys (project_id);
create index on invoices (project_id);
create index on progress (project_id);
create index on scope_gaps (project_id);
create index on specs (project_id);
create index on scopes (project_id);
-- foreign-key lookups
create index on buyout_packages (budget_line_id);
create index on buyout_packages (awarded_vendor_id);
create index on commitments (vendor_id);
create index on commitments (budget_line_id);
create index on commitments (buyout_package_id);
create index on change_orders (budget_line_id);
create index on change_orders (commitment_id);
create index on material_buys (budget_line_id);
create index on material_buys (vendor_id);
create index on invoices (vendor_id);
create index on invoices (commitment_id);
create index on invoices (budget_line_id);
create index on scope_gaps (budget_line_id);
create index on scopes (commitment_id);

-- ---------- updated_at triggers, realtime, RLS ----------
do $$
declare t text;
begin
  foreach t in array array['projects','vendors','budget_lines','buyout_packages','commitments',
                           'change_orders','material_buys','invoices','progress','scope_gaps',
                           'specs','scopes']
  loop
    execute format('create trigger trg_%1$s_updated before update on %1$I
                    for each row execute function public.set_updated_at()', t);
    -- full row on delete/update so realtime clients get project_id
    execute format('alter table %I replica identity full', t);
    execute format('alter publication supabase_realtime add table %I', t);
    -- Starter policy: any signed-in @sdandr.com user can read/write.
    -- Tighten later with a project_members table + roles (see README).
    execute format('alter table %I enable row level security', t);
    execute format('create policy "sdr read %1$s"  on %1$I for select to authenticated using ((select public.is_sdr_user()))', t);
    execute format('create policy "sdr insert %1$s" on %1$I for insert to authenticated with check ((select public.is_sdr_user()))', t);
    execute format('create policy "sdr update %1$s" on %1$I for update to authenticated using ((select public.is_sdr_user())) with check ((select public.is_sdr_user()))', t);
    execute format('create policy "sdr delete %1$s" on %1$I for delete to authenticated using ((select public.is_sdr_user()))', t);
  end loop;
end $$;

-- =====================================================================
-- Reporting view: cost-code rollup (mirrors src/lib/rollups.ts).
-- Useful for Power BI / Excel connections straight to the database.
-- =====================================================================
create or replace view budget_rollup with (security_invoker = true) as
with
  owner_co as (
    select budget_line_id, sum(amount) amt from change_orders
    where kind = 'owner' and status = 'approved' group by 1),
  sub_co as (
    select budget_line_id,
           sum(amount) filter (where status = 'approved') approved,
           sum(amount) filter (where status = 'pending')  pending
    from change_orders where kind = 'sub' group by 1),
  commits as (
    select budget_line_id, sum(amount) amt from commitments
    where status <> 'draft' group by 1),
  mats as (
    select budget_line_id, sum(quantity * unit_cost) amt from material_buys
    where status <> 'quoted' group by 1),
  unbought as (
    select budget_line_id, sum(budget_amount) amt from buyout_packages
    where status not in ('awarded','contracted') group by 1),
  gaps as (
    select budget_line_id, sum(est_cost) amt from scope_gaps
    where status <> 'resolved' group by 1),
  inv as (
    select budget_line_id, sum(amount) invoiced,
           sum(amount) filter (where status = 'paid') paid
    from invoices group by 1)
select
  b.project_id, b.id as budget_line_id, b.cost_code, b.division, b.description,
  b.original_budget,
  coalesce(o.amt,0)                                        as approved_owner_changes,
  b.original_budget + coalesce(o.amt,0)                    as revised_budget,
  coalesce(c.amt,0) + coalesce(s.approved,0) + coalesce(m.amt,0) as committed,
  coalesce(u.amt,0)                                        as unbought,
  coalesce(g.amt,0) + coalesce(s.pending,0)                as exposure,
  coalesce(i.invoiced,0)                                   as invoiced,
  coalesce(i.paid,0)                                       as paid
from budget_lines b
left join owner_co o on o.budget_line_id = b.id
left join sub_co   s on s.budget_line_id = b.id
left join commits  c on c.budget_line_id = b.id
left join mats     m on m.budget_line_id = b.id
left join unbought u on u.budget_line_id = b.id
left join gaps     g on g.budget_line_id = b.id
left join inv      i on i.budget_line_id = b.id;
