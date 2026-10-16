// Two-way bridge between the Trello "Raleigh Current Jobs" board and the tracker.
//
//  Trello -> tracker : Trello calls this function (webhook) on every board change; we re-read the
//                      card from Trello and upsert it into trello_cards (realtime pushes it to the site).
//  tracker -> Trello : the site calls this function with a signed-in @sdandr.com user's token to move a
//                      card, change labels or set the due date; we make the change in Trello, then upsert.
//
// Secrets (Supabase > Edge Functions > Secrets): TRELLO_KEY, TRELLO_TOKEN, TRELLO_SECRET
// The Trello key/token never reach the browser.
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';

const BOARD = '669fb6d4bad31f2c13bfb48b'; // Raleigh Current Jobs
const KEY = Deno.env.get('TRELLO_KEY') ?? '';
const TOKEN = Deno.env.get('TRELLO_TOKEN') ?? '';
const SECRET = Deno.env.get('TRELLO_SECRET') ?? '';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const CALLBACK = `${SUPABASE_URL}/functions/v1/trello`;
const admin = createClient(SUPABASE_URL, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, HEAD, POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

async function trello(method: string, path: string, params: Record<string, unknown> = {}) {
  if (!KEY || !TOKEN) throw new Error('Trello key/token not set (Edge Function secrets TRELLO_KEY, TRELLO_TOKEN).');
  const u = new URL(`https://api.trello.com/1${path}`);
  u.searchParams.set('key', KEY);
  u.searchParams.set('token', TOKEN);
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null) u.searchParams.set(k, String(v));
  const r = await fetch(u, { method });
  const text = await r.text();
  if (!r.ok) throw new Error(`Trello ${method} ${path} -> ${r.status}: ${text.slice(0, 200)}`);
  return text ? JSON.parse(text) : null;
}

const CARD_FIELDS = 'name,idList,idBoard,labels,due,dueComplete,desc,closed,pos,shortUrl,dateLastActivity';
// Job numbers: 26-327, and loss-job codes like D6813, D6813-1, V6649
const jobCode = (name: string) =>
  name.match(/#\s*(\d{2}-\d{3,4}(?:-\d+)?)/)?.[1] ??
  name.match(/#\s*([A-Za-z]\d{3,5}(?:-\d+)?)/)?.[1] ??
  name.match(/\b(\d{2}-\d{3})\b/)?.[1] ?? null;

// Board custom field definitions (id -> {name, options}); cached per function instance, refreshed on change
let fieldDefs: Map<string, { name: string; options: Map<string, string> }> | null = null;
async function customFieldDefs(force = false) {
  if (fieldDefs && !force) return fieldDefs;
  const defs = await trello('GET', `/boards/${BOARD}/customFields`);
  fieldDefs = new Map(defs.map((d: any) => [d.id, {
    name: String(d.name ?? '').trim(),
    options: new Map((d.options ?? []).map((o: any) => [o.id, o.value?.text ?? ''])),
  }]));
  return fieldDefs;
}
const norm = (n: string) => n.toLowerCase().replace(/[^a-z]/g, '');
function customValues(c: any, defs: NonNullable<typeof fieldDefs>) {
  const out: Record<string, string> = {};
  for (const item of c.customFieldItems ?? []) {
    const d = defs.get(item.idCustomField);
    if (!d) continue;
    const v = item.value ?? {};
    const val = item.idValue ? d.options.get(item.idValue) ?? ''
      : v.text ?? v.number ?? v.date ?? (v.checked != null ? String(v.checked === 'true') : '');
    if (val !== '' && val != null) out[d.name] = String(val);
  }
  return out;
}
const pick = (cf: Record<string, string>, ...names: string[]) => {
  const want = names.map(norm);
  const k = Object.keys(cf).find((n) => want.includes(norm(n)));
  return k ? cf[k] : null;
};
const cardRow = (c: any, defs: NonNullable<typeof fieldDefs>) => {
  const cf = customValues(c, defs);
  return {
    id: c.id, board_id: c.idBoard, list_id: c.idList, name: c.name, job_code: jobCode(c.name),
    labels: (c.labels ?? []).map((l: any) => ({ id: l.id, name: l.name, color: l.color })),
    due: c.due, due_complete: !!c.dueComplete, description: c.desc ?? null, closed: !!c.closed,
    pos: c.pos, short_url: c.shortUrl, last_activity: c.dateLastActivity,
    client: pick(cf, 'Client'),
    invoice_to: pick(cf, 'Invoice To', 'Invoice To:', 'Billed To', 'Bill To'),
    claim_id: pick(cf, 'Claim Identifier', 'Claim', 'Claim #', 'Claim Number'),
    encircle_url: pick(cf, 'Encircle link', 'Encircle'),
    custom_fields: cf,
  };
};

async function refreshCard(id: string) {
  let c: any;
  try { c = await trello('GET', `/cards/${id}`, { fields: CARD_FIELDS, customFieldItems: true }); }
  catch (e) {
    if (String(e).includes('-> 404')) { await admin.from('trello_cards').update({ closed: true }).eq('id', id); return null; }
    throw e;
  }
  if (c.idBoard !== BOARD) { // moved off the board
    await admin.from('trello_cards').update({ closed: true }).eq('id', id);
    return null;
  }
  const row = cardRow(c, await customFieldDefs());
  const { error } = await admin.from('trello_cards').upsert(row);
  if (error) throw error;
  return row;
}

async function syncLists() {
  const lists = await trello('GET', `/boards/${BOARD}/lists`, { filter: 'all', fields: 'name,pos,closed' });
  const { error } = await admin.from('trello_lists').upsert(
    lists.map((l: any) => ({ id: l.id, board_id: BOARD, name: l.name, pos: l.pos, closed: !!l.closed })));
  if (error) throw error;
  return lists.length;
}
async function syncLabels() {
  const labels = await trello('GET', `/boards/${BOARD}/labels`, { limit: 1000, fields: 'name,color' });
  const { error } = await admin.from('trello_labels').upsert(
    labels.map((l: any) => ({ id: l.id, board_id: BOARD, name: l.name, color: l.color })));
  if (error) throw error;
  return labels.length;
}
async function syncAll() {
  const nLists = await syncLists();
  const nLabels = await syncLabels();
  const defs = await customFieldDefs(true);
  const cards = await trello('GET', `/boards/${BOARD}/cards/open`, { fields: CARD_FIELDS, customFieldItems: true });
  const rows = cards.map((c: any) => cardRow(c, defs));
  for (let i = 0; i < rows.length; i += 200) {
    const { error } = await admin.from('trello_cards').upsert(rows.slice(i, i + 200));
    if (error) throw error;
  }
  // anything we hold that is no longer open on the board -> closed
  const open = new Set(rows.map((r: any) => r.id));
  const { data: held } = await admin.from('trello_cards').select('id').eq('board_id', BOARD).eq('closed', false);
  const gone = (held ?? []).map((r: any) => r.id).filter((id: string) => !open.has(id));
  if (gone.length) await admin.from('trello_cards').update({ closed: true }).in('id', gone);
  return { lists: nLists, labels: nLabels, cards: rows.length, closed: gone.length };
}

async function validTrelloSignature(body: string, signature: string | null) {
  if (!SECRET || !signature) return false;
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(SECRET), { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(body + CALLBACK)));
  return btoa(String.fromCharCode(...mac)) === signature;
}

async function sdrUser(req: Request) {
  const jwt = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
  if (!jwt) return null;
  const { data } = await admin.auth.getUser(jwt);
  const email = data.user?.email?.toLowerCase() ?? '';
  return email.endsWith('@sdandr.com') ? data.user : null;
}

async function cardOnBoard(id: string) {
  const c = await trello('GET', `/cards/${id}`, { fields: 'idBoard,labels' });
  if (c.idBoard !== BOARD) throw new Error('That card is not on the Raleigh Current Jobs board.');
  return c;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  // Trello checks the callback URL with HEAD (and sometimes GET) when the webhook is created
  if (req.method === 'HEAD' || req.method === 'GET') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const body = await req.text();

  // ---- Trello -> tracker (webhook)
  const sig = req.headers.get('x-trello-webhook');
  if (sig) {
    if (!(await validTrelloSignature(body, sig))) return json({ error: 'bad signature' }, 401);
    try {
      const evt = JSON.parse(body);
      const type: string = evt.action?.type ?? '';
      const d = evt.action?.data ?? {};
      if (/CustomField$/.test(type)) await customFieldDefs(true); // field added/renamed on the board
      else if (/List/.test(type) && !d.card) await syncLists();
      else if (/Label/.test(type) && !d.card) await syncLabels();
      else if (type === 'deleteCard' && d.card?.id) await admin.from('trello_cards').update({ closed: true }).eq('id', d.card.id);
      else if (d.card?.id) await refreshCard(d.card.id);
      return json({ ok: true });
    } catch (e) {
      console.error(e);
      return json({ ok: false }, 200); // don't make Trello retry-storm; next sync heals it
    }
  }

  // ---- tracker -> Trello (signed-in SDR user)
  const user = await sdrUser(req);
  if (!user) return json({ error: 'Sign in with an @sdandr.com account.' }, 401);
  let p: any = {};
  try { p = JSON.parse(body || '{}'); } catch { return json({ error: 'Bad JSON' }, 400); }

  try {
    switch (p.action) {
      case 'sync':
        return json({ ok: true, ...(await syncAll()) });

      case 'move': {
        await cardOnBoard(p.card_id);
        const lists = await trello('GET', `/boards/${BOARD}/lists`, { filter: 'open', fields: 'id' });
        if (!lists.some((l: any) => l.id === p.list_id)) throw new Error('Target list is not on this board.');
        await trello('PUT', `/cards/${p.card_id}`, { idList: p.list_id, pos: p.pos ?? 'top' });
        return json({ ok: true, card: await refreshCard(p.card_id) });
      }

      case 'labels': {
        const c = await cardOnBoard(p.card_id);
        const has = new Set((c.labels ?? []).map((l: any) => l.id));
        for (const id of p.add ?? []) if (!has.has(id)) await trello('POST', `/cards/${p.card_id}/idLabels`, { value: id });
        for (const id of p.remove ?? []) if (has.has(id)) await trello('DELETE', `/cards/${p.card_id}/idLabels/${id}`);
        return json({ ok: true, card: await refreshCard(p.card_id) });
      }

      case 'due': {
        await cardOnBoard(p.card_id);
        await trello('PUT', `/cards/${p.card_id}`, { due: p.due ?? '', dueComplete: !!p.due_complete });
        return json({ ok: true, card: await refreshCard(p.card_id) });
      }

      case 'setup_webhook': {
        const hooks = await trello('GET', `/tokens/${TOKEN}/webhooks`);
        let hook = hooks.find((h: any) => h.idModel === BOARD && h.callbackURL === CALLBACK);
        if (!hook) hook = await trello('POST', '/webhooks', { idModel: BOARD, callbackURL: CALLBACK, description: 'SDR Renovation PM tracker' });
        const synced = await syncAll();
        return json({ ok: true, webhook: { id: hook.id, active: hook.active }, ...synced });
      }

      default:
        return json({ error: 'Unknown action' }, 400);
    }
  } catch (e) {
    console.error(e);
    return json({ error: String((e as Error).message ?? e) }, 502);
  }
});
