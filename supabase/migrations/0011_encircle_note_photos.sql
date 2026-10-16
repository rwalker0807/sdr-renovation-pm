-- Photos added to the claim on the same day (Eastern) as the latest note. Encircle's API doesn't link photos
-- to general notes, so the dashboard shows that day's photos (room photos, room photo-notes, sketch photos).
alter table public.encircle_latest_note
  add column photos jsonb not null default '[]',
  add column photos_total integer not null default 0,
  add column photo_day date;
