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

type Photo = { url: string; filename: string | null; taken: string; type: string | null; labels: string[] };
type Note = { claim_id: string; title: string | null; body: string | null; author: string | null; created_at: string | null; checked_at: string; error: string | null;
  photos?: Photo[]; photos_total?: number; photo_day?: string | null; note_scope?: 'claim' | 'room' | null; room?: string | null; photo_mode?: 'note' | 'day' | null };
const PHOTO_KIND: Record<string, string> = { ClaimNotePicture: 'Note photo', ClaimRoomNotePicture: 'Room note photo', ClaimRoomPictureNotePicture: 'Room photo note',
  ClaimRoomAfterPicture: 'Room photo', ClaimSketchPictureNodePicture: 'Sketch photo', ClaimPictureDocument: 'Scanned document' };
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
  const [viewing, setViewing] = useState<number | null>(null);

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
      // re-check when stale, or when cached by the older version that only read general notes
      if (!data || data.note_scope == null || Date.now() - new Date(data.checked_at).getTime() > STALE_MS) refresh();
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
          <div className="enote-where small">{note.note_scope === 'room' ? <>Room note · <b>{note.room ?? 'room'}</b></> : 'General claim note'}</div>
          {note.title && <div className="enote-title">{note.title}</div>}
          {note.body && <p className={`enote-body ${long && !open ? 'clamped' : ''}`}>{note.body}</p>}
          {long && <button className="link small" onClick={() => setOpen((o) => !o)}>{open ? 'Show less' : 'Show full note'}</button>}
          {!!note.photos?.length && (
            <div className="enote-photos">
              <div className="small muted">
                {note.photo_mode === 'note' ? 'Photos with this note' : 'Photos added to the claim that day'} ({note.photos_total ?? note.photos.length})
                {(note.photos_total ?? 0) > note.photos.length && <> · showing the latest {note.photos.length} · <a href={project?.encircle_url} target="_blank" rel="noreferrer">see all in Encircle</a></>}
              </div>
              <div className="enote-grid">
                {note.photos.map((ph, i) => (
                  <button key={ph.url} className="enote-thumb" onClick={() => setViewing(i)} title={[PHOTO_KIND[ph.type ?? ''], new Date(ph.taken).toLocaleTimeString([], { timeStyle: 'short' })].filter(Boolean).join(' · ')}>
                    <img src={ph.url} alt={ph.filename ?? 'Encircle photo'} loading="lazy" onError={(e) => { (e.currentTarget.parentElement as HTMLElement).style.display = 'none'; }} />
                  </button>
                ))}
              </div>
            </div>
          )}
        </>
      ) : note?.error ? (
        <p className="muted small">{note.error} (claim {claimId}).</p>
      ) : state === 'loading' ? (
        <p className="muted small">Checking Encircle… the first check of a large claim can take up to a minute.</p>
      ) : state === 'error' ? (
        <p className="small" style={{ color: 'var(--bad)' }}>{err}</p>
      ) : (
        <p className="muted small">No notes on this claim yet.</p>
      )}
      {viewing != null && note?.photos?.[viewing] && (
        <PhotoViewer photos={note.photos} index={viewing} onIndex={setViewing} onClose={() => setViewing(null)} />
      )}
    </section>
  );
}

function PhotoViewer({ photos, index, onIndex, onClose }: { photos: Photo[]; index: number; onIndex: (i: number) => void; onClose: () => void }) {
  const ph = photos[index];
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowRight') onIndex((index + 1) % photos.length);
      if (e.key === 'ArrowLeft') onIndex((index - 1 + photos.length) % photos.length);
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [index, photos.length, onIndex, onClose]);
  return (
    <div className="lightbox" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <button className="lb-close" onClick={onClose} aria-label="Close">✕</button>
      {photos.length > 1 && <button className="lb-nav prev" onClick={() => onIndex((index - 1 + photos.length) % photos.length)} aria-label="Previous">‹</button>}
      <figure>
        <img src={ph.url} alt={ph.filename ?? 'Encircle photo'} />
        <figcaption className="small">
          {[PHOTO_KIND[ph.type ?? ''], new Date(ph.taken).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }), ...(ph.labels ?? [])].filter(Boolean).join(' · ')}
          <span className="muted"> · {index + 1} of {photos.length}</span>
          {' · '}<a href={ph.url} target="_blank" rel="noreferrer">Open full size ↗</a>
        </figcaption>
      </figure>
      {photos.length > 1 && <button className="lb-nav next" onClick={() => onIndex((index + 1) % photos.length)} aria-label="Next">›</button>}
    </div>
  );
}
