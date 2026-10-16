import { useEffect, useState } from 'react';
import { useStore } from './lib/store';
import { ENTITIES, type Row, type TableName } from './lib/schema';
import { BudgetView, BuyoutView, Dashboard, GenericView, ProgressView, VendorsView } from './views/views';
import { CrewSchedule, Home } from './views/Home';
import { TrelloBoard } from './views/TrelloBoard';
import { RecordDrawer } from './components/RecordDrawer';
import { ProjectPicker } from './components/ProjectPicker';

// Sidebar inside a project tab
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
];

// Routes:  #/  (home) · #/crew · #/vendors · #/p/<job code>/<view>
type Route = { page: 'home' | 'crew' | 'vendors' | 'trello' } | { page: 'project'; code: string; view: string };
function parseHash(): Route {
  const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean).map(decodeURIComponent);
  if (parts[0] === 'p' && parts[1]) return { page: 'project', code: parts[1], view: parts[2] || 'dashboard' };
  if (parts[0] === 'crew') return { page: 'crew' };
  if (parts[0] === 'trello') return { page: 'trello' };
  if (parts[0] === 'vendors') return { page: 'vendors' };
  return { page: 'home' };
}
const projectHref = (p: Row, view = 'dashboard') => `#/p/${encodeURIComponent(p.code || p.id)}/${view}`;

export default function App({ onSignOut, onResetDemo }: { onSignOut?: () => void; onResetDemo?: () => void }) {
  const { all, setProjectId, loading, error, live, lastEvent, source } = useStore();
  const [route, setRoute] = useState<Route>(parseHash);
  const [newProject, setNewProject] = useState(false);
  const [navOpen, setNavOpen] = useState(false);

  useEffect(() => {
    const h = () => { setRoute(parseHash()); setNavOpen(false); };
    window.addEventListener('hashchange', h);
    return () => window.removeEventListener('hashchange', h);
  }, []);

  const project = route.page === 'project' ? all.projects.find((p) => (p.code || p.id) === route.code) : undefined;

  // keep the store's current project in step with the URL
  useEffect(() => { setProjectId(project?.id ?? null); }, [project?.id, setProjectId]);

  const [pulse, setPulse] = useState(false);
  useEffect(() => {
    if (!lastEvent) return;
    setPulse(true);
    const t = setTimeout(() => setPulse(false), 1200);
    return () => clearTimeout(t);
  }, [lastEvent]);

  const openProject = (p: Row) => { location.hash = projectHref(p); };

  const pview = route.page === 'project' ? route.view : 'dashboard';
  let body;
  if (error) body = <div className="panel err">Couldn’t load data: {error}</div>;
  else if (loading && !all.projects.length) body = <div className="muted pad">Loading…</div>;
  else if (route.page === 'home') body = <Home openProject={openProject} />;
  else if (route.page === 'crew') body = <CrewSchedule />;
  else if (route.page === 'trello') body = <TrelloBoard />;
  else if (route.page === 'vendors') body = <VendorsView />;
  else if (!project) body = <div className="panel pad">That project isn’t in the tracker. <a href="#/">Back to all projects</a></div>;
  else switch (pview) {
    case 'dashboard': body = <Dashboard go={(v) => { location.hash = projectHref(project, v); }} />; break;
    case 'budget': body = <BudgetView />; break;
    case 'buyout': body = <BuyoutView />; break;
    case 'progress': body = <ProgressView />; break;
    default: body = pview in ENTITIES ? <GenericView table={pview as TableName} /> : <Dashboard go={(v) => { location.hash = projectHref(project, v); }} />;
  }

  let lastGroup = '';
  const view = route.page === 'project' ? route.view : '';
  return (
    <div className="shell">
      <header className="topbar">
        <a className="brand" href="#/"><span className="brand-mark">SDR</span><span className="brand-name">Renovation PM</span></a>
        <nav className="tabs" aria-label="Projects">
          <a href="#/" className={route.page === 'home' ? 'on' : ''}>Home</a>
          <ProjectPicker projects={all.projects} current={project} onPick={openProject} onNew={() => setNewProject(true)} />
          <span className="tabs-sep" />
          <a href="#/trello" className={route.page === 'trello' ? 'on' : ''}>Raleigh Board</a>
          <a href="#/crew" className={route.page === 'crew' ? 'on' : ''}>Crew Schedule</a>
          <a href="#/vendors" className={route.page === 'vendors' ? 'on' : ''}>Vendors</a>
        </nav>
        <div className="top-right">
          <span className={`live ${live ? 'on' : ''} ${pulse ? 'pulse' : ''}`} title={lastEvent ? `Last change: ${lastEvent.label} ${new Date(lastEvent.at).toLocaleTimeString()}` : ''}>
            <span className="live-dot" /> {live ? 'Live' : 'Offline'}{source.kind === 'demo' ? ' · demo' : ''}
          </span>
          {onResetDemo && <button className="link small" onClick={onResetDemo}>Reset demo</button>}
          {onSignOut && <button className="link small" onClick={onSignOut}>Sign out</button>}
        </div>
      </header>

      <div className={`app ${project ? 'with-side' : ''}`}>
        {project && (
          <aside className={`side ${navOpen ? 'open' : ''}`}>
            <div className="side-project">
              <div className="mono small">{project.code}</div>
              <div className="side-name">{project.name}</div>
            </div>
            <nav>
              {NAV.map((n) => {
                const head = n.group !== lastGroup ? <div className="nav-group" key={n.group}>{n.group}</div> : null;
                lastGroup = n.group;
                return [head, <a key={n.key} href={projectHref(project, n.key)} className={view === n.key ? 'on' : ''}>{n.label}</a>];
              })}
            </nav>
          </aside>
        )}
        <main className={route.page === 'crew' ? 'full' : ''}>
          {project && <button className="menu-btn" onClick={() => setNavOpen((o) => !o)}>☰ {project.code} menu</button>}
          {body}
        </main>
      </div>
      {newProject && <RecordDrawer table="projects" defaults={{ status: 'active' }} onClose={() => setNewProject(false)} />}
    </div>
  );
}
