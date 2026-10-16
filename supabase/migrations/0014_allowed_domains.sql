-- Who can sign in: one list of email domains, used by the database rules (is_sdr_user) and by the
-- trello / encircle edge functions (via allowed_email). Add or remove a domain here only.
create or replace function public.allowed_email(e text) returns boolean
language sql immutable set search_path = '' as $$
  select coalesce(split_part(lower(trim(e)), '@', 2) = any (array['sdandr.com', 'venture-gc.com']), false)
$$;

create or replace function public.is_sdr_user() returns boolean
language sql stable set search_path = '' as $$
  select public.allowed_email(auth.jwt() ->> 'email')
$$;
