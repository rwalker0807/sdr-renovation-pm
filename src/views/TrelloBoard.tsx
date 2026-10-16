import { useEffect, useMemo, useState } from 'react';
import { labelStyle, TRELLO_BOARD_URL, useTrello, type TCard } from '../lib/trello';
import { useStore } from '../lib/store';
import { date } from '../lib/format';
import { PageHead } from '../components/ui';

/** Live, two-way view of the Trello "Raleigh Current Jobs" board. */
export function TrelloBoard() {
  const { available, lists, cards, loading, error, call, patchLocal } = useTrello();
  const { all } = useStore();
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<TCard | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ tone: 'ok' | 'err'; text: string } | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [overList, setOverList] = useState<string | null>(null);

  const projectsByCode = useMemo(() => new Map(all.projects.map((p) => [p.code, p])), [all.projects]);
  const sortedLists = useMemo(() => [...lists].sort((a, b) => a.pos - b.pos), [lists]);
  const needle = q.trim().toLowerCase();
  const byList = useMemo(() => {
    const m = new Map<string, TCard[]>();
    cards
      .filter((c) => !needle || c.name.toLowerCase().includes(needle) || c.labels.some((l) => (l.name ?? '').toLowerCase().includes(needle)))
      .sort((a, b) => a.pos - b.pos)
      .forEach((c) => { const a = m.get(c.list_id) ?? []; a.push(c); m.set(c.list_id, a); });
    return m;
  }, [cards, needle]);

  const flash = (tone: 'ok' | 'err', text: string) => { setMsg({ tone, text }); setTimeout(() => setMsg(null), 5000); };

  const run = async (label: string, fn: () => Promise<any>) => {
    setBusy(label);
    try { const r = await fn(); return r; }
    catch (e: any) { flash('err', e.message ?? String(e)); return null; }
    finally { setBusy(null); }
  };

  const move = async (card: TCard, listId: string) => {
    if (card.list_id === listId) return;
    const before = card.list_id;
    patchLocal(card.id, { list_id: listId, pos: -1 });   // show it moved right away
    const r = await run('move', () => call('move', { card_id: card.id, list_id: listId }));
    if (!r) patchLocal(card.id, { list_id: before });    // Trello refused: put it back
  };

  if (!available) {
    return (
      <>
        <PageHead title="Raleigh Current Jobs" />
        <div className="panel pad">Trello is connected on the live site only. This copy is running on sample data.</div>
      </>
    );
  }

  const notConnected = !loading && !lists.length;

  return (
    <>
      <PageHead title="Raleigh Current Jobs">
        <input className="search" style={{ width: 220 }} placeholder="Search cards or labels…" value={q} onChange={(e) => setQ(e.target.value)} />
        <button disabled={!!busy} onClick={() => run('sync', async () => { const r = await call('sync'); flash('ok', `Synced ${r.cards} cards from Trello.`); })}>
          {busy === 'sync' ? 'Syncing…' : '⟳ Sync now'}
        </button>
        <a className="btn-link" href={TRELLO_BOARD_URL} target="_blank" rel="noreferrer">Open in Trello ↗</a>
      </PageHead>
      {msg && <div className={`banner ${msg.tone}`}>{msg.text}</div>}
      {error && <div className="banner err">{error}</div>}

      {notConnected ? (
        <div className="panel pad">
          <h2>Trello isn’t connected yet</h2>
          <p className="muted">Once the Trello key, token and secret are saved in Supabase, click below. It registers the live
            connection with Trello and pulls in every card on the board.</p>
          <button className="primary" disabled={!!busy} onClick={() => run('setup', async () => {
            const r = await call('setup_webhook'); flash('ok', `Connected. ${r.cards} cards loaded from ${r.lists} lists.`);
          })}>{busy === 'setup' ? 'Connecting…' : 'Connect Trello'}</button>
        </div>
      ) : (
        <div className="tboard">
          {sortedLists.map((l) => {
            const items = byList.get(l.id) ?? [];
            return (
              <div key={l.id} className={`tcol ${overList === l.id ? 'over' : ''}`}
                   onDragOver={(e) => { e.preventDefault(); setOverList(l.id); }}
                   onDragLeave={() => setOverList((o) => (o === l.id ? null : o))}
                   onDrop={(e) => { e.preventDefault(); setOverList(null); const c = cards.find((x) => x.id === dragId); if (c) move(c, l.id); }}>
                <div className="tcol-head"><b>{l.name}</b><span className="muted small">{items.length}</span></div>
                {items.map((c) => {
                  const proj = c.job_code ? projectsByCode.get(c.job_code) : undefined;
                  return (
                    <div key={c.id} className={`tcard ${dragId === c.id ? 'dragging' : ''}`} draggable
                         onDragStart={() => setDragId(c.id)} onDragEnd={() => setDragId(null)} onClick={() => setOpen(c)}>
                      {c.labels.length > 0 && (
                        <div className="tlabels">{c.labels.map((lb) => <span key={lb.id} className="tlabel" style={labelStyle(lb.color)}>{lb.name || ' '}</span>)}</div>
                      )}
                      <div className="tcard-name">{c.name}</div>
                      <div className="tcard-meta">
                        {c.due && <span className={`tdue ${c.due_complete ? 'done' : new Date(c.due) < new Date() ? 'late' : ''}`}>◷ {date(c.due)}</span>}
                        {proj && <a className="tproj" href={`#/p/${encodeURIComponent(proj.code)}/dashboard`} onClick={(e) => e.stopPropagation()}>Tracker ↗</a>}
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      )}
      {open && <CardDrawer card={cards.find((c) => c.id === open.id) ?? open} onClose={() => setOpen(null)} onMove={move} flash={flash} />}
    </>
  );
}

function CardDrawer({ card, onClose, onMove, flash }:
  { card: TCard; onClose: () => void; onMove: (c: TCard, listId: string) => Promise<void>; flash: (t: 'ok' | 'err', s: string) => void }) {
  const { lists, labels, call } = useTrello();
  const { all } = useStore();
  const [listId, setListId] = useState(card.list_id);
  const [sel, setSel] = useState<Set<string>>(new Set(card.labels.map((l) => l.id)));
  const [due, setDue] = useState(card.due ? card.due.slice(0, 10) : '');
  const [dueDone, setDueDone] = useState(card.due_complete);
  const [saving, setSaving] = useState(false);
  const proj = card.job_code ? all.projects.find((p) => p.code === card.job_code) : undefined;

  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);

  const sortedLabels = [...labels].filter((l) => l.name).sort((a, b) => String(a.name).localeCompare(String(b.name)));
  const toggle = (id: string) => setSel((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const save = async () => {
    setSaving(true);
    try {
      const had = new Set(card.labels.map((l) => l.id));
      const add = [...sel].filter((id) => !had.has(id));
      const remove = [...had].filter((id) => !sel.has(id));
      if (add.length || remove.length) await call('labels', { card_id: card.id, add, remove });
      const oldDue = card.due ? card.due.slice(0, 10) : '';
      if (due !== oldDue || dueDone !== card.due_complete) {
        await call('due', { card_id: card.id, due: due ? new Date(`${due}T17:00:00`).toISOString() : null, due_complete: dueDone });
      }
      if (listId !== card.list_id) await onMove(card, listId);
      flash('ok', 'Saved to Trello.');
      onClose();
    } catch (e: any) {
      flash('err', e.message ?? String(e));
    } finally { setSaving(false); }
  };

  return (
    <div className="drawer-wrap" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="drawer">
        <div className="drawer-head">
          <h2 style={{ lineHeight: 1.3 }}>{card.name}</h2>
          <button className="ghost" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className="drawer-body">
          <div className="small" style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <a href={card.short_url} target="_blank" rel="noreferrer">Open card in Trello ↗</a>
            {proj && <a href={`#/p/${encodeURIComponent(proj.code)}/dashboard`} onClick={onClose}>Open {proj.code} in tracker</a>}
          </div>
          <label className="field"><span>List</span>
            <select value={listId} onChange={(e) => setListId(e.target.value)}>
              {[...lists].sort((a, b) => a.pos - b.pos).map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
          </label>
          <div className="field"><span>Due date</span>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
              <input type="date" value={due} onChange={(e) => setDue(e.target.value)} style={{ width: 'auto' }} />
              <label className="small" style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <input type="checkbox" checked={dueDone} onChange={(e) => setDueDone(e.target.checked)} style={{ width: 'auto' }} /> Complete
              </label>
            </div>
          </div>
          <div className="field"><span>Labels</span>
            <div className="tlabel-pick">
              {sortedLabels.map((l) => (
                <label key={l.id} className={`tpick ${sel.has(l.id) ? 'on' : ''}`}>
                  <input type="checkbox" checked={sel.has(l.id)} onChange={() => toggle(l.id)} />
                  <span className="tlabel" style={labelStyle(l.color)}>{l.name}</span>
                </label>
              ))}
            </div>
          </div>
          {card.description && <div className="field"><span>Description</span><div className="tdesc">{card.description}</div></div>}
          <p className="hint">Changes save straight to Trello. Edits made in Trello show up here within a few seconds.</p>
        </div>
        <div className="drawer-foot">
          <span style={{ flex: 1 }} />
          <button className="ghost" onClick={onClose}>Cancel</button>
          <button className="primary" disabled={saving} onClick={save}>{saving ? 'Saving…' : 'Save to Trello'}</button>
        </div>
      </div>
    </div>
  );
}

/** Small panel for a project's dashboard: its Trello card(s), if any. */
export function TrelloForProject({ code }: { code?: string }) {
  const { available, cards, lists } = useTrello();
  if (!available || !code) return null;
  const mine = cards.filter((c) => c.job_code === code);
  if (!mine.length) return null;
  return (
    <section className="panel" style={{ marginBottom: 16 }}>
      <div className="panel-head"><h2>Trello</h2><a className="small" href="#/trello">Raleigh board →</a></div>
      {mine.map((c) => (
        <div key={c.id} className="detail-row" style={{ gridTemplateColumns: '1fr auto' }}>
          <span>
            <b>{lists.find((l) => l.id === c.list_id)?.name ?? '—'}</b> · {c.name}
            <span className="tlabels" style={{ marginTop: 4 }}>{c.labels.map((lb) => <span key={lb.id} className="tlabel" style={labelStyle(lb.color)}>{lb.name}</span>)}</span>
          </span>
          <a className="small" href={c.short_url} target="_blank" rel="noreferrer">Open ↗</a>
        </div>
      ))}
    </section>
  );
}
