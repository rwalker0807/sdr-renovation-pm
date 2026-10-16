import { useEffect, useMemo, useState } from 'react';
import type { Row, TableName } from '../lib/schema';
import { useStore } from '../lib/store';
import { RecordDrawer } from './RecordDrawer';

export type AttItem = { kind: string; text: string; tone: 'red' | 'amber'; table: TableName; id: string; project?: Row };

const today = () => new Date().toLocaleDateString('en-CA');
const dueLabel = (d?: string | null) => {
  if (!d) return '';
  const days = Math.round((new Date(d + 'T12:00').getTime() - new Date(today() + 'T12:00').getTime()) / 864e5);
  if (days < 0) return `${-days} day${days === -1 ? '' : 's'} overdue`;
  if (days === 0) return 'due today';
  if (days === 1) return 'due tomorrow';
  if (days < 7) return `due ${new Date(d + 'T12:00').toLocaleDateString([], { weekday: 'short' })}`;
  return `due ${new Date(d + 'T12:00').toLocaleDateString([], { month: 'short', day: 'numeric' })}`;
};
const initials = (n?: string) => String(n ?? '').split(/\s+/).filter(Boolean).slice(0, 2).map((x) => x[0]).join('').toUpperCase();

/** The signed-in person's Directory entry (matched by email), if any. */
function useMe() {
  const { source, all } = useStore();
  const [email, setEmail] = useState<string | null>(null);
  useEffect(() => {
    const c = (source as any).client;
    c?.auth.getUser().then(({ data }: any) => setEmail(data.user?.email?.toLowerCase() ?? null));
  }, [source]);
  return useMemo(() => (email ? all.sdr_people.find((p) => String(p.email ?? '').toLowerCase() === email) : undefined), [email, all.sdr_people]);
}

/**
 * "Needs attention": open tasks (assignable to anyone in the Directory) on top, then the automatic flags
 * (late buyout, materials due, invoices waiting, COIs, blocked work, open gaps).
 * projectId set = one job's dashboard; unset = home page (every job + company-wide tasks).
 */
export function AttentionPanel({ title, items, projectId, onOpenItem, limit = 16 }:
  { title: string; items: AttItem[]; projectId?: string | null; onOpenItem: (a: AttItem) => void; limit?: number }) {
  const { all, data, byId, save } = useStore();
  const me = useMe();
  const [who, setWho] = useState('');            // '' everyone · 'me' · person id · 'none'
  const [showDone, setShowDone] = useState(false);
  const [edit, setEdit] = useState<{ row?: Row | null; defaults?: Partial<Row> } | null>(null);
  const [more, setMore] = useState(false);
  const [justDone, setJustDone] = useState<Set<string>>(new Set());   // ticked here: stay visible (struck through) so they can be unticked

  const pool = projectId ? data.tasks : all.tasks;
  const people = useMemo(() => {
    const ids = new Set(pool.filter((t) => t.status === 'open' && t.assignee_id).map((t) => t.assignee_id));
    return all.sdr_people.filter((p) => ids.has(p.id)).sort((a, b) => String(a.name).localeCompare(String(b.name)));
  }, [pool, all.sdr_people]);
  const match = (t: Row) => !who || (who === 'me' ? t.assignee_id === me?.id : who === 'none' ? !t.assignee_id : t.assignee_id === who);
  const tasks = useMemo(() => pool
    .filter((t) => (showDone ? t.status === 'done' : t.status !== 'done' || justDone.has(t.id)) && match(t))
    .sort((a, b) => (showDone
      ? String(b.completed_at ?? '').localeCompare(String(a.completed_at ?? ''))
      : (a.priority === 'high' ? 0 : 1) - (b.priority === 'high' ? 0 : 1)
        || String(a.due_date ?? '9999').localeCompare(String(b.due_date ?? '9999'))
        || String(a.created_at).localeCompare(String(b.created_at)))),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [pool, who, showDone, me?.id, justDone]);
  const openCount = pool.filter((t) => t.status !== 'done').length;
  const doneCount = pool.filter((t) => t.status === 'done').length;

  const toggle = (t: Row) => {
    if (t.status !== 'done') setJustDone((s) => new Set(s).add(t.id));
    return save('tasks', {
    id: t.id, project_id: t.project_id, status: t.status === 'done' ? 'open' : 'done',
    completed_at: t.status === 'done' ? null : new Date().toISOString(),
    });
  };

  const shownItems = who ? [] : items;      // the automatic flags aren't assigned to anyone
  const rows: { t?: Row; a?: AttItem }[] = [...tasks.map((t) => ({ t })), ...(showDone ? [] : shownItems.map((a) => ({ a })))];
  const visible = more ? rows : rows.slice(0, limit);

  return (
    <section className="panel">
      <div className="panel-head att-head">
        <h2>{title}</h2>
        <span className="muted small">{openCount} task{openCount === 1 ? '' : 's'} · {items.length} flag{items.length === 1 ? '' : 's'}</span>
        <span style={{ flex: 1 }} />
        <button className="primary small" onClick={() => setEdit({ defaults: { project_id: projectId ?? null, assignee_id: me?.id ?? null, status: 'open', priority: 'normal' } })}>+ Task</button>
      </div>
      {(pool.length > 0) && (
        <div className="att-tools">
          <select value={who} onChange={(e) => setWho(e.target.value)} aria-label="Assigned to">
            <option value="">Everyone</option>
            {me && <option value="me">My tasks</option>}
            {people.filter((p) => p.id !== me?.id).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            <option value="none">Unassigned</option>
          </select>
          <button className={`link small ${showDone ? 'on' : ''}`} onClick={() => setShowDone((x) => !x)}>
            {showDone ? '← Open items' : `Done (${doneCount})`}
          </button>
        </div>
      )}
      <ul className="att">
        {visible.map((x) => x.t ? (
          <TaskRow key={x.t.id} t={x.t} showJob={!projectId} person={byId('sdr_people', x.t.assignee_id)} job={byId('projects', x.t.project_id)}
            onToggle={() => toggle(x.t!)} onOpen={() => setEdit({ row: x.t })} />
        ) : (
          <li key={x.a!.table + x.a!.id} onClick={() => onOpenItem(x.a!)}>
            <span className={`dot ${x.a!.tone}`} />
            <span className="att-kind">{x.a!.project ? x.a!.project.code : x.a!.kind}</span>
            <span>{x.a!.project ? <b className="small">{x.a!.kind}: </b> : null}{x.a!.text}</span>
          </li>
        ))}
        {!rows.length && <li className="muted">{showDone ? 'No completed tasks yet.' : who ? 'No open tasks for this person.' : 'All clear.'}</li>}
      </ul>
      {rows.length > limit && <button className="link small att-more" onClick={() => setMore((m) => !m)}>{more ? 'Show fewer' : `Show all ${rows.length}`}</button>}
      {edit && <RecordDrawer table="tasks" row={edit.row} defaults={edit.defaults} onClose={() => setEdit(null)} />}
    </section>
  );
}

function TaskRow({ t, person, job, showJob, onToggle, onOpen }:
  { t: Row; person?: Row; job?: Row; showJob: boolean; onToggle: () => void; onOpen: () => void }) {
  const done = t.status === 'done';
  const overdue = !done && t.due_date && t.due_date < today();
  const mail = person?.email
    ? `mailto:${person.email}?subject=${encodeURIComponent(`Task${job ? ` · ${job.code ?? job.name}` : ''}: ${t.title}`)}&body=${encodeURIComponent(
        [t.title, t.due_date ? `Due ${t.due_date}` : '', t.notes ?? '', job ? `Job: ${[job.code, job.name].filter(Boolean).join(' · ')}` : '', location.href].filter(Boolean).join('\n\n'))}`
    : null;
  return (
    <li className={`task ${done ? 'done' : ''}`} onClick={onOpen}>
      <input type="checkbox" checked={done} aria-label={done ? 'Mark not done' : 'Mark done'}
        onClick={(e) => e.stopPropagation()} onChange={onToggle} />
      <span className="att-kind">{showJob ? (job?.code ?? 'Company') : 'Task'}</span>
      <span className="task-main">
        <span className="task-title">{t.priority === 'high' && !done && <span className="task-hi" title="High priority">!</span>}{t.title}</span>
        <span className="task-meta small">
          {person ? <span className="who" title={person.name}><i>{initials(person.name)}</i>{person.name}</span> : <span className="muted">Unassigned</span>}
          {t.due_date && <span className={overdue ? 'neg' : 'muted'}>{done ? `done ${String(t.completed_at ?? '').slice(0, 10)}` : dueLabel(t.due_date)}</span>}
          {showJob && job && <span className="muted">{job.name}</span>}
          {mail && !done && <a href={mail} onClick={(e) => e.stopPropagation()} title={`Email ${person!.name} about this task`}>✉ Email</a>}
        </span>
      </span>
    </li>
  );
}
