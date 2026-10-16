-- Latest note now considers room notes too; photos are matched to the note by time.
alter table public.encircle_latest_note
  add column note_scope text,          -- 'claim' (general note) or 'room'
  add column room text,                -- "Structure · Room" for room notes
  add column photo_mode text;          -- 'note' = photos taken with the note, 'day' = photos added that day

-- Page index of each claim's media list (Encircle lists media oldest-first with no sort option),
-- so refreshes only fetch the newest pages and the page(s) around the note instead of the whole claim.
create table public.encircle_media_index (
  claim_id   text primary key,
  pages      jsonb not null default '[]',  -- [{after: cursor|null, min: iso, max: iso, n: int}]
  updated_at timestamptz not null default now()
);
alter table public.encircle_media_index enable row level security;  -- service role only (no policies)
