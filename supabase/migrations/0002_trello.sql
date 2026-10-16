-- Mirror of the Trello "Raleigh Current Jobs" board. Written only by the `trello` edge function
-- (service role); signed-in SDR users can read it, and it streams over realtime.
create table public.trello_lists (
  id text primary key, board_id text not null, name text not null, pos numeric, closed boolean not null default false,
  updated_at timestamptz not null default now()
);
create table public.trello_labels (
  id text primary key, board_id text not null, name text, color text, updated_at timestamptz not null default now()
);
create table public.trello_cards (
  id text primary key, board_id text not null, list_id text, name text not null, job_code text,
  labels jsonb not null default '[]', due timestamptz, due_complete boolean not null default false,
  description text, closed boolean not null default false, pos numeric, short_url text, last_activity timestamptz,
  updated_at timestamptz not null default now()
);
create index on public.trello_cards (job_code);
create index on public.trello_cards (list_id);

do $$
declare t text;
begin
  foreach t in array array['trello_lists','trello_labels','trello_cards'] loop
    execute format('create trigger trg_%1$s_updated before update on public.%1$I for each row execute function public.set_updated_at()', t);
    execute format('alter table public.%I replica identity full', t);
    execute format('alter publication supabase_realtime add table public.%I', t);
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy "sdr read %1$s" on public.%1$I for select to authenticated using ((select public.is_sdr_user()))', t);
  end loop;
end $$;
