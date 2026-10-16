import { useEffect, useMemo, useRef, useState } from 'react';
import type { Row } from '../lib/schema';
import { Pill } from './ui';

/** Top-bar "Projects" dropdown with type-to-search (job #, name, client, address) and keyboard control. */
export function ProjectPicker({ projects, current, onPick, onNew }:
  { projects: Row[]; current?: Row; onPick: (p: Row) => void; onNew: () => void }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [showDone, setShowDone] = useState(false);
  const [hi, setHi] = useState(0);
  const [left, setLeft] = useState(16);
  const wrap = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const list = useMemo(() => {
    const n = q.trim().toLowerCase();
    return [...projects]
      .filter((p) => showDone || p.status !== 'complete' || p.id === current?.id)
      .filter((p) => !n || [p.code, p.name, p.client, p.address].some((v) => String(v ?? '').toLowerCase().includes(n)))
      .sort((a, b) => String(a.code).localeCompare(String(b.code), undefined, { numeric: true }));
  }, [projects, q, showDone, current?.id]);

  useEffect(() => { setHi(0); }, [q, showDone]);
  useEffect(() => {
    if (!open) return;
    // anchor under the button, but never past the screen edges (16px gutter)
    const r = wrap.current?.getBoundingClientRect();
    const w = Math.min(460, window.innerWidth - 32);
    setLeft(Math.max(16, Math.min(r?.left ?? 16, window.innerWidth - w - 16)));
    setTimeout(() => input.current?.focus(), 0);
    const close = (e: MouseEvent) => { if (!wrap.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);
  // keep highlighted row in view
  useEffect(() => { listRef.current?.children[hi]?.scrollIntoView({ block: 'nearest' }); }, [hi]);

  const pick = (p: Row) => { onPick(p); setOpen(false); setQ(''); };
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setHi((h) => Math.min(h + 1, list.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHi((h) => Math.max(h - 1, 0)); }
    else if (e.key === 'Enter' && list[hi]) { e.preventDefault(); pick(list[hi]); }
    else if (e.key === 'Escape') setOpen(false);
  };

  return (
    <div className="picker" ref={wrap}>
      <button className={`picker-btn ${current ? 'on' : ''}`} onClick={() => setOpen((o) => !o)} aria-haspopup="listbox" aria-expanded={open}>
        {current ? <><span className="tab-code">{current.code}</span> <span className="picker-name">{current.name}</span></> : 'Projects'}
        <span className="caret">▾</span>
      </button>
      {open && (
        <div className="picker-pop" style={{ left }} onKeyDown={onKey}>
          <input ref={input} id="project-search" className="picker-search" placeholder="Search job #, name, client…" value={q}
                 onChange={(e) => setQ(e.target.value)} aria-label="Search projects" />
          <ul className="picker-list" role="listbox" ref={listRef}>
            {list.map((p, i) => (
              <li key={p.id} role="option" aria-selected={i === hi}
                  className={`${i === hi ? 'hi' : ''} ${p.id === current?.id ? 'cur' : ''}`}
                  onMouseEnter={() => setHi(i)} onMouseDown={(e) => { e.preventDefault(); pick(p); }}>
                <span className="mono">{p.code}</span>
                <span className="picker-row-name">{p.name}<span className="muted small">{p.client ? ` · ${p.client}` : ''}</span></span>
                <Pill value={p.status} />
              </li>
            ))}
            {!list.length && <li className="muted empty-row">No projects match “{q}”.</li>}
          </ul>
          <div className="picker-foot">
            <label className="small"><input type="checkbox" checked={showDone} onChange={(e) => setShowDone(e.target.checked)} /> Show completed</label>
            <button className="link small" onClick={() => { setOpen(false); onNew(); }}>+ New project</button>
          </div>
        </div>
      )}
    </div>
  );
}
