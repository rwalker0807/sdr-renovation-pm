import { useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import 'leaflet.markercluster';
import 'leaflet.markercluster/dist/MarkerCluster.css';
import { useStore } from '../lib/store';
import { labelStyle, labelHex } from '../lib/trello';
import { date } from '../lib/format';
import {
  RADAR_STEPS, radarTiles, WARNINGS_WMS, fetchAlerts, fetchStormReports, fetchForecast, alertsFor, reportsNear, statesOf,
  alertColor, REPORT_STYLE, REPORT_RADIUS_MI, reportMag, ago, until, type Alert, type StormReport, type Period,
} from '../lib/weather';

type Label = { id: string; name: string | null; color: string | null };
type Prop = {
  id: string; list_id: string | null; name: string; description: string | null; labels: Label[];
  fields: { key: string; value: string }[]; client: string | null; address: string | null; location_name: string | null;
  lat: number | null; lng: number | null; geo_source: string | null;
  checklists: { id: string; name: string; items: { name: string; done: boolean }[] }[];
  attachments: { name: string; url: string; date: string; mime: string | null }[];
  members: { name: string; username: string }[];
  due: string | null; due_complete: boolean; closed: boolean; pos: number; short_url: string; last_activity: string | null;
  nws_zone?: string | null; nws_county?: string | null; nws_office?: string | null; nws_forecast_url?: string | null;
};
type Impact = { alerts: Alert[]; reports: (StormReport & { dist: number })[] };
export type WxLayers = { radar: boolean; animate: boolean; warnings: boolean; reports: boolean };
type PList = { id: string; name: string; pos: number; closed: boolean };

export const PROPERTIES_BOARD_URL = 'https://trello.com/b/PrMw6Eks/related-properties';

// ---------- tiny, safe renderer for Trello card text (bold, italic, links, emails, phones) ----------
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
function richText(s: string) {
  let h = esc(s);
  h = h.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>');
  h = h.replace(/(^|[\s(])(https?:\/\/[^\s<)]+)/g, '$1<a href="$2" target="_blank" rel="noreferrer">$2</a>');
  h = h.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/(^|\s)_(.+?)_(?=\s|$|[.,;])/g, '$1<i>$2</i>');
  h = h.replace(/([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})/g, '<a href="mailto:$1">$1</a>');
  h = h.replace(/(\(?\b\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}\b)/g, (m) => `<a href="tel:${m.replace(/[^\d]/g, '')}">${m}</a>`);
  return h.replace(/\n/g, '<br/>');
}
const Rich = ({ text }: { text: string }) => <span dangerouslySetInnerHTML={{ __html: richText(text) }} />;

const clientOf = (p: Prop) =>
  p.labels.find((l) => /^client:/i.test(l.name ?? ''))?.name?.replace(/^client:\s*/i, '') ?? p.client ?? '';
const pinColor = (p: Prop) => labelHex(p.labels.find((l) => /^client:/i.test(l.name ?? ''))?.color ?? p.labels[0]?.color ?? null);
const dark = () => window.matchMedia?.('(prefers-color-scheme: dark)').matches && document.documentElement.dataset.theme !== 'light';

/** Live mirror of the Trello "Related Properties" board, shown like Trello's map view. */
export function ClientProperties() {
  const { source } = useStore();
  const client: any = (source as any).client;
  const available = source.kind === 'supabase' && !!client;
  const [props, setProps] = useState<Prop[]>([]);
  const [lists, setLists] = useState<PList[]>([]);
  const [loading, setLoading] = useState(available);
  const [syncing, setSyncing] = useState(false);
  const [msg, setMsg] = useState<{ tone: 'ok' | 'err'; text: string } | null>(null);
  const [q, setQ] = useState('');
  const [state, setState] = useState('');
  const [clientF, setClientF] = useState('');
  const [sel, setSel] = useState<string | null>(null);
  const autoSynced = useRef(false);
  // weather
  const [layers, setLayers] = useState<WxLayers>(() => {
    try { return { radar: true, animate: false, warnings: true, reports: false, ...JSON.parse(localStorage.getItem('sdr.wx') ?? '{}') }; }
    catch { return { radar: true, animate: false, warnings: true, reports: false }; }
  });
  useEffect(() => { try { localStorage.setItem('sdr.wx', JSON.stringify(layers)); } catch { /* private mode */ } }, [layers]);
  const [hours, setHours] = useState(72);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [reports, setReports] = useState<StormReport[]>([]);
  const [wxErr, setWxErr] = useState<string | null>(null);
  const [wxF, setWxF] = useState<'' | 'alert' | 'report'>('');

  const load = async () => {
    const [p, l] = await Promise.all([
      client.from('client_properties').select('*').eq('closed', false),
      client.from('client_property_lists').select('*').eq('closed', false),
    ]);
    if (p.error || l.error) setMsg({ tone: 'err', text: (p.error || l.error).message });
    setProps(p.data ?? []); setLists(l.data ?? []); setLoading(false);
    return (p.data ?? []).length;
  };

  const sync = async () => {
    setSyncing(true); setMsg(null);
    try {
      let data: any;
      // the first sync looks up a batch of addresses per run; keep going until every pin is placed
      for (let run = 0; run < 12; run++) {
        const r = await client.functions.invoke('trello', { body: { action: 'sync_properties' } });
        if (r.error) throw new Error((await r.error.context?.json?.())?.error ?? r.error.message);
        data = r.data;
        await load();
        if (!data.pending) break;
        setMsg({ tone: 'ok', text: `Placing pins… ${data.cards - data.pending} of ${data.cards} done.` });
      }
      setMsg({ tone: 'ok', text: `Synced ${data.cards} properties from Trello · ${data.pinned} on the map${data.cards - data.pinned ? `, ${data.cards - data.pinned} without a findable address` : ''}.` });
      await load();
    } catch (e: any) { setMsg({ tone: 'err', text: e.message ?? String(e) }); }
    finally { setSyncing(false); }
  };

  useEffect(() => {
    if (!available) return;
    let alive = true;
    load().then((n) => { if (alive && n === 0 && !autoSynced.current) { autoSynced.current = true; sync(); } });
    const ch = client.channel('client-properties-live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'client_properties' }, (e: any) => {
        setProps((cur) => {
          const row = e.new as Prop;
          if (e.eventType === 'DELETE' || row?.closed) return cur.filter((x) => x.id !== (e.old?.id ?? row?.id));
          const i = cur.findIndex((x) => x.id === row.id);
          return i < 0 ? [...cur, row] : cur.map((x) => (x.id === row.id ? row : x));
        });
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'client_property_lists' }, () => { load(); })
      .subscribe();
    return () => { alive = false; client.removeChannel(ch); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [available]);

  // active NWS alerts for the states the properties are in (refreshed every 5 minutes)
  const states = useMemo(() => statesOf(props).join(','), [props]);
  useEffect(() => {
    if (!states) return;
    let alive = true;
    const run = () => fetchAlerts(states.split(','))
      .then((a) => { if (alive) { setAlerts(a); setWxErr(null); } })
      .catch((e) => alive && setWxErr(`Weather alerts unavailable (${e.message ?? e})`));
    run();
    const t = setInterval(run, 5 * 60e3);
    return () => { alive = false; clearInterval(t); };
  }, [states]);
  // storm reports (hail, wind damage, tornado, flooding) for the chosen window (refreshed every 10 minutes)
  useEffect(() => {
    let alive = true;
    const run = () => fetchStormReports(hours).then((r) => alive && setReports(r))
      .catch((e) => alive && setWxErr(`Storm reports unavailable (${e.message ?? e})`));
    run();
    const t = setInterval(run, 10 * 60e3);
    return () => { alive = false; clearInterval(t); };
  }, [hours]);
  const impact = useMemo(() => {
    const m = new Map<string, Impact>();
    for (const p of props) {
      const a = alertsFor(p, alerts), r = reportsNear(p, reports);
      if (a.length || r.length) m.set(p.id, { alerts: a, reports: r });
    }
    return m;
  }, [props, alerts, reports]);
  const nAlert = useMemo(() => [...impact.values()].filter((i) => i.alerts.length).length, [impact]);
  const nReport = useMemo(() => [...impact.values()].filter((i) => i.reports.length).length, [impact]);

  const listName = useMemo(() => new Map(lists.map((l) => [l.id, l.name])), [lists]);
  const sortedLists = useMemo(() => [...lists].sort((a, b) => a.pos - b.pos), [lists]);
  const clients = useMemo(() => [...new Set(props.map(clientOf).filter(Boolean))].sort(), [props]);
  const shown = useMemo(() => {
    const n = q.trim().toLowerCase();
    return props
      .filter((p) => !state || p.list_id === state)
      .filter((p) => !clientF || clientOf(p) === clientF)
      .filter((p) => !wxF || (wxF === 'alert' ? !!impact.get(p.id)?.alerts.length : !!impact.get(p.id)?.reports.length))
      .filter((p) => !n || [p.name, p.description, p.address, ...p.labels.map((l) => l.name)].some((v) => String(v ?? '').toLowerCase().includes(n)))
      .sort((a, b) => (listName.get(a.list_id ?? '') ?? '').localeCompare(listName.get(b.list_id ?? '') ?? '') || a.pos - b.pos);
  }, [props, q, state, clientF, listName, wxF, impact]);
  const selected = props.find((p) => p.id === sel) ?? null;

  if (!available) {
    return <div className="panel pad">Client Properties connects to Trello on the live site only. This copy is running on sample data.</div>;
  }

  const placed = shown.filter((p) => p.lat != null).length;
  return (
    <div className="props-page">
      <aside className="props-side">
        <div className="props-head">
          <h1>Client Properties</h1>
          <div className="muted small">{shown.length} of {props.length} · {placed} on map</div>
        </div>
        <input className="search" placeholder="Search name, address, contact…" value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="props-filters">
          <select value={state} onChange={(e) => setState(e.target.value)} aria-label="State">
            <option value="">All states</option>
            {sortedLists.map((l) => <option key={l.id} value={l.id}>{l.name} ({props.filter((p) => p.list_id === l.id).length})</option>)}
          </select>
          <select value={clientF} onChange={(e) => setClientF(e.target.value)} aria-label="Client">
            <option value="">All clients</option>
            {clients.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <div className="props-actions">
          <button disabled={syncing} onClick={sync}>{syncing ? 'Syncing…' : '⟳ Sync from Trello'}</button>
          <a className="btn-link" href={PROPERTIES_BOARD_URL} target="_blank" rel="noreferrer">Open board ↗</a>
        </div>
        {msg && <div className={`banner ${msg.tone}`}>{msg.text}</div>}
        <div className="wx-summary">
          <button className={`wx-chip alert ${wxF === 'alert' ? 'on' : ''}`} disabled={!nAlert} onClick={() => setWxF(wxF === 'alert' ? '' : 'alert')}
            title="Properties inside an active National Weather Service watch, warning or advisory">
            ⚠ {nAlert} under NWS alerts
          </button>
          <button className={`wx-chip report ${wxF === 'report' ? 'on' : ''}`} disabled={!nReport} onClick={() => setWxF(wxF === 'report' ? '' : 'report')}
            title={`Properties within ${REPORT_RADIUS_MI} miles of a hail, wind-damage, tornado or flooding report`}>
            ⛈ {nReport} near storm reports ({hours === 24 ? '24h' : hours === 72 ? '3 days' : '7 days'})
          </button>
        </div>
        {wxErr && <div className="muted small">{wxErr}</div>}
        <ul className="props-list">
          {loading && <li className="muted">Loading…</li>}
          {!loading && !props.length && !syncing && <li className="muted">No properties yet. Click “Sync from Trello”.</li>}
          {shown.map((p) => (
            <li key={p.id} className={p.id === sel ? 'on' : ''} onClick={() => setSel(p.id)}>
              <span className="pin-dot" style={{ background: pinColor(p) }} />
              <span className="props-li">
                <b>{p.name}</b>
                <span className="muted small">{[listName.get(p.list_id ?? ''), p.address].filter(Boolean).join(' · ')}</span>
                {p.lat == null && <span className="small warn-text">No map location</span>}
                <WxBadges i={impact.get(p.id)} />
              </span>
            </li>
          ))}
        </ul>
      </aside>
      <PropertyMap props={shown} selected={sel} onSelect={setSel} impact={impact} alerts={alerts} reports={reports}
        layers={layers} setLayers={setLayers} hours={hours} setHours={setHours} />
      {selected && <PropertyDetail p={selected} listName={listName.get(selected.list_id ?? '') ?? ''} impact={impact.get(selected.id)}
        hours={hours} onClose={() => setSel(null)} />}
    </div>
  );
}

function WxBadges({ i }: { i?: Impact }) {
  if (!i) return null;
  const a = i.alerts[0], r = i.reports[0];
  return (
    <span className="wx-badges">
      {a && <span className="wx-badge" style={{ borderColor: alertColor(a) }}>
        <i style={{ background: alertColor(a) }} />{a.event}{i.alerts.length > 1 ? ` +${i.alerts.length - 1}` : ''}</span>}
      {r && <span className="wx-badge">
        <i style={{ background: REPORT_STYLE[r.kind].color }} />{reportMag(r) || REPORT_STYLE[r.kind].label} · {r.dist.toFixed(1)} mi
        {i.reports.length > 1 ? ` +${i.reports.length - 1}` : ''}</span>}
    </span>
  );
}

type MapProps = {
  props: Prop[]; selected: string | null; onSelect: (id: string) => void; impact: Map<string, Impact>;
  alerts: Alert[]; reports: StormReport[]; layers: WxLayers; setLayers: (f: (l: WxLayers) => WxLayers) => void;
  hours: number; setHours: (h: number) => void;
};

function PropertyMap({ props, selected, onSelect, impact, alerts, reports, layers, setLayers, hours, setHours }: MapProps) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const group = useRef<L.MarkerClusterGroup | null>(null);
  const markers = useRef(new Map<string, L.Marker>());
  const fitted = useRef(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!el.current || map.current) return;
    const m = L.map(el.current, { zoomControl: true, worldCopyJump: true }).setView([37.5, -84], 5);
    // Esri's public basemaps: no API key needed. Dark gray (with place labels) in dark mode, street map in light mode.
    const esri = (svc: string) => `https://server.arcgisonline.com/ArcGIS/rest/services/${svc}/MapServer/tile/{z}/{y}/{x}`;
    const attribution = 'Tiles &copy; Esri &mdash; Esri, HERE, Garmin, USGS, NGA, EPA, USDA, NPS';
    const darkMap = L.layerGroup([
      L.tileLayer(esri('Canvas/World_Dark_Gray_Base'), { maxZoom: 16, attribution }),
      L.tileLayer(esri('Canvas/World_Dark_Gray_Reference'), { maxZoom: 16 }),
    ]);
    const street = L.tileLayer(esri('World_Street_Map'), { maxZoom: 19, attribution });
    const satellite = L.layerGroup([
      L.tileLayer(esri('World_Imagery'), { maxZoom: 19, attribution: 'Imagery &copy; Esri, Maxar, Earthstar Geographics' }),
      L.tileLayer(esri('Reference/World_Boundaries_and_Places'), { maxZoom: 19 }),
    ]);
    (dark() ? darkMap : street).addTo(m);
    L.control.layers(dark() ? { Map: darkMap, Street: street, Satellite: satellite } : { Map: street, Satellite: satellite },
      undefined, { position: 'topright' }).addTo(m);
    group.current = L.markerClusterGroup({
      showCoverageOnHover: false, maxClusterRadius: 45, spiderfyOnMaxZoom: true,
      // round badge with the count; the outer ring is split by the clients' pin colors
      iconCreateFunction: (cluster) => {
        const kids = cluster.getAllChildMarkers();
        const n = kids.length;
        const tally = new Map<string, number>();
        kids.forEach((k) => { const c = (k.options as any).pinColor ?? '#8590a2'; tally.set(c, (tally.get(c) ?? 0) + 1); });
        let at = 0;
        const stops = [...tally.entries()].sort((a, b) => b[1] - a[1]).map(([c, k]) => {
          const from = (at / n) * 360; at += k; return `${c} ${from}deg ${(at / n) * 360}deg`;
        }).join(', ');
        const size = n < 10 ? 34 : n < 50 ? 42 : 50;
        const flag = kids.find((k) => (k.options as any).wxColor);
        return L.divIcon({
          className: 'pcluster', iconSize: [size, size],
          html: `<div class="pcluster-ring" style="width:${size}px;height:${size}px;background:conic-gradient(${stops})"><span>${n}</span>${
            flag ? `<b class="wx-flag" style="background:${(flag.options as any).wxColor}" title="Weather alert">!</b>` : ''}</div>`,
        });
      },
    });
    m.addLayer(group.current);
    // weather sits above the basemap and below the pins
    m.createPane('wx').style.zIndex = '350';
    m.createPane('wxwarn').style.zIndex = '360';
    m.createPane('wxshapes').style.zIndex = '420';
    map.current = m;
    setReady(true);
    const ro = new ResizeObserver(() => m.invalidateSize());
    ro.observe(el.current);
    return () => { ro.disconnect(); m.remove(); map.current = null; };
  }, []);

  // (re)draw pins when the filtered set changes
  useEffect(() => {
    const g = group.current, m = map.current;
    if (!g || !m) return;
    g.clearLayers(); markers.current.clear();
    const pts: L.LatLngExpression[] = [];
    for (const p of props) {
      if (p.lat == null || p.lng == null) continue;
      const wx = impact.get(p.id);
      const wxColor = wx?.alerts.length ? alertColor(wx.alerts[0]) : wx?.reports.length ? REPORT_STYLE[wx.reports[0].kind].color : null;
      const icon = L.divIcon({
        className: 'tpin', iconSize: [26, 34], iconAnchor: [13, 33], popupAnchor: [0, -30],
        html: `<svg viewBox="0 0 26 34" width="26" height="34"><path d="M13 33s11-11.4 11-19.5A11 11 0 0 0 2 13.5C2 21.6 13 33 13 33z" fill="${pinColor(p)}" stroke="rgba(0,0,0,.45)" stroke-width="1.2"/><circle cx="13" cy="13.5" r="4.2" fill="#fff"/></svg>${
          wxColor ? `<b class="wx-flag" style="background:${wxColor}">!</b>` : ''}`,
      });
      const tip = esc(p.name) + (wx?.alerts.length ? `<br/><span class="wx-tip">⚠ ${esc(wx.alerts.map((a) => a.event).join(', '))}</span>` : '')
        + (wx?.reports.length ? `<br/><span class="wx-tip">${esc(reportMag(wx.reports[0]) || REPORT_STYLE[wx.reports[0].kind].label)} ${wx.reports[0].dist.toFixed(1)} mi away</span>` : '');
      const mk = L.marker([p.lat, p.lng], { icon, title: p.name, pinColor: pinColor(p), wxColor } as L.MarkerOptions)
        .bindTooltip(tip, { direction: 'top', offset: [0, -30] })
        .on('click', () => onSelect(p.id));
      markers.current.set(p.id, mk);
      g.addLayer(mk);
      pts.push([p.lat, p.lng]);
    }
    if (pts.length && !fitted.current) { m.fitBounds(L.latLngBounds(pts), { padding: [40, 40], maxZoom: 9 }); fitted.current = true; }
  }, [props, onSelect, impact]);

  // fly to the selected property
  useEffect(() => {
    const mk = selected ? markers.current.get(selected) : null;
    if (mk && group.current && map.current) {
      group.current.zoomToShowLayer(mk, () => { map.current!.panTo(mk.getLatLng()); mk.openTooltip(); });
    }
  }, [selected]);

  // ----- radar: current frame, or the last hour on a loop -----
  const radar = useRef<L.TileLayer[]>([]);
  const [frame, setFrame] = useState(RADAR_STEPS.length - 1);
  const [bucket, setBucket] = useState(() => Math.floor(Date.now() / 300e3));
  useEffect(() => { const t = setInterval(() => setBucket(Math.floor(Date.now() / 300e3)), 60e3); return () => clearInterval(t); }, []);
  useEffect(() => {
    const m = map.current;
    if (!m || !ready) return;
    radar.current.forEach((l) => l.remove()); radar.current = [];
    if (!layers.radar) return;
    const steps = layers.animate ? RADAR_STEPS : [0];
    radar.current = steps.map((mins, i) => L.tileLayer(`${radarTiles(mins)}?v=${bucket}`, {
      pane: 'wx', opacity: i === steps.length - 1 ? 0.7 : 0, maxNativeZoom: 12, maxZoom: 19,
      attribution: 'Radar: NOAA NEXRAD via <a href="https://mesonet.agron.iastate.edu/" target="_blank" rel="noreferrer">Iowa Environmental Mesonet</a>',
    }).addTo(m));
    setFrame(steps.length - 1);
  }, [ready, layers.radar, layers.animate, bucket]);
  useEffect(() => {
    if (!layers.radar || !layers.animate) return;
    let i = RADAR_STEPS.length - 1, hold = 0;
    const t = setInterval(() => {
      if (i === RADAR_STEPS.length - 1 && hold++ < 3) return;   // linger on "now"
      hold = 0; i = (i + 1) % RADAR_STEPS.length;
      radar.current.forEach((l, k) => l.setOpacity(k === i ? 0.7 : 0));
      setFrame(i);
    }, 550);
    return () => clearInterval(t);
  }, [layers.radar, layers.animate, bucket]);

  // ----- NWS warnings: full county/zone coverage image + clickable storm polygons -----
  const warn = useRef<L.Layer[]>([]);
  useEffect(() => {
    const m = map.current;
    if (!m || !ready) return;
    warn.current.forEach((l) => l.remove()); warn.current = [];
    if (!layers.warnings) return;
    const wms = L.tileLayer.wms(WARNINGS_WMS, {
      layers: 'warnings_c,warnings_p', format: 'image/png', transparent: true, opacity: 0.45, pane: 'wxwarn',
      attribution: 'Warnings: NWS via IEM', v: bucket,
    } as L.WMSOptions).addTo(m);
    const shapes = L.geoJSON(undefined, {
      pane: 'wxshapes',
      style: (f) => ({ color: alertColor(f!.properties), weight: 2.5, fillOpacity: 0.08, fillColor: alertColor(f!.properties) }),
      onEachFeature: (f, layer) => layer.bindTooltip(
        `<b>${esc(f.properties.event)}</b><br/>${esc(f.properties.areaDesc ?? '')}${f.properties.expires ? `<br/>until ${esc(until(f.properties.ends ?? f.properties.expires))}` : ''}`,
        { sticky: true }),
    }).addTo(m);
    for (const a of alerts) if (a.geometry) shapes.addData({ type: 'Feature', geometry: a.geometry, properties: a } as any);
    warn.current = [wms, shapes];
  }, [ready, layers.warnings, alerts, bucket]);

  // ----- local storm reports -----
  const lsr = useRef<L.LayerGroup | null>(null);
  useEffect(() => {
    const m = map.current;
    if (!m || !ready) return;
    lsr.current?.remove(); lsr.current = null;
    if (!layers.reports) return;
    const g = L.layerGroup([], { pane: 'wxshapes' });
    for (const r of reports) {
      const st = REPORT_STYLE[r.kind];
      L.marker([r.lat, r.lng], {
        pane: 'wxshapes', keyboard: false,
        icon: L.divIcon({ className: 'lsr', iconSize: [18, 18], html: `<span style="background:${st.color}">${st.glyph}</span>` }),
      }).bindTooltip(`<b>${esc(r.type)}</b>${reportMag(r) ? ` · ${esc(reportMag(r))}` : ''}<br/>${esc([r.city, r.state].filter(Boolean).join(', '))} · ${esc(ago(r.at))}${
        r.remark ? `<br/><span class="wx-tip">${esc(r.remark.slice(0, 180))}</span>` : ''}`).addTo(g);
    }
    g.addTo(m);
    lsr.current = g;
  }, [ready, layers.reports, reports]);

  const toggle = (k: keyof WxLayers) => setLayers((l) => ({ ...l, [k]: !l[k] }));
  const mins = RADAR_STEPS[frame] ?? 0;
  return (
    <div className="props-mapwrap">
      <div className="props-map" ref={el} />
      <div className="wx-panel" onMouseDown={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
        <b className="small">Weather</b>
        <label><input type="checkbox" checked={layers.radar} onChange={() => toggle('radar')} /> Radar</label>
        {layers.radar && (
          <div className="wx-sub">
            <button className="ghost small" onClick={() => toggle('animate')}>{layers.animate ? '❚❚ Stop loop' : '▶ Last hour'}</button>
            <span className="muted small">{layers.animate ? (mins ? `−${mins} min` : 'now') : 'live'}</span>
          </div>
        )}
        {layers.radar && layers.animate && (
          <div className="wx-scrub" aria-hidden>{RADAR_STEPS.map((s, i) => <i key={s} className={i === frame ? 'on' : ''} />)}</div>
        )}
        <label><input type="checkbox" checked={layers.warnings} onChange={() => toggle('warnings')} /> NWS warnings</label>
        <label><input type="checkbox" checked={layers.reports} onChange={() => toggle('reports')} /> Storm reports</label>
        {layers.reports && (
          <div className="wx-sub">
            <select value={hours} onChange={(e) => setHours(Number(e.target.value))} aria-label="Storm report window">
              <option value={24}>Last 24 hours</option><option value={72}>Last 3 days</option><option value={168}>Last 7 days</option>
            </select>
          </div>
        )}
        {layers.reports && (
          <div className="wx-legend small">
            {(['hail', 'wind', 'tornado', 'flood'] as const).map((k) => (
              <span key={k}><span className="lsr-dot" style={{ background: REPORT_STYLE[k].color }}>{REPORT_STYLE[k].glyph}</span>{REPORT_STYLE[k].label}</span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function PropertyWeather({ p, impact, hours }: { p: Prop; impact?: Impact; hours: number }) {
  const [fc, setFc] = useState<Period[] | null>(null);
  const [fcErr, setFcErr] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  useEffect(() => {
    setFc(null); setFcErr(false);
    if (!p.nws_forecast_url) return;
    let alive = true;
    fetchForecast(p.nws_forecast_url).then((x) => alive && setFc(x)).catch(() => alive && setFcErr(true));
    return () => { alive = false; };
  }, [p.nws_forecast_url]);
  const win = hours === 24 ? '24 hours' : hours === 72 ? '3 days' : '7 days';
  return (
    <div className="props-wx">
      <b className="small">Weather</b>
      {impact?.alerts.map((a) => (
        <div key={a.id} className="wx-alert" style={{ borderLeftColor: alertColor(a) }}>
          <div className="wx-alert-head">
            <b>{a.event}</b>
            <span className="muted small">{a.ends || a.expires ? `until ${until(a.ends ?? a.expires)}` : ''}</span>
          </div>
          {a.headline && <div className="small">{a.headline}</div>}
          {(a.description || a.instruction) && (
            open === a.id
              ? <><p className="wx-text small">{a.description}{a.instruction ? `

${a.instruction}` : ''}</p>
                  <button className="link small" onClick={() => setOpen(null)}>Hide details</button></>
              : <button className="link small" onClick={() => setOpen(a.id)}>Details</button>
          )}
        </div>
      ))}
      {!!impact?.reports.length && (
        <div className="wx-reports">
          <div className="muted small">Storm reports within {REPORT_RADIUS_MI} mi · last {win}</div>
          <ul>
            {impact.reports.slice(0, 8).map((r) => (
              <li key={r.id} className="small">
                <span className="lsr-dot" style={{ background: REPORT_STYLE[r.kind].color }}>{REPORT_STYLE[r.kind].glyph}</span>
                <span><b>{r.type}</b>{reportMag(r) ? ` · ${reportMag(r)}` : ''} · {r.dist.toFixed(1)} mi · {ago(r.at)}
                  {r.remark && <span className="muted"> · {r.remark}</span>}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {!impact && <div className="muted small">No active NWS alerts here, and no storm reports within {REPORT_RADIUS_MI} mi in the last {win}.</div>}
      {fc && (
        <div className="wx-fc">
          {fc.slice(0, 6).map((x) => (
            <div key={x.name} className="wx-fc-day" title={x.shortForecast}>
              <span className="muted small">{x.name}</span>
              {x.icon && <img src={x.icon} alt="" width={36} height={36} loading="lazy" />}
              <b>{x.temperature}°</b>
              <span className="small wx-fc-txt">{x.shortForecast}</span>
              {x.probabilityOfPrecipitation?.value ? <span className="small muted">{x.probabilityOfPrecipitation.value}% precip</span> : null}
            </div>
          ))}
        </div>
      )}
      {!fc && p.nws_forecast_url && !fcErr && <div className="muted small">Loading forecast…</div>}
      {!p.nws_forecast_url && p.lat != null && <div className="muted small">Forecast appears after the next “Sync from Trello”.</div>}
    </div>
  );
}

function PropertyDetail({ p, listName, impact, hours, onClose }: { p: Prop; listName: string; impact?: Impact; hours: number; onClose: () => void }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  const fieldKeys = new Set(p.fields.map((f) => f.key.toLowerCase()));
  // description lines that aren't "**Key:** value" pairs (notes, client line, etc.)
  const extra = String(p.description ?? '').split(/\r?\n/).filter((l) => l.trim() && !/^\s*[-*]?\s*\*\*.+?\*\*/.test(l)).join('\n');
  const maps = p.address ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(p.address)}` : null;
  return (
    <section className="props-detail" role="dialog" aria-label={p.name}>
      <div className="props-detail-head">
        <div>
          <div className="muted small">{listName}</div>
          <h2>{p.name}</h2>
        </div>
        <button className="ghost" onClick={onClose} aria-label="Close">✕</button>
      </div>
      {p.labels.length > 0 && (
        <div className="tlabels">{p.labels.map((l) => <span key={l.id} className="tlabel" style={labelStyle(l.color)}>{l.name || ' '}</span>)}</div>
      )}
      {(p.address || p.location_name) && (
        <div className="props-addr">
          <span>📍 {p.location_name && p.location_name !== p.address ? <><b>{p.location_name}</b><br /></> : null}{p.address}</span>
          {maps && <a className="small" href={maps} target="_blank" rel="noreferrer">Directions ↗</a>}
        </div>
      )}
      {p.lat != null && <PropertyWeather p={p} impact={impact} hours={hours} />}
      {p.fields.length > 0 && (
        <dl className="props-fields">
          {p.fields.filter((f) => !/^address$/i.test(f.key)).map((f, i) => (
            <div key={i}><dt>{f.key}</dt><dd><Rich text={f.value} /></dd></div>
          ))}
        </dl>
      )}
      {extra && <p className="props-notes"><Rich text={extra} /></p>}
      {!p.fields.length && p.description && <p className="props-notes"><Rich text={p.description} /></p>}
      {p.due && <p className="small">Due {date(p.due)}{p.due_complete ? ' · complete' : ''}</p>}
      {p.members.length > 0 && <p className="small muted">Members: {p.members.map((m) => m.name).join(', ')}</p>}
      {p.checklists.map((cl) => (
        <div key={cl.id} className="props-check">
          <b className="small">{cl.name} <span className="muted">{cl.items.filter((i) => i.done).length}/{cl.items.length}</span></b>
          <ul>{cl.items.map((it, i) => <li key={i} className={it.done ? 'done' : ''}>{it.done ? '☑' : '☐'} {it.name}</li>)}</ul>
        </div>
      ))}
      {p.attachments.length > 0 && (
        <div className="props-check">
          <b className="small">Attachments</b>
          <ul>{p.attachments.map((a, i) => <li key={i}><a href={a.url} target="_blank" rel="noreferrer">{a.name || a.url}</a></li>)}</ul>
        </div>
      )}
      <div className="props-detail-foot small">
        <a href={p.short_url} target="_blank" rel="noreferrer">Open card in Trello ↗</a>
        {p.geo_source === 'census' && <span className="muted"> · pin placed from the address</span>}
        {p.last_activity && <span className="muted"> · updated {date(p.last_activity)}</span>}
      </div>
      {fieldKeys.size === 0 && !p.description && <p className="muted small">This card has no description.</p>}
    </section>
  );
}
