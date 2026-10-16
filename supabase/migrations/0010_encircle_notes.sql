-- Latest Encircle claim note per claim, cached for the project dashboards.
-- Written only by the `encircle` edge function (service role); SDR users can read it.
create table public.encircle_latest_note (
  claim_id    text primary key,                 -- Encircle property claim id (from the project's Encircle link)
  note_id     text,
  title       text,
  body        text,
  author      text,
  created_at  timestamptz,                      -- when the note was made (Encircle server_created)
  note_count  integer,
  checked_at  timestamptz not null default now(),
  error       text
);
alter table public.encircle_latest_note enable row level security;
create policy "sdr read encircle_latest_note" on public.encircle_latest_note
  for select to authenticated using ((select public.is_sdr_user()));
