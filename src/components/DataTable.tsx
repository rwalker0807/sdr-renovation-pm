import { useMemo, useState, type ReactNode } from 'react';
import { ENTITIES, refLabel, type Field, type Row, type TableName } from '../lib/schema';
import { useStore } from '../lib/store';
import { date, label, money, pct } from '../lib/format';
import { Pill } from './ui';
import { exportTable } from '../lib/exporter';

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
      case 'phone': return v ? <a href={`tel:${String(v).replace(/[^\d+]/g, '')}`} onClick={(e) => e.stopPropagation()}>{v}</a> : '';
      case 'email': return v ? <a href={`mailto:${v}`} onClick={(e) => e.stopPropagation()} title={`Email ${v}`}>{v}</a> : '';
      case 'textarea': return <span className="clip">{v}</span>;
      default: return v;
    }
  };
}

/** Split a value like "Roofing / siding & windows" into tidy parts for filtering. */
export function filterTokens(v: unknown): string[] {
  return String(v ?? '').split(/\s*(?:\/|&|,|\+|\band\b)\s*/i)
    .map((t) => t.replace(/\(.*?\)/g, '').trim())
    .filter(Boolean)
    .map((t) => t.charAt(0).toUpperCase() + t.slice(1));
}

/** Sortable, searchable, status-filterable table with money totals. */
export function DataTable({ table, rows, onOpen, tools }:
  { table: TableName; rows?: Row[]; onOpen: (r: Row) => void; tools?: (shown: Row[]) => ReactNode }) {
  const ent = ENTITIES[table];
  const { data, recent, byId, projectId } = useStore();
  const cell = useCell();
  const src = rows ?? data[table];
  const cols = ent.fields.filter((f) => f.table !== false);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [facets, setFacets] = useState<Record<string, string>>({});
  const filters = ent.filters ?? [];
  const tokens = (f: { split?: boolean }, v: unknown): string[] =>
    f.split ? filterTokens(v) : String(v ?? '').trim() ? [String(v).trim()] : [];
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 } | null>(null);

  const view = useMemo(() => {
    const needle = q.trim().toLowerCase();
    let out = src.filter((r) => (!status || r[ent.statusKey!] === status));
    for (const f of filters) {
      const want = facets[f.key];
      if (want) out = out.filter((r) => tokens(f, r[f.key]).some((t) => t.toLowerCase() === want.toLowerCase()));
    }
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
  }, [src, q, status, facets, sort, byId]);

  const facetOpts = useMemo(() => Object.fromEntries(filters.map((f) => {
    const m = new Map<string, { label: string; n: number }>();
    src.forEach((r) => tokens(f, r[f.key]).forEach((t) => {
      const k = t.toLowerCase(); const e = m.get(k);
      if (e) e.n++; else m.set(k, { label: t, n: 1 });
    }));
    return [f.key, [...m.values()].sort((a, b) => a.label.localeCompare(b.label))];
  })), [src, filters]);
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
        {filters.map((f) => (
          <select key={f.key} value={facets[f.key] ?? ''} onChange={(e) => setFacets((s) => ({ ...s, [f.key]: e.target.value }))} aria-label={`Filter by ${f.label}`}>
            <option value="">All {f.label}</option>
            {facetOpts[f.key].map((o) => <option key={o.label} value={o.label}>{o.label} ({o.n})</option>)}
          </select>
        ))}
        <span className="muted small">{view.length} of {src.length}</span>
        <span style={{ flex: 1 }} />
        {tools?.(view)}
        <button onClick={() => exportTable(byId('projects', projectId), table, view, byId)} title="Download the rows shown as an Excel file">
          ⤓ Excel
        </button>
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
