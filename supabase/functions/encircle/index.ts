// Encircle bridge (read-only): finds the newest note on an Encircle property claim (general notes AND room notes),
// plus the photos taken with that note, and caches it in public.encircle_latest_note for the project dashboards.
// Never creates or changes anything in Encircle.
//
// Secret (Supabase > Edge Functions > Secrets): ENCIRCLE_API_TOKEN — created in Encircle account settings.
// Called by the site with a signed-in user's token (allowed domains: public.allowed_email):  { action: 'latest_notes', claim_ids: ['4911809'] }
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
  if (!data.user?.email) return null;
  // allowed sign-in domains live in one place: public.allowed_email() (migration 0014)
  const { data: ok } = await admin.rpc('allowed_email', { e: data.user.email });
  return ok === true ? data.user : null;
}

class EncircleAuthError extends Error {}
async function enc(path: string, params: Record<string, string | null | undefined> = {}) {
  const u = new URL(API + path);
  for (const [k, v] of Object.entries(params)) if (v != null) u.searchParams.set(k, v);
  for (let attempt = 0; attempt < 3; attempt++) {
    const r = await fetch(u, { headers: { Authorization: `Bearer ${TOKEN}`, Accept: 'application/json' }, signal: AbortSignal.timeout(20000) });
    if (r.status === 401 || r.status === 403) throw new EncircleAuthError('Encircle refused the API token (check ENCIRCLE_API_TOKEN).');
    if (r.status === 429) { await new Promise((ok) => setTimeout(ok, 1000 * (attempt + 1))); continue; }
    if (r.status === 404) return null;
    if (!r.ok) throw new Error(`Encircle ${r.status} on ${path}`);
    return await r.json();
  }
  throw new Error(`Encircle rate limit on ${path}`);
}
/** All items of a paged list (cap pages). */
async function all(path: string, params: Record<string, string> = {}, maxPages = 20) {
  const out: any[] = [];
  let after: string | null = null;
  for (let i = 0; i < maxPages; i++) {
    const j = await enc(path, { ...params, limit: '100', after });
    if (!j) break;
    out.push(...(j.list ?? []));
    after = j.cursor?.after ?? null;
    if (!after) break;
  }
  return out;
}
async function pool<T, R>(items: T[], n: number, fn: (t: T) => Promise<R>) {
  const out: R[] = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) { const k = i++; out[k] = await fn(items[k]); }
  }));
  return out;
}

const when = (n: any) => n?.client_created ?? n?.server_created ?? null;
const etDay = (iso: string) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date(iso));

// ---------- newest note: general notes + every room's notes ----------
async function newestNote(claimId: string) {
  const cands: { note: any; scope: 'claim' | 'room'; room: string | null }[] = [];
  const general = await enc(`/v2/property_claims/${claimId}/notes`, { order: 'newest', limit: '1' });
  if (general === null) return { notFound: true } as const;
  if (general.list?.[0]) cands.push({ note: general.list[0], scope: 'claim', room: null });

  const structures = await all(`/v1/property_claims/${claimId}/structures`);
  const rooms = (await pool(structures, 4, async (s: any) => {
    const rs = await all(`/v1/property_claims/${claimId}/structures/${s.id}/rooms`);
    return rs.map((r: any) => ({ sid: s.id, rid: r.id, label: [s.name, r.name].filter(Boolean).join(' · ') || null }));
  })).flat();
  const roomNotes = await pool(rooms, 10, async (r) => {
    try {
      const j = await enc(`/v2/property_claims/${claimId}/structures/${r.sid}/rooms/${r.rid}/notes`, { order: 'newest', limit: '1' });
      return j?.list?.[0] ? { note: j.list[0], scope: 'room' as const, room: r.label } : null;
    } catch (e) { console.error('room notes', claimId, r.rid, String(e)); return null; }
  });
  for (const c of roomNotes) if (c) cands.push(c);
  cands.sort((a, b) => String(when(b.note) ?? '').localeCompare(String(when(a.note) ?? '')));
  console.log(JSON.stringify({ diag: 'notes', claimId, structures: structures.length, rooms: rooms.length, roomNotes: roomNotes.filter(Boolean).length, newest: cands[0] ? { scope: cands[0].scope, at: when(cands[0].note) } : null }));
  return { best: cands[0] ?? null } as const;
}

// ---------- media page index (Encircle lists media oldest-first; no sort option) ----------
type Page = { after: string | null; min: string | null; max: string | null; n: number };
const mediaTime = (m: any) => m.primary_client_created ?? m.primary_server_created ?? null;

async function fetchMediaPage(claimId: string, after: string | null) {
  const j = await enc(`/v1/property_claims/${claimId}/media`, { limit: '100', after });
  const list: any[] = j?.list ?? [];
  const ts = list.map(mediaTime).filter(Boolean).sort();
  return { list, next: (j?.cursor?.after ?? null) as string | null, min: ts[0] ?? null, max: ts[ts.length - 1] ?? null };
}

/** Extend the stored page index to the end of the media list, re-reading only the last known page onwards. */
async function updateIndex(claimId: string) {
  const { data } = await admin.from('encircle_media_index').select('pages').eq('claim_id', claimId).maybeSingle();
  const pages: Page[] = (data?.pages as Page[]) ?? [];
  let start = Math.max(0, pages.length - 1);       // the last page may have grown
  let after = pages.length ? pages[start].after : null;
  const fresh = new Map<string, any[]>();           // page cursor -> items fetched this run (fresh download links)
  for (let i = 0; i < 120; i++) {
    const p = await fetchMediaPage(claimId, after);
    pages[start + i] = { after, min: p.min, max: p.max, n: p.list.length };
    fresh.set(String(after), p.list);
    if (!p.next || !p.list.length) { pages.length = start + i + 1; break; }
    after = p.next;
  }
  await admin.from('encircle_media_index').upsert({ claim_id: claimId, pages, updated_at: new Date().toISOString() });
  return { pages, fresh };
}

const NOTE_PIC = /NotePicture$/;                          // ClaimNotePicture, ClaimRoomNotePicture, ClaimRoomPictureNotePicture
const DAY_PIC = /(Picture|PictureDocument)$/;             // room photos, note photos, sketch photos, scanned docs
const isImage = (m: any) => String(m.content_type ?? '').startsWith('image/');
const photo = (m: any) => ({ url: m.download_uri, filename: m.filename ?? null, taken: mediaTime(m), type: m.source?.type ?? null,
  labels: Array.isArray(m.labels) ? m.labels.slice(0, 4) : [] });

/** Photos taken with the note (note-photo types within ±20 min), else photos added that day (Eastern). */
async function photosFor(claimId: string, noteIso: string) {
  const { pages, fresh } = await updateIndex(claimId);
  const day = etDay(noteIso);
  const t = new Date(noteIso).getTime();
  // pages whose time range touches the note's day (±1 day margin for time zones / offline sync)
  const lo = new Date(t - 36 * 3600e3).toISOString(), hi = new Date(t + 36 * 3600e3).toISOString();
  const want = pages.filter((p) => p.min && p.max && p.max >= lo && p.min <= hi);
  const items: any[] = [];
  for (const p of want.slice(0, 12)) {
    const cached = fresh.get(String(p.after));
    items.push(...(cached ?? (await fetchMediaPage(claimId, p.after)).list));
  }
  const imgs = items.filter((m) => isImage(m) && mediaTime(m));
  const near = imgs.filter((m) => NOTE_PIC.test(m.source?.type ?? '') && Math.abs(new Date(mediaTime(m)).getTime() - t) <= 20 * 60e3);
  const sameDay = imgs.filter((m) => DAY_PIC.test(m.source?.type ?? 'Picture') && etDay(mediaTime(m)) === day);
  const chosen = near.length ? near : sameDay;
  const uniq = [...new Map(chosen.map((m) => [m.download_uri, m])).values()]
    .sort((a, b) => String(mediaTime(a)).localeCompare(String(mediaTime(b))));
  console.log(JSON.stringify({ diag: 'photos', claimId, pages: pages.length, scanned: want.length, near: near.length, sameDay: sameDay.length }));
  return { photos: uniq.slice(0, 24).map(photo), total: uniq.length, mode: near.length ? 'note' : 'day', day };
}

async function latestFor(claimId: string) {
  const base = { claim_id: claimId, checked_at: new Date().toISOString() };
  const empty = { note_id: null, title: null, body: null, author: null, created_at: null, note_scope: null, room: null,
    photos: [], photos_total: 0, photo_day: null, photo_mode: null };
  const r = await newestNote(claimId);
  if ('notFound' in r) return { ...base, ...empty, error: 'Claim not found in Encircle' };
  if (!r.best) return { ...base, ...empty, error: null };
  const n = r.best.note;
  const at = when(n);
  let pics = { photos: [] as any[], total: 0, mode: null as string | null, day: at ? etDay(at) : null };
  if (at) { try { pics = await photosFor(claimId, at); } catch (e) { if (e instanceof EncircleAuthError) throw e; console.error('photos', claimId, String(e)); } }
  return {
    ...base, error: null, note_id: String(n.id), title: n.title ?? null, body: n.text ?? null,
    author: n.creator?.actor_identifier ?? n.creator?.actor_type ?? null,
    created_at: n.server_created ?? at, note_scope: r.best.scope, room: r.best.room,
    photos: pics.photos, photos_total: pics.total, photo_day: pics.day, photo_mode: pics.mode,
  };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  if (!(await sdrUser(req))) return json({ error: 'Sign in with an @sdandr.com or @venture-gc.com account.' }, 401);
  if (!TOKEN) return json({ error: 'not_configured', message: 'Encircle API token not set (Supabase secret ENCIRCLE_API_TOKEN).' }, 200);

  let p: any = {};
  try { p = await req.json(); } catch { return json({ error: 'Bad JSON' }, 400); }
  if (p.action !== 'latest_notes') return json({ error: 'Unknown action' }, 400);
  const ids = [...new Set((p.claim_ids ?? []).map((x: unknown) => String(x).trim()).filter((x: string) => /^\d+$/.test(x)))].slice(0, 10) as string[];

  try {
    const rows: any[] = [];
    for (const id of ids) rows.push(await latestFor(id));   // one claim at a time: each already fans out internally
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
