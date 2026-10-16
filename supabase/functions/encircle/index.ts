// Encircle bridge (read-only): fetches the newest note on Encircle property claims and caches it in
// public.encircle_latest_note for the project dashboards. Never creates or changes anything in Encircle.
//
// Secret (Supabase > Edge Functions > Secrets): ENCIRCLE_API_TOKEN — created in Encircle account settings.
// Called by the site with a signed-in @sdandr.com user's token:
//   { action: 'latest_notes', claim_ids: ['4911809', ...] }   (up to 40 per call)
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';

const TOKEN = Deno.env.get('ENCIRCLE_API_TOKEN') ?? '';
const API = 'https://api.encircleapp.com';
const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

async function sdrUser(req: Request) {
  const jwt = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
  if (!jwt) return null;
  const { data } = await admin.auth.getUser(jwt);
  return (data.user?.email ?? '').toLowerCase().endsWith('@sdandr.com') ? data.user : null;
}

const PHOTO_TYPES = new Set(['ClaimRoomAfterPicture', 'ClaimRoomPictureNotePicture', 'ClaimSketchPictureNodePicture', 'ClaimPictureDocument']);
const etDay = (iso: string) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date(iso)); // YYYY-MM-DD

/** Photos on the claim taken/added on `day` (Eastern). Encircle's media list has no sort option, so walk pages
 *  (100 per page, capped) and stop early once a page is entirely older than the day when the list runs newest-first. */
async function photosOnDay(claimId: string, day: string) {
  const out: any[] = [];
  let after: string | null = null;
  for (let page = 0; page < 25; page++) {
    const u = new URL(`${API}/v1/property_claims/${encodeURIComponent(claimId)}/media`);
    u.searchParams.set('limit', '100');
    if (after) u.searchParams.set('after', after);
    const r = await fetch(u, { headers: { Authorization: `Bearer ${TOKEN}`, Accept: 'application/json' }, signal: AbortSignal.timeout(15000) });
    if (!r.ok) break;
    const j = await r.json();
    const list: any[] = j?.list ?? [];
    if (page < 3 || page % 5 === 0 || !j?.cursor?.after) {
      const ts = list.map((m) => m.primary_client_created ?? m.primary_server_created).filter(Boolean);
      const types: Record<string, number> = {};
      list.forEach((m) => { const t = `${m.source?.type ?? '?'}|${String(m.content_type ?? '?').split('/')[0]}`; types[t] = (types[t] ?? 0) + 1; });
      console.log(JSON.stringify({ diag: 'media_page', claimId, day, page, n: list.length, first: ts[0], last: ts[ts.length - 1], types, keys: page === 0 ? Object.keys(list[0] ?? {}) : undefined, more: !!j?.cursor?.after }));
    }
    let allOlder = list.length > 0;
    for (const m of list) {
      const when = m.primary_client_created ?? m.primary_server_created;
      if (!when) continue;
      const d = etDay(when);
      if (d >= day) allOlder = false;
      const isPhoto = String(m.content_type ?? '').startsWith('image/') && (!m.source?.type || PHOTO_TYPES.has(m.source.type));
      if (isPhoto && d === day) out.push({
        url: m.download_uri, filename: m.filename ?? null, taken: when, type: m.source?.type ?? null,
        labels: Array.isArray(m.labels) ? m.labels.slice(0, 4) : [],
      });
    }
    after = j?.cursor?.after ?? null;
    if (!after || !list.length) break;
    // newest-first lists: once a whole page is before the note's day, nothing later will match
    const first = list[0]?.primary_client_created ?? list[0]?.primary_server_created;
    const last = list[list.length - 1]?.primary_client_created ?? list[list.length - 1]?.primary_server_created;
    if (allOlder && first && last && first >= last) break;
  }
  console.log(JSON.stringify({ diag: 'media_done', claimId, day, matched: out.length }));
  out.sort((a, b) => String(b.taken).localeCompare(String(a.taken)));
  return { photos: out.slice(0, 24), total: out.length };
}

async function latestNote(claimId: string) {
  const r = await fetch(`${API}/v2/property_claims/${encodeURIComponent(claimId)}/notes?order=newest&limit=1`, {
    headers: { Authorization: `Bearer ${TOKEN}`, Accept: 'application/json' },
    signal: AbortSignal.timeout(15000),
  });
  const base = { claim_id: claimId, checked_at: new Date().toISOString() };
  if (r.status === 404) return { ...base, note_id: null, title: null, body: null, author: null, created_at: null, error: 'Claim not found in Encircle', photos: [], photos_total: 0, photo_day: null };
  if (r.status === 401 || r.status === 403) throw new Error('Encircle refused the API token (check ENCIRCLE_API_TOKEN).');
  if (!r.ok) throw new Error(`Encircle ${r.status} for claim ${claimId}`);
  const j = await r.json();
  const n = j?.list?.[0];
  if (!n) return { ...base, note_id: null, title: null, body: null, author: null, created_at: null, error: null, photos: [], photos_total: 0, photo_day: null };
  const created = n.server_created ?? n.client_created ?? null;
  const day = etDay(n.client_created ?? created);
  let pics = { photos: [] as any[], total: 0 };
  try { pics = await photosOnDay(claimId, day); } catch (e) { console.error('media', claimId, e); }
  return {
    ...base, error: null, note_id: String(n.id), title: n.title ?? null, body: n.text ?? null,
    author: n.creator?.actor_identifier ?? n.creator?.actor_type ?? null,
    created_at: created, photos: pics.photos, photos_total: pics.total, photo_day: day,
  };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  if (!(await sdrUser(req))) return json({ error: 'Sign in with an @sdandr.com account.' }, 401);
  if (!TOKEN) return json({ error: 'not_configured', message: 'Encircle API token not set (Supabase secret ENCIRCLE_API_TOKEN).' }, 200);

  let p: any = {};
  try { p = await req.json(); } catch { return json({ error: 'Bad JSON' }, 400); }
  if (p.action !== 'latest_notes') return json({ error: 'Unknown action' }, 400);
  const ids = [...new Set((p.claim_ids ?? []).map((x: unknown) => String(x).trim()).filter((x: string) => /^\d+$/.test(x)))].slice(0, 40) as string[];

  try {
    const rows: any[] = [];
    for (let i = 0; i < ids.length; i += 5) rows.push(...await Promise.all(ids.slice(i, i + 5).map(latestNote)));
    if (rows.length) {
      const { error } = await admin.from('encircle_latest_note').upsert(rows);
      if (error) throw error;
    }
    return json({ ok: true, notes: rows });
  } catch (e) {
    console.error(e);
    return json({ error: String((e as Error).message ?? e) }, 502);
  }
});
