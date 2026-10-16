import { useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import 'leaflet.markercluster';
import 'leaflet.markercluster/dist/MarkerCluster.css';
import { useStore } from '../lib/store';
import { labelStyle, labelHex } from '../lib/trello';
import { date } from '../lib/format';

type Label = { id: string; name: string | null; color: string | null };
type Prop = {
  id: string; list_id: string | null; name: string; description: string | null; labels: Label[];
  fields: { key: string; value: string }[]; client: string | null; address: string | null; location_name: string | null;
  lat: number | null; lng: number | null; geo_source: string | null;
  checklists: { id: string; name: string; items: { name: string; done: boolean }[] }[];
  attachments: { name: string; url: string; date: string; mime: string | null }[];
  members: { name: string; username: string }[];
  due: string | null; due_complete: boolean; closed: boolean; pos: number; short_url: string; last_activity: string | null;
};
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

  const listName = useMemo(() => new Map(lists.map((l) => [l.id, l.name])), [lists]);
  const sortedLists = useMemo(() => [...lists].sort((a, b) => a.pos - b.pos), [lists]);
  const clients = useMemo(() => [...new Set(props.map(clientOf).filter(Boolean))].sort(), [props]);
  const shown = useMemo(() => {
    const n = q.trim().toLowerCase();
    return props
      .filter((p) => !state || p.list_id === state)
      .filter((p) => !clientF || clientOf(p) === clientF)
      .filter((p) => !n || [p.name, p.description, p.address, ...p.labels.map((l) => l.name)].some((v) => String(v ?? '').toLowerCase().includes(n)))
      .sort((a, b) => (listName.get(a.list_id ?? '') ?? '').localeCompare(listName.get(b.list_id ?? '') ?? '') || a.pos - b.pos);
  }, [props, q, state, clientF, listName]);
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
              </span>
            </li>
          ))}
        </ul>
      </aside>
      <PropertyMap props={shown} selected={sel} onSelect={setSel} />
      {selected && <PropertyDetail p={selected} listName={listName.get(selected.list_id ?? '') ?? ''} onClose={() => setSel(null)} />}
    </div>
  );
}

function PropertyMap({ props, selected, onSelect }: { props: Prop[]; selected: string | null; onSelect: (id: string) => void }) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const group = useRef<L.MarkerClusterGroup | null>(null);
  const markers = useRef(new Map<string, L.Marker>());
  const fitted = useRef(false);

  useEffect(() => {
    if (!el.current || map.current) return;
    const m = L.map(el.current, { zoomControl: true, worldCopyJump: true }).setView([37.5, -84], 5);
    // Free tile sources that need no API key. Street map is darkened with a CSS filter in dark mode.
    const street = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19, className: dark() ? 'tiles-dark' : '',
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    });
    const satellite = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
      maxZoom: 19, attribution: 'Imagery &copy; Esri, Maxar, Earthstar Geographics',
    });
    street.addTo(m);
    L.control.layers({ Map: street, Satellite: satellite }, undefined, { position: 'topright' }).addTo(m);
    group.current = L.markerClusterGroup({ showCoverageOnHover: false, maxClusterRadius: 45 });
    m.addLayer(group.current);
    map.current = m;
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
      const icon = L.divIcon({
        className: 'tpin', iconSize: [26, 34], iconAnchor: [13, 33], popupAnchor: [0, -30],
        html: `<svg viewBox="0 0 26 34" width="26" height="34"><path d="M13 33s11-11.4 11-19.5A11 11 0 0 0 2 13.5C2 21.6 13 33 13 33z" fill="${pinColor(p)}" stroke="rgba(0,0,0,.45)" stroke-width="1.2"/><circle cx="13" cy="13.5" r="4.2" fill="#fff"/></svg>`,
      });
      const mk = L.marker([p.lat, p.lng], { icon, title: p.name })
        .bindTooltip(esc(p.name), { direction: 'top', offset: [0, -30] })
        .on('click', () => onSelect(p.id));
      markers.current.set(p.id, mk);
      g.addLayer(mk);
      pts.push([p.lat, p.lng]);
    }
    if (pts.length && !fitted.current) { m.fitBounds(L.latLngBounds(pts), { padding: [40, 40], maxZoom: 9 }); fitted.current = true; }
  }, [props, onSelect]);

  // fly to the selected property
  useEffect(() => {
    const mk = selected ? markers.current.get(selected) : null;
    if (mk && group.current && map.current) {
      group.current.zoomToShowLayer(mk, () => { map.current!.panTo(mk.getLatLng()); mk.openTooltip(); });
    }
  }, [selected]);

  return <div className="props-map" ref={el} />;
}

function PropertyDetail({ p, listName, onClose }: { p: Prop; listName: string; onClose: () => void }) {
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
