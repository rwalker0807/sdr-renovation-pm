// Free, key-less US weather sources for the Client Properties map:
//  - NEXRAD radar mosaic tiles (Iowa Environmental Mesonet, Iowa State Univ.), current + 5-minute steps back to 55 min
//  - NWS warnings imagery (IEM WMS) for full county/zone coverage
//  - Active NWS alerts (api.weather.gov) to flag properties by their stored zone/county codes or storm polygons
//  - Local storm reports (IEM: hail, wind damage, tornado, flooding), to flag properties near a report
//  - 7-day NWS forecast for a property (api.weather.gov, URL stored with the property)

export const RADAR_STEPS = [55, 50, 45, 40, 35, 30, 25, 20, 15, 10, 5, 0]; // minutes ago, oldest first
export const radarTiles = (minsAgo: number) =>
  `https://mesonet.agron.iastate.edu/cache/tile.py/1.0.0/nexrad-n0q-900913${minsAgo ? `-m${String(minsAgo).padStart(2, '0')}m` : ''}/{z}/{x}/{y}.png`;
export const WARNINGS_WMS = 'https://mesonet.agron.iastate.edu/cgi-bin/wms/us/wwa.cgi';

// ---------- NWS active alerts ----------
export type Alert = {
  id: string; event: string; severity: string; urgency: string; headline: string | null; description: string | null;
  instruction: string | null; areaDesc: string; onset: string | null; expires: string | null; ends: string | null;
  sender: string | null; ugc: string[]; geometry: GeoJSON.Geometry | null;
};

export async function fetchAlerts(states: string[]): Promise<Alert[]> {
  if (!states.length) return [];
  const out: Alert[] = [];
  // the API allows several areas per request; keep the URL short
  for (let i = 0; i < states.length; i += 10) {
    const u = `https://api.weather.gov/alerts/active?status=actual&area=${states.slice(i, i + 10).join(',')}`;
    const r = await fetch(u, { headers: { Accept: 'application/geo+json' } });
    if (!r.ok) throw new Error(`weather.gov alerts: ${r.status}`);
    const j = await r.json();
    for (const f of j.features ?? []) {
      const p = f.properties ?? {};
      if (p.messageType === 'Cancel') continue;
      out.push({
        id: p.id ?? f.id, event: p.event ?? 'Alert', severity: p.severity ?? 'Unknown', urgency: p.urgency ?? '',
        headline: p.headline ?? null, description: p.description ?? null, instruction: p.instruction ?? null,
        areaDesc: p.areaDesc ?? '', onset: p.onset ?? p.effective ?? null, expires: p.expires ?? null, ends: p.ends ?? null,
        sender: p.senderName ?? null, ugc: p.geocode?.UGC ?? [], geometry: f.geometry ?? null,
      });
    }
  }
  return out;
}

const SEV_RANK: Record<string, number> = { Extreme: 4, Severe: 3, Moderate: 2, Minor: 1 };
export const severityRank = (a: Alert) => SEV_RANK[a.severity] ?? 0;

/** NWS's own map colors for the common hazards; falls back by severity. */
const EVENT_COLOR: [RegExp, string][] = [
  [/^Tornado Warning/, '#ff0000'], [/^Tornado Watch/, '#ffff00'],
  [/^Severe Thunderstorm Warning/, '#ffa500'], [/^Severe Thunderstorm Watch/, '#db7093'],
  [/^Flash Flood Warning/, '#8b0000'], [/^Flash Flood Watch/, '#2e8b57'], [/^Flood Warning/, '#00ff00'],
  [/^Flood Watch/, '#2e8b57'], [/^Flood Advisory/, '#00ff7f'],
  [/^Hurricane Warning/, '#dc143c'], [/^Hurricane Watch/, '#ff00ff'], [/^Tropical Storm Warning/, '#b22222'],
  [/^Tropical Storm Watch/, '#f08080'], [/^Storm Surge/, '#b524f7'],
  [/^Winter Storm Warning/, '#ff69b4'], [/^Ice Storm Warning/, '#8b008b'], [/^Blizzard Warning/, '#ff4500'],
  [/^Winter Weather Advisory/, '#7b68ee'], [/^Winter Storm Watch/, '#4682b4'],
  [/^(Extreme Cold|Freeze|Hard Freeze)/, '#00bfff'], [/^Frost Advisory/, '#6495ed'],
  [/^High Wind Warning/, '#daa520'], [/^Wind Advisory/, '#d2b48c'],
  [/^Excessive Heat|^Extreme Heat/, '#c71585'], [/^Heat Advisory/, '#ff7f50'],
  [/^Red Flag Warning/, '#ff1493'], [/^Dense Fog/, '#708090'], [/^Special Weather Statement/, '#ffe4b5'],
];
export function alertColor(a: Pick<Alert, 'event' | 'severity'>) {
  for (const [re, c] of EVENT_COLOR) if (re.test(a.event)) return c;
  return ({ Extreme: '#d7263d', Severe: '#f46036', Moderate: '#f6ae2d', Minor: '#86bbd8' } as Record<string, string>)[a.severity] ?? '#9aa5b1';
}

// ---------- geometry helpers ----------
function inRing(x: number, y: number, ring: number[][]) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
export function pointInGeometry(lat: number, lng: number, g: GeoJSON.Geometry | null): boolean {
  if (!g) return false;
  const poly = (rings: number[][][]) => inRing(lng, lat, rings[0]) && !rings.slice(1).some((h) => inRing(lng, lat, h));
  if (g.type === 'Polygon') return poly(g.coordinates as number[][][]);
  if (g.type === 'MultiPolygon') return (g.coordinates as number[][][][]).some(poly);
  if (g.type === 'GeometryCollection') return g.geometries.some((x) => pointInGeometry(lat, lng, x));
  return false;
}
export function miles(aLat: number, aLng: number, bLat: number, bLng: number) {
  const R = 3958.8, rad = Math.PI / 180;
  const dLat = (bLat - aLat) * rad, dLng = (bLng - aLng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(aLat * rad) * Math.cos(bLat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Alerts covering a property: storm polygon contains the pin, or the alert lists the property's zone/county. */
export function alertsFor(p: { lat: number | null; lng: number | null; nws_zone?: string | null; nws_county?: string | null }, alerts: Alert[]) {
  return alerts.filter((a) => {
    if (a.geometry) return p.lat != null && p.lng != null && pointInGeometry(p.lat, p.lng, a.geometry);
    return (!!p.nws_zone && a.ugc.includes(p.nws_zone)) || (!!p.nws_county && a.ugc.includes(p.nws_county));
  }).sort((a, b) => severityRank(b) - severityRank(a));
}

// ---------- local storm reports (hail / wind / tornado / flood) ----------
export type StormReport = {
  id: string; type: string; kind: 'hail' | 'wind' | 'tornado' | 'flood' | 'other'; magnitude: number | null; unit: string | null;
  city: string; county: string; state: string; at: string; remark: string | null; source: string | null; lat: number; lng: number;
};
const KIND: [RegExp, StormReport['kind']][] = [
  [/HAIL/, 'hail'], [/TORNADO|FUNNEL|WATERSPOUT/, 'tornado'],
  [/WND|WIND|DOWNBURST|HURRICANE|TROPICAL/, 'wind'], [/FLOOD|HEAVY RAIN|STORM SURGE/, 'flood'],
  [/ICE STORM|HEAVY SNOW|BLIZZARD|FREEZING RAIN|SNOW|SLEET|LIGHTNING|WILDFIRE|DEBRIS FLOW/, 'other'],
];
export async function fetchStormReports(hours: number): Promise<StormReport[]> {
  const r = await fetch(`https://mesonet.agron.iastate.edu/geojson/lsr.geojson?hours=${hours}`);
  if (!r.ok) throw new Error(`storm reports: ${r.status}`);
  const j = await r.json();
  const out: StormReport[] = [];
  for (const f of j.features ?? []) {
    const p = f.properties ?? {};
    const type = String(p.typetext ?? '').toUpperCase();
    const kind = KIND.find(([re]) => re.test(type))?.[1];
    if (!kind) continue;                                   // skip temperature, rain totals, snow depth, etc.
    if (kind === 'wind' && /GST|GUST/.test(type) && Number(p.magnitude) < 58) continue; // sub-severe gusts
    const [lng, lat] = f.geometry?.coordinates ?? [Number(p.lon), Number(p.lat)];
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    out.push({
      id: String(f.id ?? `${p.valid}-${lat}-${lng}`), type: p.typetext ?? type, kind,
      magnitude: p.magnitude != null && p.magnitude !== '' ? Number(p.magnitude) : null, unit: p.unit ?? null,
      city: p.city ?? '', county: p.county ?? '', state: p.st ?? p.state ?? '', at: p.valid, remark: p.remark ?? null,
      source: p.source ?? null, lat, lng,
    });
  }
  return out;
}
export const REPORT_RADIUS_MI = 5;
export function reportsNear(p: { lat: number | null; lng: number | null }, reports: StormReport[], radius = REPORT_RADIUS_MI) {
  if (p.lat == null || p.lng == null) return [];
  return reports.map((r) => ({ ...r, dist: miles(p.lat!, p.lng!, r.lat, r.lng) }))
    .filter((r) => r.dist <= radius).sort((a, b) => a.dist - b.dist);
}
export const REPORT_STYLE: Record<StormReport['kind'], { color: string; glyph: string; label: string }> = {
  hail: { color: '#4fc3f7', glyph: 'H', label: 'Hail' },
  wind: { color: '#ffb74d', glyph: 'W', label: 'Wind damage' },
  tornado: { color: '#ef5350', glyph: 'T', label: 'Tornado' },
  flood: { color: '#66bb6a', glyph: 'F', label: 'Flooding' },
  other: { color: '#ba68c8', glyph: '•', label: 'Other' },
};
export function reportMag(r: Pick<StormReport, 'magnitude' | 'unit' | 'kind'>) {
  if (r.magnitude == null || !Number.isFinite(r.magnitude)) return '';
  if (r.kind === 'hail') return `${r.magnitude}" hail`;
  if (r.unit === 'MPH') return `${r.magnitude} mph`;
  return `${r.magnitude}${r.unit ? ` ${r.unit.toLowerCase()}` : ''}`;
}

// ---------- forecast ----------
export type Period = { name: string; isDaytime: boolean; temperature: number; temperatureUnit: string; windSpeed: string;
  windDirection: string; shortForecast: string; icon: string; probabilityOfPrecipitation?: { value: number | null } };
export async function fetchForecast(url: string): Promise<Period[]> {
  const r = await fetch(url, { headers: { Accept: 'application/geo+json' } });
  if (!r.ok) throw new Error(`forecast: ${r.status}`);
  return (await r.json())?.properties?.periods ?? [];
}

/** Two-letter state codes for the alert query: from the stored zone codes, else from the address. */
export function statesOf(props: { nws_zone?: string | null; address: string | null }[]) {
  const s = new Set<string>();
  for (const p of props) {
    const z = p.nws_zone?.slice(0, 2);
    const a = p.address?.match(/,\s*([A-Z]{2})\s*\d{5}/)?.[1] ?? p.address?.match(/\b([A-Z]{2})\s+\d{5}(?:-\d{4})?\s*$/)?.[1];
    if (z && /^[A-Z]{2}$/.test(z)) s.add(z); else if (a) s.add(a);
  }
  return [...s].sort();
}

export function ago(iso: string) {
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 60) return `${Math.max(m, 0)} min ago`;
  const h = Math.round(m / 60);
  return h < 48 ? `${h} hr ago` : `${Math.round(h / 24)} days ago`;
}
export const until = (iso: string | null) => {
  if (!iso) return '';
  return new Date(iso).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' });
};
