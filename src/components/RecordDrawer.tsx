import { useEffect, useState } from 'react';
import { ENTITIES, refLabel, type Row, type TableName } from '../lib/schema';
import { useStore } from '../lib/store';
import { label } from '../lib/format';

/** Side panel to create or edit any record, driven by the entity config. */
export function RecordDrawer({ table, row, defaults, onClose }:
  { table: TableName; row?: Row | null; defaults?: Partial<Row>; onClose: () => void }) {
  const ent = ENTITIES[table];
  const { data, save, remove } = useStore();
  const [form, setForm] = useState<Partial<Row>>(row ?? defaults ?? {});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [typed, setTyped] = useState('');

  useEffect(() => { setForm(row ?? defaults ?? {}); }, [row, defaults]);
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);

  const set = (k: string, v: any) => setForm((f) => ({ ...f, [k]: v }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const missing = ent.fields.filter((f) => f.required && (!f.showIf || f.showIf(form)) && (form[f.key] == null || form[f.key] === ''));
    if (missing.length) { setErr(`Required: ${missing.map((m) => m.label).join(', ')}`); return; }
    setBusy(true); setErr(null);
    try { await save(table, form); onClose(); }
    catch (x: any) { setErr(x?.message ?? String(x)); }
    finally { setBusy(false); }
  };

  const del = async () => {
    if (!row?.id) return;
    setBusy(true);
    try {
      await remove(table, row.id);
      onClose();
      if (table === 'projects') location.hash = '#/';
    }
    catch (x: any) { setErr(x?.message ?? String(x)); setBusy(false); }
  };

  return (
    <div className="drawer-wrap" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <form className="drawer" onSubmit={submit}>
        <div className="drawer-head">
          <h2>{row?.id ? `Edit ${ent.singular.toLowerCase()}` : `New ${ent.singular.toLowerCase()}`}</h2>
          <button type="button" className="ghost" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className="drawer-body">
          {ent.fields.filter((f) => !f.computed && (!f.showIf || f.showIf(form))).map((f) => {
            const v = form[f.key];
            let input;
            switch (f.type) {
              case 'textarea':
                input = <textarea rows={3} value={v ?? ''} onChange={(e) => set(f.key, e.target.value)} />; break;
              case 'select':
                input = (
                  <select value={v ?? ''} onChange={(e) => set(f.key, e.target.value || null)}>
                    <option value="">—</option>
                    {f.options!.map((o) => <option key={o} value={o}>{f.optionLabels?.[o] ?? label(o)}</option>)}
                  </select>
                ); break;
              case 'ref':
                input = (
                  <select value={v ?? ''} onChange={(e) => set(f.key, e.target.value || null)}>
                    <option value="">—</option>
                    {data[f.ref!].map((r) => <option key={r.id} value={r.id}>{refLabel(f.ref!, r)}</option>)}
                  </select>
                ); break;
              case 'bool':
                input = <input type="checkbox" checked={!!v} onChange={(e) => set(f.key, e.target.checked)} />; break;
              case 'date':
                input = <input type="date" value={v ? String(v).slice(0, 10) : ''} onChange={(e) => set(f.key, e.target.value || null)} />; break;
              case 'number': case 'money': case 'percent':
                input = <input type="number" step="any" inputMode="decimal" value={v ?? ''} onChange={(e) => set(f.key, e.target.value === '' ? null : Number(e.target.value))} />; break;
              default:
                input = <input type={f.type === 'url' ? 'url' : f.type === 'email' ? 'email' : f.type === 'phone' ? 'tel' : 'text'} value={v ?? ''} onChange={(e) => set(f.key, e.target.value)} />;
            }
            return (
              <div key={f.key} style={{ display: 'contents' }}>
                {f.section && <h3 className="drawer-section">{f.section}</h3>}
                <label className={`field ${f.type === 'bool' ? 'field-inline' : ''}`}>
                  <span>{f.label}{f.required && ' *'}</span>
                  {input}
                </label>
              </div>
            );
          })}
          {err && <div className="err">{err}</div>}
          {confirming && row?.id && (
            <div className="confirm-box">
              {table === 'projects' ? (
                <>
                  <b>Delete {row.code ? `${row.code} · ` : ''}{row.name} for good?</b>
                  <p className="small">This also deletes everything inside it: budget, buyout, subcontracts, change orders, material buys,
                    invoices, progress, scope gaps, specs, scopes and vendor assignments. It can’t be undone. Export the project workbook first if you might need it.</p>
                  <label className="field"><span>Type {row.code || row.name} to confirm</span>
                    <input autoFocus value={typed} onChange={(e) => setTyped(e.target.value)} />
                  </label>
                </>
              ) : table === 'vendors' ? (
                <>
                  <b>Delete {row.name}?</b>
                  <p className="small">They’re removed from every job they’re assigned to. Subcontracts, POs and invoices keep their amounts but lose the vendor name. This can’t be undone.</p>
                </>
              ) : (
                <b>Delete this {ent.singular.toLowerCase()}? This can’t be undone.</b>
              )}
              <div className="confirm-actions">
                <button type="button" className="ghost" onClick={() => { setConfirming(false); setTyped(''); }}>Keep it</button>
                <button type="button" className="danger solid" disabled={busy || (table === 'projects' && typed.trim() !== String(row.code || row.name).trim())} onClick={del}>
                  {busy ? 'Deleting…' : 'Delete'}
                </button>
              </div>
            </div>
          )}
        </div>
        <div className="drawer-foot">
          {row?.id && !confirming && <button type="button" className="danger" disabled={busy} onClick={() => setConfirming(true)}>Delete {ent.singular.toLowerCase()}</button>}
          <span style={{ flex: 1 }} />
          <button type="button" className="ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="primary" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
        </div>
      </form>
    </div>
  );
}
