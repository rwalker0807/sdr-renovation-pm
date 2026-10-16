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

async function latestNote(claimId: string) {
  const r = await fetch(`${API}/v2/property_claims/${encodeURIComponent(claimId)}/notes?order=newest&limit=1`, {
    headers: { Authorization: `Bearer ${TOKEN}`, Accept: 'application/json' },
    signal: AbortSignal.timeout(15000),
  });
  const base = { claim_id: claimId, checked_at: new Date().toISOString() };
  if (r.status === 404) return { ...base, note_id: null, title: null, body: null, author: null, created_at: null, error: 'Claim not found in Encircle' };
  if (r.status === 401 || r.status === 403) throw new Error('Encircle refused the API token (check ENCIRCLE_API_TOKEN).');
  if (!r.ok) return { ...base, error: `Encircle ${r.status}` };
  const j = await r.json();
  const n = j?.list?.[0];
  if (!n) return { ...base, note_id: null, title: null, body: null, author: null, created_at: null, error: null };
  return {
    ...base, error: null, note_id: String(n.id), title: n.title ?? null, body: n.text ?? null,
    author: n.creator?.actor_identifier ?? n.creator?.actor_type ?? null,
    created_at: n.server_created ?? n.client_created ?? null,
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
