// Trello "Related Properties" board -> client_properties (read-only mirror for the Client Properties map tab).
// Pins come from the card's Trello location when set; otherwise the Address line in the description is
// looked up with the free US Census geocoder (Nominatim as a fallback), and cached until the address changes.

export const PROPS_BOARD = '6abd5e70e8fa6ece8f0fc2a1'; // Related Properties

type TrelloFn = (method: string, path: string, params?: Record<string, unknown>) => Promise<any>;

const PROP_FIELDS =
  'name,idList,idBoard,labels,due,dueComplete,desc,closed,pos,shortUrl,dateLastActivity,address,locationName,coordinates';
const CARD_EXTRAS = {
  fields: PROP_FIELDS,
  checklists: 'all', checklist_fields: 'name',
  attachments: 'true', attachment_fields: 'name,url,date,mimeType',
  members: 'true', member_fields: 'fullName,username',
};

/** "**Key:** value" lines -> [{key, value}] plus a few well-known ones. */
export function parseDescription(desc: string | null) {
  const fields: { key: string; value: string }[] = [];
  for (const raw of String(desc ?? '').split(/\r?\n/)) {
    const m = raw.match(/^\s*[-*]?\s*\*\*(.+?):?\*\*:?\s*(.*)$/);
    if (m) fields.push({ key: m[1].replace(/:$/, '').trim(), value: m[2].trim() });
  }
  const get = (re: RegExp) => fields.find((f) => re.test(f.key))?.value || null;
  const clientLine = String(desc ?? '').match(/_?Client:\s*([^_\n]+)_?/i)?.[1]?.trim() ?? null;
  return { fields, address: get(/^address$/i), client: get(/^client$/i) ?? clientLine };
}

function coords(c: any): { lat: number; lng: number } | null {
  const v = c.coordinates;
  if (!v) return null;
  if (typeof v === 'string') {
    const [a, b] = v.split(',').map(Number);
    return Number.isFinite(a) && Number.isFinite(b) ? { lat: a, lng: b } : null;
  }
  const lat = Number(v.latitude ?? v.lat), lng = Number(v.longitude ?? v.lng ?? v.lon);
  return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
}

async function censusGeocode(address: string) {
  const u = new URL('https://geocoding.geo.census.gov/geocoder/locations/onelineaddress');
  u.searchParams.set('address', address);
  u.searchParams.set('benchmark', 'Public_AR_Current');
  u.searchParams.set('format', 'json');
  const r = await fetch(u, { signal: AbortSignal.timeout(12000) });
  if (!r.ok) return null;
  const j = await r.json();
  const m = j?.result?.addressMatches?.[0]?.coordinates;
  return m ? { lat: Number(m.y), lng: Number(m.x) } : null;
}
async function nominatimGeocode(address: string) {
  const u = new URL('https://nominatim.openstreetmap.org/search');
  u.searchParams.set('q', address);
  u.searchParams.set('format', 'json');
  u.searchParams.set('limit', '1');
  u.searchParams.set('countrycodes', 'us');
  const r = await fetch(u, { headers: { 'User-Agent': 'SDR-Renovation-PM/1.0 (rwalker@sdandr.com)' }, signal: AbortSignal.timeout(12000) });
  if (!r.ok) return null;
  const j = await r.json();
  return j?.[0] ? { lat: Number(j[0].lat), lng: Number(j[0].lon) } : null;
}
async function geocode(address: string, allowNominatim: boolean) {
  try { const c = await censusGeocode(address); if (c) return c; } catch { /* fall through */ }
  if (!allowNominatim) return null;
  try { return await nominatimGeocode(address); } catch { return null; }
}

function baseRow(c: any) {
  const p = parseDescription(c.desc);
  return {
    id: c.id, list_id: c.idList, name: c.name, description: c.desc ?? null,
    labels: (c.labels ?? []).map((l: any) => ({ id: l.id, name: l.name, color: l.color })),
    fields: p.fields, client: p.client,
    address: (c.address && String(c.address).trim()) || p.address,
    location_name: c.locationName ?? null,
    checklists: (c.checklists ?? []).map((cl: any) => ({
      id: cl.id, name: cl.name,
      items: (cl.checkItems ?? []).sort((a: any, b: any) => a.pos - b.pos).map((i: any) => ({ name: i.name, done: i.state === 'complete' })),
    })),
    attachments: (c.attachments ?? []).map((a: any) => ({ name: a.name, url: a.url, date: a.date, mime: a.mimeType })),
    members: (c.members ?? []).map((m: any) => ({ name: m.fullName, username: m.username })),
    due: c.due, due_complete: !!c.dueComplete, closed: !!c.closed, pos: c.pos,
    short_url: c.shortUrl, last_activity: c.dateLastActivity,
  };
}

/** Work out lat/lng for a card, reusing the previous lookup when the address hasn't changed. */
async function withLocation(c: any, row: ReturnType<typeof baseRow>, prev: any, allowNominatim: boolean) {
  const pin = coords(c);
  if (pin) return { ...row, ...pin, geo_source: 'trello', geo_address: row.address };
  if (!row.address) return { ...row, lat: null, lng: null, geo_source: null, geo_address: null };
  if (prev && prev.geo_address === row.address && prev.lat != null && prev.geo_source !== 'trello') {
    return { ...row, lat: prev.lat, lng: prev.lng, geo_source: prev.geo_source, geo_address: prev.geo_address };
  }
  const g = await geocode(row.address, allowNominatim);
  return g ? { ...row, ...g, geo_source: 'census', geo_address: row.address }
           : { ...row, lat: null, lng: null, geo_source: null, geo_address: row.address };
}

async function pool<T, R>(items: T[], n: number, fn: (t: T) => Promise<R>) {
  const out: R[] = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) { const k = i++; out[k] = await fn(items[k]); }
  }));
  return out;
}

export async function syncPropertyLists(trello: TrelloFn, admin: any) {
  const lists = await trello('GET', `/boards/${PROPS_BOARD}/lists`, { filter: 'all', fields: 'name,pos,closed' });
  const { error } = await admin.from('client_property_lists').upsert(
    lists.map((l: any) => ({ id: l.id, name: l.name, pos: l.pos, closed: !!l.closed })));
  if (error) throw error;
  return lists.length;
}

export async function refreshProperty(trello: TrelloFn, admin: any, id: string) {
  let c: any;
  try { c = await trello('GET', `/cards/${id}`, CARD_EXTRAS); }
  catch (e) {
    if (String(e).includes('-> 404')) { await admin.from('client_properties').update({ closed: true }).eq('id', id); return null; }
    throw e;
  }
  if (c.idBoard !== PROPS_BOARD) { await admin.from('client_properties').update({ closed: true }).eq('id', id); return null; }
  const { data: prev } = await admin.from('client_properties').select('lat,lng,geo_source,geo_address').eq('id', id).maybeSingle();
  const row = await withLocation(c, baseRow(c), prev, true);
  const { error } = await admin.from('client_properties').upsert(row);
  if (error) throw error;
  return row;
}

export async function syncProperties(trello: TrelloFn, admin: any) {
  const nLists = await syncPropertyLists(trello, admin);
  const cards = await trello('GET', `/boards/${PROPS_BOARD}/cards/open`, CARD_EXTRAS);
  const { data: held } = await admin.from('client_properties').select('id,lat,lng,geo_source,geo_address,closed');
  const prevById = new Map((held ?? []).map((r: any) => [r.id, r]));
  let nominatimLeft = 20; // Nominatim allows ~1 request/second; keep fallbacks to a handful per sync
  const rows = await pool(cards, 6, async (c: any) => {
    const allow = nominatimLeft > 0;
    const r = await withLocation(c, baseRow(c), prevById.get(c.id), allow);
    if (allow && r.geo_source === null && r.address) nominatimLeft--;
    return r;
  });
  for (let i = 0; i < rows.length; i += 200) {
    const { error } = await admin.from('client_properties').upsert(rows.slice(i, i + 200));
    if (error) throw error;
  }
  const open = new Set(rows.map((r) => r.id));
  const gone = (held ?? []).filter((r: any) => !r.closed && !open.has(r.id)).map((r: any) => r.id);
  if (gone.length) await admin.from('client_properties').update({ closed: true }).in('id', gone);
  return {
    lists: nLists, cards: rows.length, closed: gone.length,
    pinned: rows.filter((r) => r.lat != null).length,
    from_trello: rows.filter((r) => r.geo_source === 'trello').length,
    unplaced: rows.filter((r) => r.lat == null).map((r) => r.name).slice(0, 50),
  };
}
