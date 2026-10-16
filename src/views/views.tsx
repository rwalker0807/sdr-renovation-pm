import { useMemo, useState } from 'react';
import { ENTITIES, JOB_TYPE_LABEL, STATUS_OPTIONS, jobType, refLabel, type Row, type TableName } from '../lib/schema';
import { useStore } from '../lib/store';
import { AttentionPanel } from '../components/Tasks';
import { attentionItems, budgetRollup, buyoutSummary, overallProgress, totals } from '../lib/rollups';
import { date, money, moneyShort, pct } from '../lib/format';
import { DataTable } from '../components/DataTable';
import { RecordDrawer } from '../components/RecordDrawer';
import { Kpi, Meter, PageHead, Pill } from '../components/ui';
import { exportBudget, exportProject } from '../lib/exporter';
import { TrelloForProject } from './TrelloBoard';
import { ProjectVendorsPanel } from './ProjectVendors';
import { EncircleNote } from '../components/EncircleNote';
import { JobTypeTag } from '../components/ui';

// ---------- drawer helper ----------
type DrawerState = { table: TableName; row?: Row | null; defaults?: Partial<Row> } | null;
function useDrawer() {
  const [d, setD] = useState<DrawerState>(null);
  const el = d ? <RecordDrawer table={d.table} row={d.row} defaults={d.defaults} onClose={() => setD(null)} /> : null;
  return [el, (table: TableName, row?: Row | null, defaults?: Partial<Row>) => setD({ table, row, defaults })] as const;
}

// ---------- generic module page ----------
export function GenericView({ table }: { table: TableName }) {
  const [drawer, open] = useDrawer();
  const ent = ENTITIES[table];
  return (
    <>
      <PageHead title={ent.label}>
        <button className="primary" onClick={() => open(table)}>+ New {ent.singular.toLowerCase()}</button>
      </PageHead>
      <DataTable table={table} onOpen={(r) => open(table, r)} />
      {drawer}
    </>
  );
}

// ---------- water/fire loss + GC job summaries ----------
function JobKpis({ project: p, invoiced, paid, committed, vendorTotal }:
  { project: Row; invoiced: number; paid: number; committed: number; vendorTotal: number }) {
  const m = (v: unknown) => (v == null || v === '' ? '—' : money(v as number));
  const cost = Math.max(committed, vendorTotal);
  if (jobType(p) === 'loss') {
    const total = (Number(p.ems_amount) || 0) + (Number(p.rebuild_amount) || 0);
    return (
      <div className="kpis">
        <Kpi title="Xactimate" value={m(p.xactimate_amount)} sub={p.claim_number ? `Claim ${p.claim_number}` : 'Estimate total'} />
        <Kpi title="EMS" value={m(p.ems_amount)} sub="Emergency mitigation" />
        <Kpi title="Rebuild" value={m(p.rebuild_amount)} sub={total ? `EMS + rebuild ${moneyShort(total)}` : ''} />
        <Kpi title="Vendor cost" value={money(cost)} sub={`${moneyShort(vendorTotal)} assigned · ${moneyShort(committed)} committed`} />
        <Kpi title="Vendor invoices" value={moneyShort(invoiced)} sub={`${moneyShort(paid)} paid`} />
      </div>
    );
  }
  const value = Number(p.invoice_amount) || Number(p.contract_value) || 0;
  return (
    <div className="kpis">
      <Kpi title="Invoice amount" value={m(p.invoice_amount)} sub={p.invoiced_date ? `Invoiced ${date(p.invoiced_date)}` : 'Not invoiced yet'} />
      <Kpi title="Contract value" value={m(p.contract_value)} sub={p.po_number ? `PO ${p.po_number}` : ''} />
      <Kpi title="Vendor cost" value={money(cost)} sub={`${moneyShort(vendorTotal)} assigned · ${moneyShort(committed)} committed`} />
      <Kpi title="Margin" value={value ? money(value - cost) : '—'} tone={value && value - cost < 0 ? 'bad' : undefined} sub={value ? pct(((value - cost) / value) * 100) : ''} />
      <Kpi title="Vendor invoices" value={moneyShort(invoiced)} sub={`${moneyShort(paid)} paid`} />
    </div>
  );
}

function JobDetails({ project: p, onEdit }: { project: Row; onEdit: () => void }) {
  const loss = jobType(p) === 'loss';
  const rows: [string, React.ReactNode][] = [
    ['Job type', JOB_TYPE_LABEL[jobType(p)]],
    ['Client', p.client], ['Billed to', p.billed_to], ['Address', p.address],
    ...(loss ? [
      ['Loss type', p.loss_type ? String(p.loss_type).replace(/^./, (c: string) => c.toUpperCase()) : null],
      ['Date of loss', p.loss_date ? date(p.loss_date) : null], ['Claim #', p.claim_number], ['Carrier / adjuster', p.carrier],
    ] as [string, React.ReactNode][] : [
      ['PO / work order #', p.po_number], ['Invoiced on', p.invoiced_date ? date(p.invoiced_date) : null],
    ] as [string, React.ReactNode][]),
    ['Encircle', p.encircle_url ? <a href={p.encircle_url} target="_blank" rel="noreferrer">Open claim ↗</a> : null],
    ['Start', p.start_date ? date(p.start_date) : null], ['Target completion', p.target_completion ? date(p.target_completion) : null],
  ];
  return (
    <section className="panel">
      <div className="panel-head"><h2>Job details</h2><button className="link small" onClick={onEdit}>Edit →</button></div>
      <dl className="details">
        {rows.filter(([, v]) => v != null && v !== '').map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}
      </dl>
      {!loss && p.scope_description && <><h3 className="small muted" style={{ margin: '12px 0 4px' }}>SCOPE</h3><p className="pre">{p.scope_description}</p></>}
    </section>
  );
}

// ---------- vendors & subs ----------
/** Vendors list with a trade filter and an "Email these" button that opens a pre-addressed email. */
export function VendorsView() {
  const [drawer, open] = useDrawer();
  const [note, setNote] = useState('');
  const emailAll = async (shown: Row[]) => {
    const list = [...new Set(shown.map((r) => String(r.email ?? '').trim()).filter((e) => e.includes('@')))];
    if (!list.length) { setNote('None of the vendors shown have an email yet.'); return; }
    const href = `mailto:?bcc=${list.map(encodeURIComponent).join(',')}`;
    if (href.length < 1900) { window.location.href = href; setNote(`Opened a new email to ${list.length} (Bcc).`); return; }
    try { await navigator.clipboard.writeText(list.join('; ')); setNote(`${list.length} addresses copied — paste them into Bcc.`); }
    catch { setNote('Too many addresses for one email link; narrow the filter.'); }
  };
  return (
    <>
      <PageHead title="Vendors & Subs">
        <button className="primary" onClick={() => open('vendors')}>+ New vendor</button>
      </PageHead>
      {note && <p className="hint">{note}</p>}
      <DataTable table="vendors" onOpen={(r) => open('vendors', r)}
        tools={(shown) => (
          <button onClick={() => emailAll(shown)} title="Start an email (Bcc) to every vendor shown, in your own mail app">
            ✉ Email {shown.filter((r) => String(r.email ?? '').includes('@')).length}
          </button>
        )} />
      {drawer}
    </>
  );
}

// ---------- dashboard ----------
export function Dashboard({ go }: { go: (v: string) => void }) {
  const { data, byId, projectId } = useStore();
  const [drawer, open] = useDrawer();
  const project = byId('projects', projectId);
  const jt = jobType(project);
  const roll = useMemo(() => budgetRollup(data), [data]);
  const t = totals(roll);
  const bo = buyoutSummary(data);
  const prog = overallProgress(data);
  const att = useMemo(() => attentionItems(data, byId), [data, byId]);
  const openGaps = data.scope_gaps.filter((g) => g.status !== 'resolved');

  // division rollup for the bar list
  const byDiv = useMemo(() => {
    const m = new Map<string, { revised: number; committed: number; projected: number }>();
    roll.forEach((r) => {
      const k = r.line.division || 'Other';
      const v = m.get(k) ?? { revised: 0, committed: 0, projected: 0 };
      v.revised += r.revised; v.committed += r.committed; v.projected += r.projected;
      m.set(k, v);
    });
    return [...m.entries()].sort((a, b) => b[1].revised - a[1].revised);
  }, [roll]);

  return (
    <>
      <PageHead title={project ? project.name : 'Dashboard'}>
        {project && <span className="muted small"><JobTypeTag type={jt} /> {project.code}{project.address ? ` · ${project.address}` : ''} · <Pill value={project.status} /></span>}
        {project?.encircle_url && <a className="btn-link" href={project.encircle_url} target="_blank" rel="noreferrer" title="Open this job's Encircle claim">Encircle ↗</a>}
        {project && <button onClick={() => open('projects', project)}>✎ Edit job</button>}
        <button onClick={() => exportProject(project, data, byId)} title="Every tracker for this project in one Excel workbook">⤓ Project workbook</button>
      </PageHead>

      {jt !== 'renovation' && project ? (
        <>
          <JobKpis project={project} invoiced={t.invoiced} paid={t.paid} committed={t.committed} vendorTotal={data.project_vendors.reduce((a, r) => a + (Number(r.amount) || 0), 0)} />
          <EncircleNote project={project} />
          <TrelloForProject code={project.code} />
          <div className="grid2">
            <JobDetails project={project} onEdit={() => open('projects', project)} />
            <ProjectVendorsPanel go={() => go('project_vendors')} />
          </div>
          <div style={{ marginTop: 16 }}>
            <AttentionPanel title="Needs attention" items={att} projectId={projectId} limit={14} onOpenItem={(a) => open(a.table, byId(a.table, a.id))} />
          </div>
        </>
      ) : (<>
      <div className="kpis">
        <Kpi title="Contract value" value={money(project?.contract_value)} sub={`Revised budget ${moneyShort(t.revised)}`} />
        <Kpi title="Committed" value={moneyShort(t.committed)} sub={<><Meter value={t.committed} max={t.revised} /> {pct((t.committed / (t.revised || 1)) * 100)} of budget</>} />
        <Kpi title="Projected over / under" value={money(t.variance)} tone={t.variance < 0 ? 'bad' : 'good'} sub={`Projected cost ${moneyShort(t.projected)}`} />
        <Kpi title="Invoiced / paid" value={moneyShort(t.invoiced)} sub={`${moneyShort(t.paid)} paid`} />
        <Kpi title="Onsite complete" value={pct(prog)} sub={<Meter value={prog} />} />
        <Kpi title="Bought out" value={pct(bo.pct)} sub={`${bo.boughtCount}/${bo.count} packages · ${money(bo.savings)} buyout +/-`} />
        <Kpi title="Open scope gaps" value={openGaps.length} tone={openGaps.length ? 'bad' : undefined}
             sub={`${money(openGaps.reduce((a, g) => a + (Number(g.est_cost) || 0), 0))} exposure`} />
      </div>

      <EncircleNote project={project} />
      <TrelloForProject code={project?.code} />
      <div className="grid2">
        <AttentionPanel title="Needs attention" items={att} projectId={projectId} limit={14} onOpenItem={(a) => open(a.table, byId(a.table, a.id))} />
        <section className="panel">
          <div className="panel-head"><h2>Budget by division</h2><button className="link" onClick={() => go('budget')}>Budget →</button></div>
          <div className="bars">
            {byDiv.map(([div, v]) => (
              <div key={div} className="bar-row">
                <div className="bar-label">{div}</div>
                <div className="bar-track">
                  <div className="bar-committed" style={{ width: `${Math.min(100, (v.committed / (v.revised || 1)) * 100)}%` }} />
                  {v.projected > v.revised && <div className="bar-over" />}
                </div>
                <div className={`bar-val num ${v.projected > v.revised ? 'neg' : ''}`}>{moneyShort(v.revised - v.projected)}</div>
              </div>
            ))}
          </div>
          <div className="legend small muted"><span className="sw committed" /> committed vs revised budget · right column = projected over/under</div>
        </section>
      </div>
      <div className="grid2" style={{ marginTop: 16 }}>
        <ProjectVendorsPanel go={() => go('project_vendors')} />
      </div>
      </>)}
      {drawer}
    </>
  );
}

// ---------- budget ----------
export function BudgetView() {
  const { data, recent, byId, projectId } = useStore();
  const [drawer, open] = useDrawer();
  const [sel, setSel] = useState<string | null>(null);
  const roll = useMemo(() => budgetRollup(data), [data]);
  const t = totals(roll);
  const cols: [keyof typeof t, string][] = [
    ['original', 'Original'], ['ownerChanges', 'Owner COs'], ['revised', 'Revised'], ['committed', 'Committed'],
    ['unbought', 'Unbought'], ['exposure', 'Exposure'], ['projected', 'Projected'], ['variance', 'Over / under'],
    ['invoiced', 'Invoiced'], ['paid', 'Paid'],
  ];
  const selRow = roll.find((r) => r.line.id === sel);

  return (
    <>
      <PageHead title="Budget & cost">
        <button onClick={() => exportBudget(byId('projects', projectId), data)}>⤓ Excel</button>
        <button onClick={() => open('change_orders')}>+ Change order</button>
        <button className="primary" onClick={() => open('budget_lines')}>+ Budget line</button>
      </PageHead>
      <p className="hint">Committed = executed/out-for-signature subcontracts + approved sub COs + ordered materials. Unbought = budget for packages not yet awarded. Exposure = pending sub COs + open scope gaps.</p>
      <div className="table-card">
        <div className="table-scroll">
          <table>
            <thead><tr><th>Cost code</th><th>Description</th>{cols.map(([, l]) => <th key={l} className="r">{l}</th>)}<th /></tr></thead>
            <tbody>
              {roll.map((r) => (
                <tr key={r.line.id} className={`${recent.has(r.line.id) ? 'flash' : ''} ${sel === r.line.id ? 'sel' : ''}`} onClick={() => setSel(r.line.id === sel ? null : r.line.id)}>
                  <td className="mono">{r.line.cost_code}</td><td>{r.line.description}</td>
                  {cols.map(([k]) => <td key={k} className={`r num ${k === 'variance' && r[k] < 0 ? 'neg' : ''}`}>{money(r[k])}</td>)}
                  <td><button className="link" onClick={(e) => { e.stopPropagation(); open('budget_lines', r.line); }}>edit</button></td>
                </tr>
              ))}
            </tbody>
            <tfoot><tr><td>Total</td><td />{cols.map(([k]) => <td key={k} className={`r ${k === 'variance' && t[k] < 0 ? 'neg' : ''}`}>{money(t[k])}</td>)}<td /></tr></tfoot>
          </table>
        </div>
      </div>
      {selRow && <LineDetail lineId={selRow.line.id} title={`${selRow.line.cost_code} · ${selRow.line.description}`} open={open} />}
      {drawer}
    </>
  );
}

function LineDetail({ lineId, title, open }: { lineId: string; title: string; open: (t: TableName, r?: Row | null, d?: Partial<Row>) => void }) {
  const { data, byId } = useStore();
  const on = (r: Row) => r.budget_line_id === lineId;
  const groups: [TableName, Row[], (r: Row) => string, (r: Row) => number][] = [
    ['commitments', data.commitments.filter(on), (r) => `${r.number} · ${byId('vendors', r.vendor_id)?.name ?? ''}`, (r) => r.amount],
    ['change_orders', data.change_orders.filter(on), (r) => `${r.co_number} (${r.kind}) ${r.description}`, (r) => r.amount],
    ['material_buys', data.material_buys.filter(on), (r) => r.item, (r) => r.quantity * r.unit_cost],
    ['invoices', data.invoices.filter(on), (r) => `${byId('vendors', r.vendor_id)?.name ?? ''} #${r.invoice_number}`, (r) => r.amount],
    ['scope_gaps', data.scope_gaps.filter(on), (r) => r.title, (r) => r.est_cost],
  ];
  return (
    <section className="panel" style={{ marginTop: 16 }}>
      <div className="panel-head"><h2>{title}</h2></div>
      <div className="detail-grid">
        {groups.map(([t, rows, lab, amt]) => (
          <div key={t}>
            <div className="detail-h">{ENTITIES[t].label} <button className="link" onClick={() => open(t, null, { budget_line_id: lineId })}>+ add</button></div>
            {rows.length ? rows.map((r) => (
              <div key={r.id} className="detail-row" onClick={() => open(t, r)}>
                <span>{lab(r)}</span><span className="num">{money(amt(r))}</span>{r.status && <Pill value={r.status} />}
              </div>
            )) : <div className="muted small">None</div>}
          </div>
        ))}
      </div>
    </section>
  );
}

// ---------- buyout board ----------
export function BuyoutView() {
  const { data, byId, recent } = useStore();
  const [drawer, open] = useDrawer();
  const [mode, setMode] = useState<'board' | 'table'>('board');
  const bo = buyoutSummary(data);
  return (
    <>
      <PageHead title="Buyout tracking">
        <div className="seg">
          <button className={mode === 'board' ? 'on' : ''} onClick={() => setMode('board')}>Board</button>
          <button className={mode === 'table' ? 'on' : ''} onClick={() => setMode('table')}>Table</button>
        </div>
        <button className="primary" onClick={() => open('buyout_packages')}>+ Package</button>
      </PageHead>
      <div className="kpis small-kpis">
        <Kpi title="Bought out" value={pct(bo.pct)} sub={<Meter value={bo.pct} />} />
        <Kpi title="Budget bought" value={moneyShort(bo.boughtBudget)} sub={`of ${moneyShort(bo.budget)}`} />
        <Kpi title="Awarded" value={moneyShort(bo.awarded)} />
        <Kpi title="Buyout +/-" value={money(bo.savings)} tone={bo.savings < 0 ? 'bad' : 'good'} />
      </div>
      {mode === 'table' ? <DataTable table="buyout_packages" onOpen={(r) => open('buyout_packages', r)} /> : (
        <div className="board">
          {STATUS_OPTIONS.buyout.map((st) => {
            const items = data.buyout_packages.filter((p) => p.status === st);
            return (
              <div key={st} className="col">
                <div className="col-head"><Pill value={st} /><span className="muted small">{items.length} · {moneyShort(items.reduce((a, p) => a + (Number(p.budget_amount) || 0), 0))}</span></div>
                {items.map((p) => {
                  const v = p.awarded_amount != null ? Number(p.budget_amount) - Number(p.awarded_amount) : null;
                  const late = p.target_award && p.target_award < new Date().toISOString().slice(0, 10) && !['awarded', 'contracted'].includes(p.status);
                  return (
                    <div key={p.id} className={`card ${recent.has(p.id) ? 'flash' : ''}`} onClick={() => open('buyout_packages', p)}>
                      <div className="card-title">{p.package}</div>
                      <div className="muted small">{refLabel('budget_lines', byId('budget_lines', p.budget_line_id))}</div>
                      <div className="card-row"><span>Budget</span><span className="num">{money(p.budget_amount)}</span></div>
                      {p.awarded_amount != null && <div className="card-row"><span>{byId('vendors', p.awarded_vendor_id)?.name}</span><span className={`num ${v! < 0 ? 'neg' : 'pos'}`}>{money(p.awarded_amount)}</span></div>}
                      <div className={`card-row small ${late ? 'neg' : 'muted'}`}><span>{p.bids_received ?? 0} bids</span><span>award {date(p.target_award)}</span></div>
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      )}
      {drawer}
    </>
  );
}

// ---------- onsite progress matrix ----------
export function ProgressView() {
  const { data, recent, save, source } = useStore();
  const [drawer, open] = useDrawer();
  const [mode, setMode] = useState<'matrix' | 'table'>('matrix');
  const buildings = useMemo(() => [...new Set(data.progress.map((p) => p.building))].sort(), [data.progress]);
  const acts = useMemo(() => [...new Set(data.progress.map((p) => p.activity))], [data.progress]);
  const cell = useMemo(() => {
    const m = new Map<string, Row>();
    data.progress.forEach((p) => { if (!p.unit) m.set(`${p.building}|${p.activity}`, p); });
    return m;
  }, [data.progress]);
  const avg = (rows: Row[]) => (rows.length ? rows.reduce((a, r) => a + Number(r.pct_complete || 0), 0) / rows.length : 0);

  // demo-only: simulate a field update to show live push
  const simulate = () => {
    const pool = data.progress.filter((p) => p.pct_complete < 100 && p.status !== 'blocked');
    const p = pool[Math.floor(Math.random() * pool.length)];
    if (!p) return;
    const next = Math.min(100, Number(p.pct_complete) + 25);
    save('progress', { ...p, pct_complete: next, status: next >= 100 ? 'complete' : 'in_progress', updated_by: 'Field (simulated)' });
  };

  return (
    <>
      <PageHead title="Onsite progress">
        {source.kind === 'demo' && <button onClick={simulate}>Simulate field update</button>}
        <div className="seg">
          <button className={mode === 'matrix' ? 'on' : ''} onClick={() => setMode('matrix')}>Matrix</button>
          <button className={mode === 'table' ? 'on' : ''} onClick={() => setMode('table')}>Table</button>
        </div>
        <button className="primary" onClick={() => open('progress')}>+ Item</button>
      </PageHead>
      {mode === 'table' ? <DataTable table="progress" onOpen={(r) => open('progress', r)} /> : (
        <div className="table-card">
          <div className="table-scroll">
            <table className="matrix">
              <thead>
                <tr><th>Building</th>{acts.map((a) => <th key={a} className="c">{a}</th>)}<th className="c">Avg</th></tr>
              </thead>
              <tbody>
                {buildings.map((b) => (
                  <tr key={b}>
                    <td className="mono">{b}</td>
                    {acts.map((a) => {
                      const p = cell.get(`${b}|${a}`);
                      if (!p) return <td key={a} className="c muted" onClick={() => open('progress', null, { building: b, activity: a, pct_complete: 0, status: 'not_started' })}>+</td>;
                      const v = Number(p.pct_complete);
                      return (
                        <td key={a} title={`${b} · ${a}${p.notes ? '\n' + p.notes : ''}`}
                            className={`c heat ${p.status === 'blocked' ? 'blocked' : ''} ${recent.has(p.id) ? 'flash' : ''}`}
                            style={{ ['--p' as any]: v / 100 }} onClick={() => open('progress', p)}>
                          {p.status === 'blocked' ? '!' : v}
                        </td>
                      );
                    })}
                    <td className="c num strong">{pct(avg(data.progress.filter((p) => p.building === b)))}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr><td>Avg</td>{acts.map((a) => <td key={a} className="c">{pct(avg(data.progress.filter((p) => p.activity === a)))}</td>)}<td className="c strong">{pct(overallProgress(data))}</td></tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}
      <p className="hint">Click any cell to update. "!" = blocked. Changes from the field show up here instantly for everyone.</p>
      {drawer}
    </>
  );
}
