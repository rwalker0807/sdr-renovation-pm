-- Encircle links from Trello now copy onto every job type (not just water/fire loss),
-- and existing projects were backfilled from their linked cards. Function body: see 0005 (updated in place).
update public.projects p set
  encircle_url = coalesce(nullif(p.encircle_url, ''), c.encircle_url),
  client       = coalesce(nullif(p.client, ''), c.client),
  billed_to    = coalesce(nullif(p.billed_to, ''), c.invoice_to),
  claim_number = case when p.job_type = 'loss' then coalesce(nullif(p.claim_number, ''), c.claim_id) else p.claim_number end
from public.trello_cards c
where c.id = p.trello_card_id;
