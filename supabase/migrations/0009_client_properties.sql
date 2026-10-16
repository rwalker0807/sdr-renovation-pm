-- Mirror of the Trello "Related Properties" board, shown as the Client Properties map tab.
-- Written only by the trello edge function (service role); SDR users can read it; streams over realtime.
create table public.client_property_lists (
  id text primary key, name text not null, pos numeric, closed boolean not null default false,
  updated_at timestamptz not null default now()
);
create table public.client_properties (
  id            text primary key,           -- Trello card id
  list_id       text,
  name          text not null,
  description   text,
  labels        jsonb not null default '[]',
  fields        jsonb not null default '[]', -- "**Key:** value" lines parsed from the description
  client        text,
  address       text,                        -- Trello location address, else the Address line in the description
  location_name text,
  lat           double precision,
  lng           double precision,
  geo_source    text,                        -- 'trello' (pin set on the card) or 'census' (looked up from the address)
  geo_address   text,                        -- address that lat/lng were looked up from
  checklists    jsonb not null default '[]',
  attachments   jsonb not null default '[]',
  members       jsonb not null default '[]',
  due           timestamptz,
  due_complete  boolean not null default false,
  closed        boolean not null default false,
  pos           numeric,
  short_url     text,
  last_activity timestamptz,
  updated_at    timestamptz not null default now()
);
create index on public.client_properties (list_id);

do $$
declare t text;
begin
  foreach t in array array['client_property_lists','client_properties'] loop
    execute format('create trigger trg_%1$s_updated before update on public.%1$I for each row execute function public.set_updated_at()', t);
    execute format('alter table public.%I replica identity full', t);
    execute format('alter publication supabase_realtime add table public.%I', t);
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy "sdr read %1$s" on public.%1$I for select to authenticated using ((select public.is_sdr_user()))', t);
  end loop;
end $$;
