import { useMemo, useState } from 'react';
import { ENTITIES, refLabel, type Field, type Row, type TableName } from '../lib/schema';
import { useStore } from '../lib/store';
import { date, label, money, pct } from '../lib/format';
import { Pill } from './ui';

export function useCell() {
  const { byId } = useStore();
  return (f: Field, r: Row) => {
    const v = f.computed ? f.computed(r) : r[f.key];
    switch (f.type) {
      case 'money': return <span className={`num ${f.computed && v < 0 ? 'neg' : ''}`}>{money(v)}</span>;
      case 'percent': return <span className="num">{pct(v)}</span>;
      case 'number': return <span className="num">{v ?? ''}</span>;
      case 'date': return date(v);
      case 'select': return f.key === 'status' ? <Pill value={v} /> : label(v);
      case 'ref': return refLabel(f.ref!, byId(f.ref!, v));
      case 'bool': return v ? '✓' : <span className="muted">—</span>;
      case 'url': return v ? <a href={v} target="_blank" rel="noreferrer">open</a> : '';
      case 'textarea': return <span className="clip">{v}</span>;
      default: return v;
    }
  };
}

/** Sortable, searchable, status-filterable table with money totals. */
export function DataTable({ table, rows, onOpen }: { table: TableName; rows?: Row[]; onOpen: (r: Row) => void }) {
  const ent = ENTITIES[table];
  const { data, recent, byId } = useStore();
  const cell = useCell();
  const src = rows ?? data[table];
  const cols = ent.fields.filter((f) => f.table !== false);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 } | null>(null);

  const view = useMemo(() => {
    const needle = q.trim().toLowerCase();
    let out = src.filter((r) => (!status || r[ent.statusKey!] === status));
    if (needle) {
      out = out.filter((r) => cols.some((f) => {
        const v = f.type === 'ref' ? refLabel(f.ref!, byId(f.ref!, r[f.key])) : r[f.key];
        return String(v ?? '').toLowerCase().includes(needle);
      }));
    }
    if (sort) {
      const f = cols.find((c) => c.key === sort.key)!;
      const val = (r: Row) => {
        const v = f.computed ? f.computed(r) : f.type === 'ref' ? refLabel(f.ref!, byId(f.ref!, r[f.key])) : r[f.key];
        return v ?? '';
      };
      out = [...out].sort((a, b) => {
        const x = val(a), y = val(b);
        return (typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), undefined, { numeric: true })) * sort.dir;
      });
    }
    return out;
  }, [src, q, status, sort, byId]);

  const statusOpts = ent.statusKey ? ent.fields.find((f) => f.key === ent.statusKey)?.options ?? [] : [];
  const hasTotals = cols.some((c) => c.total);

  return (
    <div className="table-card">
      <div className="table-tools">
        <input className="search" placeholder={`Search ${ent.label.toLowerCase()}…`} value={q} onChange={(e) => setQ(e.target.value)} />
        {statusOpts.length > 0 && (
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All statuses</option>
            {statusOpts.map((o) => <option key={o} value={o}>{label(o)}</option>)}
          </select>
        )}
        <span className="muted small">{view.length} of {src.length}</span>
      </div>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              {cols.map((c) => (
                <th key={c.key} className={['money', 'number', 'percent'].includes(c.type) ? 'r' : ''}
                    onClick={() => setSort((s) => (s?.key === c.key ? { key: c.key, dir: (s.dir * -1) as 1 | -1 } : { key: c.key, dir: 1 }))}>
                  {c.label}{sort?.key === c.key ? (sort.dir === 1 ? ' ▲' : ' ▼') : ''}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {view.map((r) => (
              <tr key={r.id} className={recent.has(r.id) ? 'flash' : ''} onClick={() => onOpen(r)}>
                {cols.map((c) => <td key={c.key} className={['money', 'number', 'percent'].includes(c.type) ? 'r' : ''}>{cell(c, r)}</td>)}
              </tr>
            ))}
            {!view.length && <tr><td colSpan={cols.length} className="empty">Nothing here yet.</td></tr>}
          </tbody>
          {hasTotals && (
            <tfoot>
              <tr>
                {cols.map((c, i) => (
                  <td key={c.key} className="r">
                    {c.total ? money(view.reduce((a, r) => a + (Number(c.computed ? c.computed(r) : r[c.key]) || 0), 0)) : i === 0 ? 'Total' : ''}
                  </td>
                ))}
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
}
