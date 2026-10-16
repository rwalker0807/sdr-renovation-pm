-- Rolling "latest Encircle updates" feed on the home page.
-- Filled by the encircle edge function's feed_sweep (read-only polling of Encircle, at most every 10 minutes,
-- started by whoever has the home page open) and by the dashboards' latest-note checks.
create table public.encircle_feed (
  id           text primary key,            -- 'note:<id>', 'media:<claim>:<first media id>'
  claim_id     text not null,
  project_id   uuid references public.projects(id) on delete cascade,
  kind         text not null check (kind in ('note','room_note','photos','documents','video')),
  title        text,
  body         text,
  room         text,
  count        int,
  author       text,
  happened_at  timestamptz not null,
  created_at   timestamptz not null default now()
);
create index encircle_feed_time_idx on public.encircle_feed(happened_at desc);
alter table public.encircle_feed replica identity full;
alter publication supabase_realtime add table public.encircle_feed;
alter table public.encircle_feed enable row level security;
create policy "sdr read encircle_feed" on public.encircle_feed for select to authenticated using ((select public.is_sdr_user()));

-- per-claim sweep progress (server only)
create table public.encircle_feed_state (
  claim_id          text primary key,
  last_note_at      timestamptz,
  last_media_at     timestamptz,
  rooms_checked_at  timestamptz,
  checked_at        timestamptz
);
alter table public.encircle_feed_state enable row level security;

-- one row: when the last sweep started (throttle)
create table public.encircle_sweep (
  id         int primary key default 1 check (id = 1),
  swept_at   timestamptz not null default 'epoch',
  summary    jsonb
);
insert into public.encircle_sweep (id) values (1) on conflict do nothing;
alter table public.encircle_sweep enable row level security;
create policy "sdr read encircle_sweep" on public.encircle_sweep for select to authenticated using ((select public.is_sdr_user()));

-- atomically claim the next sweep slot (returns true for exactly one caller per window)
create or replace function public.encircle_claim_sweep(min_gap interval default '10 minutes') returns boolean
language sql volatile security definer set search_path = '' as $$
  with u as (
    update public.encircle_sweep set swept_at = now()
    where id = 1 and swept_at < now() - min_gap
    returning 1
  ) select exists (select 1 from u)
$$;
revoke execute on function public.encircle_claim_sweep(interval) from public, anon, authenticated;
