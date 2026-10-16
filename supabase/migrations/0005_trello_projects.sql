-- Every job card on the Raleigh Current Jobs board becomes a tracker project.
-- Runs inside the database whenever the trello edge function writes a card (webhook or sync),
-- so new cards show up as projects within seconds, with no one needing the site open.
--
-- New project: job #, name, client, billed to, a best-guess job type (Renovation / Water-Fire Loss / GC),
--              status from the Trello list, start date from when the card was created.
-- Existing project: only fills blanks (client, billed to, claim #, Encircle) and follows the card's
--              list for status when the card moves. Job type and anything typed in the tracker is never overwritten.
-- Skipped: template lists, archived cards, and cards without a job number (e.g. bare links, people cards).

alter table public.projects add column trello_card_id text, add column trello_list text;
create unique index projects_trello_card_id_key on public.projects (trello_card_id);

create or replace function public.trello_sync_project() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_list text; v_code text; v_title text; v_low text; v_type text; v_status text;
  v_pid uuid; v_prev_list text; v_prev_card text;
begin
  if new.closed then return new; end if;
  select name into v_list from public.trello_lists where id = new.list_id;
  if v_list is null or v_list ~* 'template' then return new; end if;

  v_code := coalesce(new.job_code, substring(new.name from '^\s*#\s*([A-Za-z]?\d[\w-]*)'));
  if v_code is null then return new; end if;
  v_title := btrim(regexp_replace(regexp_replace(new.name, '^\s*#\s*[A-Za-z]?\d[\w-]*\s*:?\s*', ''), '\s+', ' ', 'g'));
  if v_title = '' then v_title := v_code; end if;
  v_low := lower(new.name);

  v_type := case
    when v_low ~ '(renovation|\mreno\M)' then 'renovation'
    when v_low ~ '(\mems\M|rebuild|water|fire|flood|leak|mold|hurricane|storm|\mloss\M|moisture)' or v_code ~* '^[dv]\d' then 'loss'
    else 'gc' end;
  v_status := case
    when v_list ~* 'proposal|ready to start' then 'precon'
    when v_list ~* 'pause|hold' then 'on_hold'
    when v_list ~* 'complete|invoice|xactimate|t&m' then 'closeout'
    else 'active' end;

  select id, trello_list, trello_card_id into v_pid, v_prev_list, v_prev_card
    from public.projects where trello_card_id = new.id;
  if v_pid is null then
    select id, trello_list, trello_card_id into v_pid, v_prev_list, v_prev_card
      from public.projects where lower(code) = lower(v_code) limit 1;
  end if;

  if v_pid is null then
    insert into public.projects (code, name, client, billed_to, job_type, status, start_date,
                                 loss_type, claim_number, encircle_url, trello_card_id, trello_list)
    values (v_code, v_title, new.client, new.invoice_to, v_type, v_status,
            to_timestamp(('x' || substr(new.id, 1, 8))::bit(32)::bigint)::date,
            case when v_type = 'loss' then case when v_low ~ 'fire' then 'fire' when v_low ~ 'mold' then 'mold'
                                                when v_low ~ 'hurricane|storm' then 'storm' else 'water' end end,
            case when v_type = 'loss' then new.claim_id end,
            case when v_type = 'loss' then new.encircle_url end,
            new.id, v_list)
    on conflict (code) do nothing;
  else
    update public.projects set
      trello_card_id = coalesce(trello_card_id, new.id),
      client       = coalesce(nullif(client, ''), new.client),
      billed_to    = coalesce(nullif(billed_to, ''), new.invoice_to),
      claim_number = case when job_type = 'loss' then coalesce(nullif(claim_number, ''), new.claim_id) else claim_number end,
      encircle_url = case when job_type = 'loss' then coalesce(nullif(encircle_url, ''), new.encircle_url) else encircle_url end,
      -- follow list moves for the card this project is linked to (not on first link, so existing statuses stand)
      status       = case when v_prev_card = new.id and v_prev_list is distinct from v_list then v_status else status end,
      trello_list  = case when coalesce(v_prev_card, new.id) = new.id then v_list else trello_list end
    where id = v_pid;
  end if;
  return new;
end $$;
revoke all on function public.trello_sync_project() from public, anon, authenticated;

create trigger trg_trello_sync_project after insert or update on public.trello_cards
  for each row execute function public.trello_sync_project();
