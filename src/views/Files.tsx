import { useMemo, useState } from 'react';
import { ENTITIES, type Row, type TableName } from '../lib/schema';
import { useStore } from '../lib/store';
import { PageHead } from '../components/ui';
import { DropZone, FileList, useFilesClient, useUploader } from '../components/Attachments';
import { RecordDrawer } from '../components/RecordDrawer';
import { fmtSize, GENERAL_FOLDERS, MAX_BYTES, recordName } from '../lib/files';

/** Every file on the job: the ones attached to invoices, COs, subcontracts, … plus general job files. */
export function FilesView() {
  const { data, projectId, byId } = useStore();
  const client = useFilesClient();
  const { upload, status } = useUploader();
  const [q, setQ] = useState('');
  const [kind, setKind] = useState('');          // '' all · 'general' · a table name
  const [folder, setFolder] = useState(GENERAL_FOLDERS[0]);
  const [open, setOpen] = useState<{ table: TableName; row: Row } | null>(null);
  const [adding, setAdding] = useState(false);

  const files = data.attachments;
  const kinds = useMemo(() => {
    const m = new Map<string, number>();
    files.forEach((a) => { const k = a.record_table || 'general'; m.set(k, (m.get(k) ?? 0) + 1); });
    return [...m.entries()].sort((a, b) => kindLabel(a[0]).localeCompare(kindLabel(b[0])));
  }, [files]);
  const shown = useMemo(() => {
    const n = q.trim().toLowerCase();
    return files
      .filter((a) => !kind || (a.record_table || 'general') === kind)
      .filter((a) => !n || [a.filename, a.folder, a.uploaded_by, recordName(a.record_table, byId(a.record_table as TableName, a.record_id), byId)]
        .some((v) => String(v ?? '').toLowerCase().includes(n)))
      .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
  }, [files, q, kind, byId]);
  const total = files.reduce((s, a) => s + (Number(a.size_bytes) || 0), 0);

  const openRecord = (a: Row) => {
    const row = byId(a.record_table as TableName, a.record_id);
    if (row) setOpen({ table: a.record_table as TableName, row });
  };

  return (
    <>
      <PageHead title="Files">
        <span className="muted small">{files.length} file{files.length === 1 ? '' : 's'}{total ? ` · ${fmtSize(total)}` : ''}</span>
        {client && <button className="primary" onClick={() => setAdding((x) => !x)}>{adding ? 'Done' : '+ Upload job file'}</button>}
      </PageHead>
      {!client && <div className="panel pad muted">File uploads work on the live site. This copy is running on sample data.</div>}
      {client && adding && (
        <div className="panel pad files-add">
          <label className="field"><span>Folder</span>
            <select value={folder} onChange={(e) => setFolder(e.target.value)}>{GENERAL_FOLDERS.map((f) => <option key={f}>{f}</option>)}</select>
          </label>
          <DropZone onFiles={(fs) => projectId && upload({ project_id: projectId, folder }, fs)}
            hint={`For files that aren’t tied to one invoice or CO. To attach to a record, open it and use its Attachments section. Up to ${fmtSize(MAX_BYTES)} each.`} />
          {status}
        </div>
      )}
      <div className="table-card">
        <div className="table-tools">
          <input className="search" placeholder="Search files…" value={q} onChange={(e) => setQ(e.target.value)} />
          <select value={kind} onChange={(e) => setKind(e.target.value)} aria-label="Filter by what the file is attached to">
            <option value="">Everything</option>
            {kinds.map(([k, n]) => <option key={k} value={k}>{kindLabel(k)} ({n})</option>)}
          </select>
          <span className="muted small">{shown.length} of {files.length}</span>
        </div>
        <div className="pad-sm">
          <FileList rows={shown} showRecord onOpenRecord={openRecord}
            empty={files.length ? 'No files match.' : 'No files on this job yet. Open an invoice, change order or subcontract and drop files into its Attachments section, or upload a general job file above.'} />
        </div>
      </div>
      {open && <RecordDrawer table={open.table} row={open.row} onClose={() => setOpen(null)} />}
    </>
  );
}

const kindLabel = (k: string) => (k === 'general' ? 'General job files' : ENTITIES[k as TableName]?.label ?? k);
