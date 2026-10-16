import { useMemo, useRef, useState } from 'react';
import type { Row, TableName } from '../lib/schema';
import { useStore } from '../lib/store';
import { date } from '../lib/format';
import { deleteFiles, fileIcon, fmtSize, MAX_BYTES, openFile, recordName, uploadFile, type Target } from '../lib/files';

export const useFilesClient = () => {
  const { source } = useStore();
  return source.kind === 'supabase' ? (source as any).client : null;
};

/** Drop files here, or click to pick (on a phone this offers camera, photos and files). */
export function DropZone({ onFiles, disabled, hint, compact }: { onFiles: (f: File[]) => void; disabled?: boolean; hint?: string; compact?: boolean }) {
  const [over, setOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  return (
    <div
      className={`dropzone ${over ? 'over' : ''} ${compact ? 'compact' : ''} ${disabled ? 'disabled' : ''}`}
      role="button" tabIndex={disabled ? -1 : 0}
      onClick={() => !disabled && input.current?.click()}
      onKeyDown={(e) => { if (!disabled && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); input.current?.click(); } }}
      onDragOver={(e) => { e.preventDefault(); if (!disabled) setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); if (!disabled && e.dataTransfer.files.length) onFiles([...e.dataTransfer.files]); }}
    >
      <input ref={input} type="file" multiple hidden onChange={(e) => { if (e.target.files?.length) onFiles([...e.target.files]); e.target.value = ''; }} />
      <span className="dz-icon" aria-hidden>⇪</span>
      <span><b>Drop files here</b> or <u>browse</u></span>
      {hint && <span className="muted small">{hint}</span>}
    </div>
  );
}

/** Upload a batch to one target, reporting each file's state. */
export function useUploader() {
  const client = useFilesClient();
  const { save } = useStore();
  const [jobs, setJobs] = useState<{ key: string; name: string; state: 'up' | 'done' | 'err'; msg?: string }[]>([]);
  const upload = async (t: Target, files: File[]) => {
    if (!client) return;
    const batch = files.map((f) => ({ key: crypto.randomUUID(), name: f.name, file: f }));
    setJobs((j) => [...j.filter((x) => x.state !== 'done'), ...batch.map((b) => ({ key: b.key, name: b.name, state: 'up' as const }))]);
    for (const b of batch) {
      try {
        await uploadFile(client, save, t, b.file);
        setJobs((j) => j.map((x) => (x.key === b.key ? { ...x, state: 'done' } : x)));
      } catch (e: any) {
        setJobs((j) => j.map((x) => (x.key === b.key ? { ...x, state: 'err', msg: e.message ?? String(e) } : x)));
      }
    }
    setTimeout(() => setJobs((j) => j.filter((x) => x.state !== 'done')), 2500);
  };
  const status = jobs.length ? (
    <ul className="up-status">
      {jobs.map((j) => (
        <li key={j.key} className={j.state}>
          <span>{j.state === 'up' ? <span className="spin" aria-label="Uploading" /> : j.state === 'done' ? '✓' : '⚠'}</span>
          <span className="up-name">{j.name}</span>
          {j.msg && <span className="small">{j.msg}</span>}
          {j.state === 'err' && <button type="button" className="link small" onClick={() => setJobs((x) => x.filter((y) => y.key !== j.key))}>dismiss</button>}
        </li>
      ))}
    </ul>
  ) : null;
  return { upload, status, busy: jobs.some((j) => j.state === 'up') };
}

/** List of attachment rows with open / download / delete. */
export function FileList({ rows, showRecord, onOpenRecord, empty }:
  { rows: Row[]; showRecord?: boolean; onOpenRecord?: (a: Row) => void; empty?: string }) {
  const client = useFilesClient();
  const { remove, byId } = useStore();
  const [confirm, setConfirm] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const act = async (fn: () => Promise<void>) => { setErr(null); try { await fn(); } catch (e: any) { setErr(e.message ?? String(e)); } };
  if (!rows.length) return empty ? <p className="muted small">{empty}</p> : null;
  return (
    <>
      <ul className="file-list">
        {rows.map((a) => (
          <li key={a.id}>
            <span className="file-ic" aria-hidden>{fileIcon(a)}</span>
            <span className="file-main">
              <button type="button" className="link file-name" title={`Open ${a.filename}`} onClick={() => act(() => openFile(client, a))}>{a.filename}</button>
              <span className="muted small">
                {[fmtSize(a.size_bytes), a.uploaded_by?.split('@')[0], date(a.created_at)].filter(Boolean).join(' · ')}
                {showRecord && <> · {a.record_table && onOpenRecord
                  ? <button type="button" className="link" onClick={() => onOpenRecord(a)}>{recordName(a.record_table, byId(a.record_table as TableName, a.record_id), byId)}</button>
                  : <span>{a.folder || recordName(a.record_table, byId(a.record_table as TableName, a.record_id), byId)}</span>}</>}
              </span>
            </span>
            {confirm === a.id ? (
              <span className="file-acts">
                <span className="small">Delete?</span>
                <button type="button" className="ghost small" onClick={() => setConfirm(null)}>Keep</button>
                <button type="button" className="danger solid small" onClick={() => act(async () => { await deleteFiles(client, remove, [a]); setConfirm(null); })}>Delete</button>
              </span>
            ) : (
              <span className="file-acts">
                <button type="button" className="ghost small" title="Download" aria-label={`Download ${a.filename}`} onClick={() => act(() => openFile(client, a, true))}>⤓</button>
                <button type="button" className="ghost small" title="Delete" aria-label={`Delete ${a.filename}`} onClick={() => setConfirm(a.id)}>🗑</button>
              </span>
            )}
          </li>
        ))}
      </ul>
      {err && <div className="err small">{err}</div>}
    </>
  );
}

/** Upload spot inside a record's form. New records queue files and upload them right after Save. */
export function RecordAttachments({ table, recordId, projectId, pending, setPending }:
  { table: TableName; recordId?: string; projectId: string | null; pending: File[]; setPending: (f: File[]) => void }) {
  const client = useFilesClient();
  const { all } = useStore();
  const { upload, status } = useUploader();
  const [tooBig, setTooBig] = useState<File[]>([]);
  const rows = useMemo(() => (recordId ? all.attachments.filter((a) => a.record_table === table && a.record_id === recordId) : [])
    .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))), [all.attachments, table, recordId]);
  const add = (files: File[]) => {
    const big = files.filter((f) => f.size > MAX_BYTES);
    const ok = files.filter((f) => f.size <= MAX_BYTES);
    setTooBig(big);
    if (!ok.length) return;
    if (recordId && projectId) upload({ project_id: projectId, record_table: table, record_id: recordId }, ok);
    else setPending([...pending, ...ok]);
  };
  return (
    <div className="rec-files">
      <h3 className="drawer-section">Attachments {rows.length > 0 && <span className="muted">({rows.length})</span>}</h3>
      {!client ? <p className="muted small">File uploads work on the live site.</p> : (
        <>
          <FileList rows={rows} />
          {pending.length > 0 && (
            <ul className="file-list pending">
              {pending.map((f, i) => (
                <li key={i}>
                  <span className="file-ic" aria-hidden>{fileIcon({ mime: f.type, filename: f.name })}</span>
                  <span className="file-main"><span className="file-name">{f.name}</span><span className="muted small">{fmtSize(f.size)} · uploads when you save</span></span>
                  <span className="file-acts"><button type="button" className="ghost small" aria-label={`Remove ${f.name}`} onClick={() => setPending(pending.filter((_, j) => j !== i))}>✕</button></span>
                </li>
              ))}
            </ul>
          )}
          {status}
          {tooBig.length > 0 && <div className="err small">Too large to upload (limit {fmtSize(MAX_BYTES)} per file): {tooBig.map((f) => `${f.name} (${fmtSize(f.size)})`).join(', ')}</div>}
          <DropZone compact onFiles={add} hint={`PDFs, photos, spreadsheets · up to ${fmtSize(MAX_BYTES)} each`} />
        </>
      )}
    </div>
  );
}
