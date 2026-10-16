import { useEffect, useMemo, useRef, useState } from 'react';
import type { Row } from '../lib/schema';
import { useStore } from '../lib/store';
import { filterTokens } from './DataTable';
import { RecordDrawer } from './RecordDrawer';

/** Pick one or more vendors (search + trade filter) and attach them to the current project. */
export function AssignVendorDialog({ projectId, onClose }: { projectId: string; onClose: () => void }) {
  const { all, data, save } = useStore();
  const [q, setQ] = useState('');
  const [trade, setTrade] = useState('');
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [newVendor, setNewVendor] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const already = useMemo(() => new Set(data.project_vendors.map((a) => a.vendor_id)), [data.project_vendors]);
  const trades = useMemo(() => {
    const m = new Map<string, string>();
    all.vendors.forEach((v) => filterTokens(v.trade).forEach((t) => m.set(t.toLowerCase(), t)));
    return [...m.values()].sort((a, b) => a.localeCompare(b));
  }, [all.vendors]);
  const list = useMemo(() => {
    const n = q.trim().toLowerCase();
    return all.vendors
      .filter((v) => !trade || filterTokens(v.trade).some((t) => t.toLowerCase() === trade.toLowerCase()))
      .filter((v) => !n || [v.name, v.trade, v.contact_name, v.email, v.city, v.state].some((x) => String(x ?? '').toLowerCase().includes(n)))
      .sort((a, b) => String(a.name).localeCompare(String(b.name)));
  }, [all.vendors, q, trade]);

  useEffect(() => {
    setTimeout(() => input.current?.focus(), 0);
    const k = (e: KeyboardEvent) => e.key === 'Escape' && !newVendor && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose, newVendor]);

  const toggle = (id: string) => setPicked((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const assign = async () => {
    setBusy(true); setErr(null);
    try {
      for (const id of picked) {
        const v = all.vendors.find((x) => x.id === id);
        await save('project_vendors', { project_id: projectId, vendor_id: id, role: v?.trade ?? null });
      }
      onClose();
    } catch (e: any) { setErr(e.message ?? String(e)); setBusy(false); }
  };

  return (
    <div className="drawer-wrap" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="drawer">
        <div className="drawer-head">
          <h2>Assign vendors</h2>
          <button className="ghost" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className="drawer-body">
          <div style={{ display: 'flex', gap: 8 }}>
            <input ref={input} placeholder="Search name, trade, contact, city…" value={q} onChange={(e) => setQ(e.target.value)} />
            <select value={trade} onChange={(e) => setTrade(e.target.value)} style={{ width: 'auto' }} aria-label="Filter by trade">
              <option value="">All trades</option>
              {trades.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <ul className="pick-list">
            {list.map((v) => {
              const on = already.has(v.id);
              return (
                <li key={v.id} className={`${picked.has(v.id) ? 'on' : ''} ${on ? 'dim' : ''}`} onClick={() => !on && toggle(v.id)}>
                  <input type="checkbox" readOnly checked={on || picked.has(v.id)} disabled={on} />
                  <span>
                    <b>{v.name}</b>
                    <span className="muted small"> {[v.trade, [v.city, v.state].filter(Boolean).join(', ')].filter(Boolean).join(' · ')}</span>
                    {on && <span className="muted small"> · already on this job</span>}
                  </span>
                </li>
              );
            })}
            {!list.length && <li className="muted">No vendors match.</li>}
          </ul>
          <button type="button" className="link small" style={{ justifySelf: 'start' }} onClick={() => setNewVendor(true)}>+ Add a new vendor to the list</button>
          {err && <div className="err">{err}</div>}
        </div>
        <div className="drawer-foot">
          <span className="muted small">{picked.size} selected</span>
          <span style={{ flex: 1 }} />
          <button className="ghost" onClick={onClose}>Cancel</button>
          <button className="primary" disabled={!picked.size || busy} onClick={assign}>{busy ? 'Assigning…' : `Assign ${picked.size || ''}`}</button>
        </div>
      </div>
      {newVendor && <RecordDrawer table="vendors" onClose={() => setNewVendor(false)} />}
    </div>
  );
}

/** Rows of vendors assigned to the current project, joined with vendor details. */
export function useAssigned(): (Row & { vendor?: Row })[] {
  const { data, byId } = useStore();
  return useMemo(() => data.project_vendors
    .map((a) => ({ ...a, vendor: byId('vendors', a.vendor_id) }))
    .sort((a, b) => String(a.vendor?.name ?? '').localeCompare(String(b.vendor?.name ?? ''))), [data.project_vendors, byId]);
}

/** Opens the user's mail app addressed (Bcc) to these vendors. */
export function emailVendors(rows: (Row & { vendor?: Row })[], subject = '') {
  const list = [...new Set(rows.map((r) => String(r.vendor?.email ?? '').trim()).filter((e) => e.includes('@')))];
  if (!list.length) return 0;
  window.location.href = `mailto:?bcc=${list.map(encodeURIComponent).join(',')}${subject ? `&subject=${encodeURIComponent(subject)}` : ''}`;
  return list.length;
}
