import { useEffect, useMemo, useState } from 'react';
import { makeCrewDb } from '../lib/crewDb';
import { forProject, useStore } from '../lib/store';
import { attentionItems, budgetRollup, buyoutSummary, overallProgress, totals } from '../lib/rollups';
import { money, moneyShort, pct } from '../lib/format';
import { ZAPIER_FORMS } from '../lib/config';
import { Kpi, Meter, PageHead, Pill } from '../components/ui';
import { JOB_TYPE_LABEL, jobType, type Row } from '../lib/schema';
import { JobTypeTag } from '../components/ui';

/** Company-wide dashboard: cumulative stats across every project + job intake forms. */
export function Home({ openProject }: { openProject: (p: Row) => void }) {
  const { all, byId } = useStore();
  const [statusFilter, setStatusFilter] = useState<'open' | 'all'>('open');
  const [typeFilter, setTypeFilter] = useState<string>('');

  const projects = useMemo(() => {
    let list = [...all.projects].sort((a, b) => String(a.code).localeCompare(String(b.code)));
    if (typeFilter) list = list.filter((p) => jobType(p) === typeFilter);
    return statusFilter === 'open' ? list.filter((p) => !['complete'].includes(p.status)) : list;
  }, [all.projects, statusFilter, typeFilter]);

  const perProject = useMemo(() => projects.map((p) => {
    const d = forProject(all, p.id);
    const t = totals(budgetRollup(d));
    const bo = buyoutSummary(d);
    const gaps = d.scope_gaps.filter((g) => g.status !== 'resolved');
    return {
      p, t, bo, d,
      progress: overallProgress(d),
      openGaps: gaps.length,
      gapCost: gaps.reduce((a, g) => a + (Number(g.est_cost) || 0), 0),
      attention: attentionItems(d, byId).map((a) => ({ ...a, project: p })),
    };
  }), [projects, all, byId]);

  const sum = (f: (x: (typeof perProject)[number]) => number) => perProject.reduce((a, x) => a + f(x), 0);
  const active = perProject.filter((x) => x.p.status === 'active');
  // a job's headline value: contract (renovation), Xactimate (loss) or invoice/contract (GC)
  const jobValue = (p: Row) => Number(jobType(p) === 'loss' ? p.xactimate_amount : jobType(p) === 'gc' ? (p.invoice_amount ?? p.contract_value) : p.contract_value) || 0;
  const contract = sum((x) => jobValue(x.p));
  const revised = sum((x) => x.t.revised);
  const committed = sum((x) => x.t.committed);
  const variance = sum((x) => x.t.variance);
  const invoiced = sum((x) => x.t.invoiced);
  const paid = sum((x) => x.t.paid);
  // progress weighted by contract value of active jobs
  const wProg = active.length
    ? active.reduce((a, x) => a + x.progress * (Number(x.p.contract_value) || 1), 0) /
      active.reduce((a, x) => a + (Number(x.p.contract_value) || 1), 0)
    : 0;
  const attention = perProject.flatMap((x) => x.attention)
    .sort((a, b) => (a.tone === b.tone ? 0 : a.tone === 'red' ? -1 : 1));

  const [formId, setFormId] = useState(ZAPIER_FORMS[0]?.id);
  const form = ZAPIER_FORMS.find((f) => f.id === formId) ?? ZAPIER_FORMS[0];

  return (
    <>
      <PageHead title="All projects">
        <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} style={{ width: 'auto' }} aria-label="Job type">
          <option value="">All job types</option>
          {Object.entries(JOB_TYPE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <div className="seg">
          <button className={statusFilter === 'open' ? 'on' : ''} onClick={() => setStatusFilter('open')}>Open jobs</button>
          <button className={statusFilter === 'all' ? 'on' : ''} onClick={() => setStatusFilter('all')}>All</button>
        </div>
      </PageHead>

      <div className="kpis">
        <Kpi title="Projects" value={projects.length} sub={`${active.length} active · ${projects.filter((p) => p.status === 'precon').length} precon`} />
        <Kpi title="Job value" value={moneyShort(contract)} sub={`Contract / Xactimate / invoice · budget ${moneyShort(revised)}`} />
        <Kpi title="Committed" value={moneyShort(committed)} sub={<><Meter value={committed} max={revised} /> {pct((committed / (revised || 1)) * 100)} of budget</>} />
        <Kpi title="Projected over / under" value={money(variance)} tone={variance < 0 ? 'bad' : 'good'} />
        <Kpi title="Invoiced / paid" value={moneyShort(invoiced)} sub={`${moneyShort(paid)} paid`} />
        <Kpi title="Onsite complete" value={pct(wProg)} sub={<><Meter value={wProg} /> active jobs, weighted by contract</>} />
        <Kpi title="Open scope gaps" value={sum((x) => x.openGaps)} tone={sum((x) => x.openGaps) ? 'bad' : undefined} sub={`${money(sum((x) => x.gapCost))} exposure`} />
      </div>

      <section className="table-card" style={{ marginBottom: 16 }}>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Job</th><th>Project</th><th>Type</th><th>Status</th><th className="r">Value</th><th className="r">Budget</th>
                <th className="r">Committed</th><th className="r">Over / under</th><th className="r">Invoiced</th>
                <th>Onsite</th><th className="r">Bought out</th><th className="r">Open gaps</th>
              </tr>
            </thead>
            <tbody>
              {perProject.map((x) => (
                <tr key={x.p.id} onClick={() => openProject(x.p)}>
                  <td className="mono">{x.p.code}</td>
                  <td><b>{x.p.name}</b><div className="muted small">{x.p.client}</div></td>
                  <td><JobTypeTag type={jobType(x.p)} /></td>
                  <td><Pill value={x.p.status} /></td>
                  <td className="r num">{money(jobValue(x.p))}</td>
                  <td className="r num">{money(x.t.revised)}</td>
                  <td className="r num">{pct((x.t.committed / (x.t.revised || 1)) * 100)}</td>
                  <td className={`r num ${x.t.variance < 0 ? 'neg' : ''}`}>{money(x.t.variance)}</td>
                  <td className="r num">{money(x.t.invoiced)}</td>
                  <td style={{ minWidth: 120 }}><Meter value={x.progress} /> <span className="small muted">{pct(x.progress)}</span></td>
                  <td className="r num">{pct(x.bo.pct)}</td>
                  <td className="r num">{x.openGaps}</td>
                </tr>
              ))}
              {!perProject.length && <tr><td colSpan={12} className="empty">No projects yet.</td></tr>}
            </tbody>
            {perProject.length > 1 && (
              <tfoot>
                <tr>
                  <td>Total</td><td /><td /><td />
                  <td className="r">{money(contract)}</td><td className="r">{money(revised)}</td>
                  <td className="r">{pct((committed / (revised || 1)) * 100)}</td>
                  <td className={`r ${variance < 0 ? 'neg' : ''}`}>{money(variance)}</td>
                  <td className="r">{money(invoiced)}</td><td /><td /><td className="r">{sum((x) => x.openGaps)}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </section>

      <div className="grid2">
        <section className="panel">
          <div className="panel-head"><h2>Needs attention, all jobs</h2><span className="muted small">{attention.length}</span></div>
          <ul className="att">
            {attention.slice(0, 16).map((a) => (
              <li key={a.table + a.id} onClick={() => openProject(a.project)}>
                <span className={`dot ${a.tone}`} />
                <span className="att-kind">{a.project.code}</span>
                <span><b className="small">{a.kind}:</b> {a.text}</span>
              </li>
            ))}
            {!attention.length && <li className="muted">All clear.</li>}
          </ul>
        </section>

        <section className="panel form-panel">
          <div className="panel-head">
            <h2>Job intake</h2>
            {form?.embed && <a className="small" href={form.url} target="_blank" rel="noreferrer">Open in new tab ↗</a>}
          </div>
          {form?.embed && ZAPIER_FORMS.length > 1 && (
            <div className="seg" style={{ marginBottom: 10 }}>
              {ZAPIER_FORMS.map((f) => (
                <button key={f.id} className={f.id === form?.id ? 'on' : ''} onClick={() => setFormId(f.id)}>{f.label}</button>
              ))}
            </div>
          )}
          {form && (
            <>
              {form.embed && <p className="hint" style={{ marginBottom: 8 }}>{form.description}</p>}
              {form.embed ? (
                <iframe key={form.id} className="zap-frame" src={form.url} title={form.label} loading="lazy" />
              ) : (
                <div className="form-cards">
                  {ZAPIER_FORMS.map((f) => (
                    <a key={f.id} className="form-card" href={f.url} target="_blank" rel="noreferrer">
                      <span className="form-card-title">{f.label} ↗</span>
                      <span className="muted small">{f.description}</span>
                    </a>
                  ))}
                </div>
              )}
            </>
          )}
        </section>
      </div>
    </>
  );
}

export function CrewSchedule() {
  const { source } = useStore();
  const [ready, setReady] = useState(false);
  // hand the scheduler (iframe) a shared database before it loads; demo mode falls back to this browser only
  useEffect(() => {
    const db = makeCrewDb(source);
    (window as any).sdrCrewDb = db;
    setReady(true);
    return () => { db?.close(); delete (window as any).sdrCrewDb; };
  }, [source]);
  if (!ready) return null;
  return <iframe className="crew-frame" title="Crew scheduler" src={`${import.meta.env.BASE_URL}crew-scheduler.html`} />;
}
