import { useEffect, useState } from 'react';
import { useStore } from './lib/store';
import { ENTITIES, type TableName } from './lib/schema';
import { BudgetView, BuyoutView, Dashboard, GenericView, ProgressView } from './views/views';
import { RecordDrawer } from './components/RecordDrawer';

const NAV: { key: string; label: string; group: string }[] = [
  { key: 'dashboard', label: 'Dashboard', group: 'Overview' },
  { key: 'budget', label: 'Budget & Cost', group: 'Money' },
  { key: 'change_orders', label: 'Change Orders', group: 'Money' },
  { key: 'invoices', label: 'Invoices', group: 'Money' },
  { key: 'buyout', label: 'Buyout', group: 'Procurement' },
  { key: 'commitments', label: 'Subcontracts & POs', group: 'Procurement' },
  { key: 'material_buys', label: 'Material Buys', group: 'Procurement' },
  { key: 'progress', label: 'Onsite Progress', group: 'Field' },
  { key: 'scope_gaps', label: 'Scope Gaps', group: 'Field' },
  { key: 'scopes', label: 'Scopes of Work', group: 'Documents' },
  { key: 'specs', label: 'Specs', group: 'Documents' },
  { key: 'vendors', label: 'Vendors & Subs', group: 'Directory' },
  { key: 'projects', label: 'All Projects', group: 'Directory' },
];

function readHash() { return location.hash.replace('#/', '') || 'dashboard'; }

export default function App({ onSignOut, onResetDemo }: { onSignOut?: () => void; onResetDemo?: () => void }) {
  const { data, projectId, setProjectId, loading, error, live, lastEvent, source } = useStore();
  const [view, setView] = useState(readHash);
  const [newProject, setNewProject] = useState(false);
  const [navOpen, setNavOpen] = useState(false);

  useEffect(() => {
    const h = () => setView(readHash());
    window.addEventListener('hashchange', h);
    return () => window.removeEventListener('hashchange', h);
  }, []);
  const go = (v: string) => { location.hash = `#/${v}`; setNavOpen(false); };

  const [pulse, setPulse] = useState(false);
  useEffect(() => {
    if (!lastEvent) return;
    setPulse(true);
    const t = setTimeout(() => setPulse(false), 1200);
    return () => clearTimeout(t);
  }, [lastEvent]);

  let body;
  if (error) body = <div className="panel err">Couldn’t load data: {error}</div>;
  else if (loading && !data.projects.length) body = <div className="muted pad">Loading…</div>;
  else if (!data.projects.length) body = (
    <div className="panel pad">
      <h2>No projects yet</h2>
      <button className="primary" onClick={() => setNewProject(true)}>+ Create your first project</button>
    </div>
  );
  else switch (view) {
    case 'dashboard': body = <Dashboard go={go} />; break;
    case 'budget': body = <BudgetView />; break;
    case 'buyout': body = <BuyoutView />; break;
    case 'progress': body = <ProgressView />; break;
    default: body = view in ENTITIES ? <GenericView table={view as TableName} /> : <Dashboard go={go} />;
  }

  let lastGroup = '';
  return (
    <div className="app">
      <aside className={`side ${navOpen ? 'open' : ''}`}>
        <div className="brand"><span className="brand-mark">SDR</span> Renovation PM</div>
        <label className="proj">
          <span className="small muted">Project</span>
          <select value={projectId ?? ''} onChange={(e) => (e.target.value === '__new' ? setNewProject(true) : setProjectId(e.target.value))}>
            {data.projects.map((p) => <option key={p.id} value={p.id}>{p.code ? `${p.code} · ` : ''}{p.name}</option>)}
            <option value="__new">+ New project…</option>
          </select>
        </label>
        <nav>
          {NAV.map((n) => {
            const head = n.group !== lastGroup ? <div className="nav-group" key={n.group}>{n.group}</div> : null;
            lastGroup = n.group;
            return [head, <a key={n.key} href={`#/${n.key}`} className={view === n.key ? 'on' : ''} onClick={() => setNavOpen(false)}>{n.label}</a>];
          })}
        </nav>
        <div className="side-foot">
          <div className={`live ${live ? 'on' : ''} ${pulse ? 'pulse' : ''}`}>
            <span className="live-dot" /> {live ? 'Live' : 'Offline'} · {source.kind === 'demo' ? 'demo data' : 'database'}
          </div>
          {lastEvent && <div className="small muted">Last change: {lastEvent.label} {new Date(lastEvent.at).toLocaleTimeString()}</div>}
          {onResetDemo && <button className="link small" onClick={onResetDemo}>Reset demo data</button>}
          {onSignOut && <button className="link small" onClick={onSignOut}>Sign out</button>}
        </div>
      </aside>
      <main>
        <button className="menu-btn" onClick={() => setNavOpen((o) => !o)}>☰ Menu</button>
        {body}
      </main>
      {newProject && <RecordDrawer table="projects" defaults={{ status: 'active' }} onClose={() => setNewProject(false)} />}
    </div>
  );
}
