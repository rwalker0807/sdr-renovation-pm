import { useEffect, useMemo, useRef, useState } from 'react';
import type { Row } from '../lib/schema';
import { useStore } from '../lib/store';

type FeedRow = {
  id: string; claim_id: string; project_id: string | null; kind: 'note' | 'room_note' | 'photos' | 'documents' | 'video';
  title: string | null; body: string | null; room: string | null; count: number | null; author: string | null; happened_at: string;
};

const ago = (iso: string) => {
  const m = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  return h < 36 ? `${h}h ago` : `${Math.round(h / 24)}d ago`;
};
const ICON: Record<FeedRow['kind'], string> = { note: '📝', room_note: '📝', photos: '📷', documents: '📄', video: '🎞' };
const what = (r: FeedRow) => {
  const n = r.count ?? 1;
  switch (r.kind) {
    case 'photos': return `${n} photo${n === 1 ? '' : 's'} added`;
    case 'documents': return `${n} document${n === 1 ? '' : 's'} added`;
    case 'video': return `${n} video${n === 1 ? '' : 's'} added`;
    case 'room_note': return 'Room note';
    default: return 'Note';
  }
};
const snippet = (r: FeedRow) => {
  const t = [r.title, r.body].filter(Boolean).join(' — ').replace(/\s+/g, ' ').trim();
  return t.length > 90 ? t.slice(0, 88) + '…' : t;
};

/**
 * Rolling ticker of the newest Encircle updates (notes, room notes, photos, documents) on every open job.
 * While the home page is open it asks the server to check Encircle every 10 minutes (the server throttles,
 * so many open pages still make one check); new items arrive live.
 */
export function EncircleTicker({ openProject }: { openProject: (p: Row) => void }) {
  const { source, byId, all } = useStore();
  const client: any = source.kind === 'supabase' ? (source as any).client : null;
  const [rows, setRows] = useState<FeedRow[] | null>(null);
  const [checking, setChecking] = useState(false);
  const track = useRef<HTMLDivElement>(null);
  const [dur, setDur] = useState(60);

  useEffect(() => {
    if (!client) return;
    let alive = true;
    const since = new Date(Date.now() - 7 * 864e5).toISOString();
    const load = () => client.from('encircle_feed').select('*').gte('happened_at', since).order('happened_at', { ascending: false }).limit(40)
      .then(({ data }: any) => alive && setRows(data ?? []));
    load();
    const ch = client.channel('encircle-feed-live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'encircle_feed' }, () => load())
      .subscribe();
    const sweep = async () => {
      setChecking(true);
      try { await client.functions.invoke('encircle', { body: { action: 'feed_sweep' } }); } catch { /* next round */ }
      if (alive) { setChecking(false); load(); }
    };
    sweep();
    const t = setInterval(sweep, 10 * 60e3 + 5000);
    return () => { alive = false; clearInterval(t); client.removeChannel(ch); };
  }, [client]);

  // drop items whose job left the tracker; newest first
  const items = useMemo(() => (rows ?? []).filter((r) => !r.project_id || byId('projects', r.project_id)), [rows, byId, all.projects]);

  // steady speed (~45 px/s) whatever the number of items
  useEffect(() => {
    const w = track.current?.scrollWidth ?? 0;
    if (w) setDur(Math.max(20, Math.round(w / 2 / 45)));
  }, [items]);

  if (!client) return null;

  // repeat short lists so one run is wider than the screen (the loop needs two identical runs)
  const reps = Math.max(1, Math.ceil(5 / Math.max(1, items.length)));
  const looped = Array.from({ length: reps }, (_, k) => items.map((r) => ({ r, k }))).flat();
  const content = (dupe: boolean) => looped.map(({ r, k }) => {
    const p = r.project_id ? byId('projects', r.project_id) : undefined;
    const s = snippet(r);
    return (
      <button key={(dupe ? 'b-' : 'a-') + k + r.id} className={`tick-item ${r.kind}`} tabIndex={dupe || k ? -1 : 0} aria-hidden={dupe || k > 0 || undefined}
        onClick={() => p && openProject(p)} title={[p?.name, what(r), r.room, s].filter(Boolean).join(' · ')}>
        <span className="tick-ic" aria-hidden>{ICON[r.kind]}</span>
        <b className="tick-job">{p?.code ?? `Claim ${r.claim_id}`}</b>
        {p?.name && <span className="tick-name">{p.name.length > 34 ? p.name.slice(0, 32) + '…' : p.name}</span>}
        <span className="tick-what">{what(r)}{r.room ? ` · ${r.room}` : ''}</span>
        {s && <span className="tick-text">“{s}”</span>}
        {r.author && <span className="tick-by">{r.author.split('@')[0]}</span>}
        <span className="tick-time">{ago(r.happened_at)}</span>
      </button>
    );
  });

  return (
    <div className="ticker" aria-label="Latest Encircle updates">
      <span className="tick-label"><i className={checking ? 'on' : ''} />Encircle</span>
      <div className="tick-viewport">
        {items.length ? (
          <div className="tick-track" ref={track} style={{ animationDuration: `${dur}s` }}>
            <div className="tick-run">{content(false)}</div>
            <div className="tick-run" aria-hidden>{content(true)}</div>
          </div>
        ) : (
          <span className="tick-empty">{rows === null || checking ? 'Checking Encircle for updates…' : 'No Encircle updates on open jobs in the last 7 days.'}</span>
        )}
      </div>
    </div>
  );
}
