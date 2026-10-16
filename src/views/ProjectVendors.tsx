import { useState } from 'react';
import { useStore } from '../lib/store';
import { money } from '../lib/format';
import { PageHead } from '../components/ui';
import { RecordDrawer } from '../components/RecordDrawer';
import { AssignVendorDialog, emailVendors, useAssigned } from '../components/AssignVendor';
import type { Row } from '../lib/schema';

/** Full page: vendors assigned to this project. */
export function ProjectVendorsView() {
  const { projectId, byId, remove } = useStore();
  const project = byId('projects', projectId);
  const rows = useAssigned();
  const [assigning, setAssigning] = useState(false);
  const [edit, setEdit] = useState<Row | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const total = rows.reduce((a, r) => a + (Number(r.amount) || 0), 0);

  if (!projectId) return null;
  return (
    <>
      <PageHead title="Vendors on this job">
        <button onClick={() => { const n = emailVendors(rows, project ? `${project.code ?? ''} ${project.name}`.trim() : ''); setNote(n ? `Opened an email to ${n} (Bcc).` : 'None of these vendors have an email yet.'); }}>
          ✉ Email all
        </button>
        <button className="primary" onClick={() => setAssigning(true)}>+ Assign vendor</button>
      </PageHead>
      {note && <p className="hint">{note}</p>}
      <div className="table-card">
        <div className="table-scroll">
          <table>
            <thead>
              <tr><th>Vendor</th><th>Role / scope</th><th className="r">Amount</th><th>Contact</th><th>Email</th><th>Phone</th><th>Location</th><th /></tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} onClick={() => setEdit(r)}>
                  <td><b>{r.vendor?.name ?? '(deleted vendor)'}</b><div className="muted small">{r.vendor?.trade}</div></td>
                  <td>{r.role}</td>
                  <td className="r num">{r.amount != null ? money(r.amount) : ''}</td>
                  <td>{r.vendor?.contact_name}</td>
                  <td>{r.vendor?.email && <a href={`mailto:${r.vendor.email}`} onClick={(e) => e.stopPropagation()}>{r.vendor.email}</a>}</td>
                  <td>{r.vendor?.phone && <a href={`tel:${r.vendor.phone}`} onClick={(e) => e.stopPropagation()}>{r.vendor.phone}</a>}</td>
                  <td>{[r.vendor?.city, r.vendor?.state].filter(Boolean).join(', ')}</td>
                  <td className="r" onClick={(e) => e.stopPropagation()}>
                    {confirmId === r.id ? (
                      <span className="nowrap">
                        <button className="danger small" onClick={async () => { await remove('project_vendors', r.id); setConfirmId(null); }}>Remove</button>{' '}
                        <button className="ghost small" onClick={() => setConfirmId(null)}>Keep</button>
                      </span>
                    ) : <button className="ghost small" title="Take this vendor off the job" onClick={() => setConfirmId(r.id)}>✕</button>}
                  </td>
                </tr>
              ))}
              {!rows.length && <tr><td colSpan={8} className="empty">No vendors assigned yet. Click “+ Assign vendor”.</td></tr>}
            </tbody>
            {rows.length > 0 && (
              <tfoot><tr><td>Total</td><td /><td className="r">{money(total)}</td><td colSpan={5} /></tr></tfoot>
            )}
          </table>
        </div>
      </div>
      {assigning && <AssignVendorDialog projectId={projectId} onClose={() => setAssigning(false)} />}
      {edit && <RecordDrawer table="project_vendors" row={edit} onClose={() => setEdit(null)} />}
    </>
  );
}

/** Compact panel for the project dashboard. */
export function ProjectVendorsPanel({ go }: { go: () => void }) {
  const { projectId } = useStore();
  const rows = useAssigned();
  const [assigning, setAssigning] = useState(false);
  if (!projectId) return null;
  return (
    <section className="panel">
      <div className="panel-head">
        <h2>Vendors</h2>
        <span style={{ display: 'flex', gap: 10 }}>
          <button className="link small" onClick={() => setAssigning(true)}>+ Assign vendor</button>
          {rows.length > 0 && <button className="link small" onClick={go}>All →</button>}
        </span>
      </div>
      <ul className="att">
        {rows.slice(0, 10).map((r) => (
          <li key={r.id} onClick={go} style={{ gridTemplateColumns: '1fr auto' }}>
            <span><b>{r.vendor?.name}</b> <span className="muted small">{r.role || r.vendor?.trade}</span></span>
            <span className="small">{r.vendor?.email && <a href={`mailto:${r.vendor.email}`} onClick={(e) => e.stopPropagation()}>✉</a>}</span>
          </li>
        ))}
        {!rows.length && <li className="muted" style={{ gridTemplateColumns: '1fr' }}>None yet.</li>}
      </ul>
      {assigning && <AssignVendorDialog projectId={projectId} onClose={() => setAssigning(false)} />}
    </section>
  );
}
