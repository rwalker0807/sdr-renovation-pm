import { useMemo, useState } from 'react';
import { useStore } from '../lib/store';
import type { Row } from '../lib/schema';
import { PageHead } from '../components/ui';
import { RecordDrawer } from '../components/RecordDrawer';

const tel = (v: string) => `tel:${v.replace(/[^\d+]/g, '')}`;
const initials = (n: string) => n.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase()).join('');

/** SDR staff directory: everyone with an @sdandr.com address. */
export function DirectoryView() {
  const { all } = useStore();
  const [q, setQ] = useState('');
  const [dept, setDept] = useState('');
  const [showShared, setShowShared] = useState(false);
  const [edit, setEdit] = useState<Row | null | undefined>(undefined);
  const [note, setNote] = useState('');

  const people = all.sdr_people;
  const depts = useMemo(() => [...new Set(people.map((p) => String(p.department ?? '').trim()).filter(Boolean))].sort(), [people]);
  const list = useMemo(() => {
    const n = q.trim().toLowerCase();
    return people
      .filter((p) => p.active !== false)
      .filter((p) => showShared || p.kind !== 'shared')
      .filter((p) => !dept || p.department === dept)
      .filter((p) => !n || [p.name, p.title, p.department, p.email, p.mobile, p.office_phone, p.location].some((v) => String(v ?? '').toLowerCase().includes(n)))
      .sort((a, b) => String(a.name).localeCompare(String(b.name)));
  }, [people, q, dept, showShared]);
  const sharedCount = people.filter((p) => p.kind === 'shared').length;

  const emailAll = () => {
    const to = [...new Set(list.map((p) => String(p.email ?? '')).filter((e) => e.includes('@')))];
    if (!to.length) { setNote('Nobody shown has an email.'); return; }
    window.location.href = `mailto:${to.map(encodeURIComponent).join(',')}`;
    setNote(`Opened an email to ${to.length}.`);
  };

  return (
    <>
      <PageHead title="SDR Directory">
        <input className="search" style={{ width: 240 }} placeholder="Search name, title, phone…" value={q} onChange={(e) => setQ(e.target.value)} />
        {depts.length > 0 && (
          <select value={dept} onChange={(e) => setDept(e.target.value)} style={{ width: 'auto' }} aria-label="Department">
            <option value="">All departments</option>
            {depts.map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
        )}
        {sharedCount > 0 && (
          <label className="small" style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <input type="checkbox" style={{ width: 'auto' }} checked={showShared} onChange={(e) => setShowShared(e.target.checked)} /> Shared mailboxes ({sharedCount})
          </label>
        )}
        <button onClick={emailAll} title="Start an email to everyone shown">✉ Email {list.length}</button>
        <button className="primary" onClick={() => setEdit(null)}>+ Add person</button>
      </PageHead>
      {note && <p className="hint">{note}</p>}
      <div className="people">
        {list.map((p) => (
          <div key={p.id} className={`person ${p.kind === 'shared' ? 'shared' : ''}`} onClick={() => setEdit(p)}>
            <div className="avatar">{p.kind === 'shared' ? '✉' : initials(String(p.name))}</div>
            <div className="person-body">
              <div className="person-name">{p.name}</div>
              <div className="muted small">{[p.title, p.department].filter(Boolean).join(' · ') || ' '}</div>
              <div className="person-links small" onClick={(e) => e.stopPropagation()}>
                {p.email && <a href={`mailto:${p.email}`}>{p.email}</a>}
                {p.mobile && <a href={tel(p.mobile)}>📱 {p.mobile}</a>}
                {p.office_phone && <a href={tel(p.office_phone)}>☎ {p.office_phone}</a>}
              </div>
            </div>
          </div>
        ))}
        {!list.length && <div className="panel pad muted">{people.length ? 'Nobody matches.' : 'No one in the directory yet.'}</div>}
      </div>
      {edit !== undefined && <RecordDrawer table="sdr_people" row={edit} defaults={{ kind: 'person', active: true }} onClose={() => setEdit(undefined)} />}
    </>
  );
}
