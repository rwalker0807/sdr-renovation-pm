import { useEffect, useState } from 'react';
import { useStore } from '../lib/store';
import type { Row } from '../lib/schema';

/** Encircle claim id from a project's Encircle link (…/claim/4911809) or a numeric claim #. */
export function encircleClaimId(p?: Row | null): string | null {
  const m = String(p?.encircle_url ?? '').match(/claim[s]?\/(\d{4,})/i);
  if (m) return m[1];
  const c = String(p?.claim_number ?? '').trim();
  return /^\d{5,}$/.test(c) ? c : null;
}

type Note = { claim_id: string; title: string | null; body: string | null; author: string | null; created_at: string | null; checked_at: string; error: string | null };
const STALE_MS = 10 * 60 * 1000;

function ago(iso: string) {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} hr ago`;
  const d = Math.round(s / 86400);
  return d < 30 ? `${d} day${d === 1 ? '' : 's'} ago` : new Date(iso).toLocaleDateString();
}

/** Dashboard panel: the newest note on the job's Encircle claim. */
export function EncircleNote({ project }: { project?: Row | null }) {
  const { source } = useStore();
  const client: any = (source as any).client;
  const claimId = encircleClaimId(project);
  const [note, setNote] = useState<Note | null>(null);
  const [state, setState] = useState<'idle' | 'loading' | 'not_configured' | 'error'>('idle');
  const [err, setErr] = useState('');
  const [open, setOpen] = useState(false);

  const refresh = async () => {
    setState('loading');
    try {
      const { data, error } = await client.functions.invoke('encircle', { body: { action: 'latest_notes', claim_ids: [claimId] } });
      if (error) throw new Error((await error.context?.json?.())?.error ?? error.message);
      if (data?.error === 'not_configured') { setState('not_configured'); return; }
      if (data?.notes?.[0]) setNote(data.notes[0]);
      setState('idle');
    } catch (e: any) { setErr(e.message ?? String(e)); setState('error'); }
  };

  useEffect(() => {
    setNote(null); setOpen(false); setErr('');
    if (!client || !claimId) return;
    let alive = true;
    (async () => {
      const { data } = await client.from('encircle_latest_note').select('*').eq('claim_id', claimId).maybeSingle();
      if (!alive) return;
      if (data) setNote(data);
      if (!data || Date.now() - new Date(data.checked_at).getTime() > STALE_MS) refresh();
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [claimId, client]);

  if (!client || !claimId) return null;
  const long = (note?.body ?? '').length > 280;
  return (
    <section className="panel encircle-note" style={{ marginBottom: 16 }}>
      <div className="panel-head">
        <h2>Latest Encircle note</h2>
        <span style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <button className="link small" disabled={state === 'loading'} onClick={refresh}>{state === 'loading' ? 'Checking…' : '⟳ Refresh'}</button>
          {project?.encircle_url && <a className="small" href={project.encircle_url} target="_blank" rel="noreferrer">Open claim ↗</a>}
        </span>
      </div>
      {state === 'not_configured' ? (
        <p className="muted small">Encircle isn’t connected yet. Add an Encircle API token to the tracker (Supabase secret <code>ENCIRCLE_API_TOKEN</code>) and notes will show here.</p>
      ) : note?.created_at ? (
        <>
          <div className="enote-meta small muted">
            <b className="enote-when">{ago(note.created_at)}</b> · {new Date(note.created_at).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}
            {note.author ? <> · {note.author}</> : null}
          </div>
          {note.title && <div className="enote-title">{note.title}</div>}
          {note.body && <p className={`enote-body ${long && !open ? 'clamped' : ''}`}>{note.body}</p>}
          {long && <button className="link small" onClick={() => setOpen((o) => !o)}>{open ? 'Show less' : 'Show full note'}</button>}
        </>
      ) : note?.error ? (
        <p className="muted small">{note.error} (claim {claimId}).</p>
      ) : state === 'loading' ? (
        <p className="muted small">Checking Encircle…</p>
      ) : state === 'error' ? (
        <p className="small" style={{ color: 'var(--bad)' }}>{err}</p>
      ) : (
        <p className="muted small">No notes on this claim yet.</p>
      )}
    </section>
  );
}
