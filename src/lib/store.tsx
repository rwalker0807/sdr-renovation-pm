import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ALL_TABLES, ENTITIES, type Row, type TableName } from './schema';
import type { DataSource, ChangeEvent } from './data/source';

type Tables = Record<TableName, Row[]>;
const empty = (): Tables => Object.fromEntries(ALL_TABLES.map((t) => [t, []])) as unknown as Tables;

interface Store {
  source: DataSource;
  projectId: string | null;
  setProjectId: (id: string) => void;
  data: Tables;
  byId: (t: TableName, id?: string | null) => Row | undefined;
  loading: boolean;
  error: string | null;
  live: boolean;
  lastEvent: { at: number; label: string } | null;
  recent: Set<string>;  // ids changed in the last few seconds (for row flash)
  save: (t: TableName, row: Partial<Row>) => Promise<void>;
  remove: (t: TableName, id: string) => Promise<void>;
}

const Ctx = createContext<Store | null>(null);
export const useStore = () => {
  const s = useContext(Ctx);
  if (!s) throw new Error('StoreProvider missing');
  return s;
};

export function StoreProvider({ source, children }: { source: DataSource; children: ReactNode }) {
  const [data, setData] = useState<Tables>(empty);
  const [projectId, setProjectIdState] = useState<string | null>(() => {
    try { return localStorage.getItem('reno-pm-project'); } catch { return null; }
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [live, setLive] = useState(false);
  const [lastEvent, setLastEvent] = useState<Store['lastEvent']>(null);
  const [recent, setRecent] = useState<Set<string>>(new Set());
  const pidRef = useRef(projectId);
  pidRef.current = projectId;

  const setProjectId = (id: string) => {
    setProjectIdState(id);
    try { localStorage.setItem('reno-pm-project', id); } catch { /* ignore */ }
  };

  // initial + per-project load
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true); setError(null);
      try {
        const projects = await source.list('projects');
        let pid = pidRef.current;
        if (!pid || !projects.find((p) => p.id === pid)) {
          pid = projects[0]?.id ?? null;
          if (pid) setProjectId(pid);
        }
        const entries = await Promise.all(
          ALL_TABLES.map(async (t) => [t, t === 'projects' ? projects : await source.list(t, pid ?? undefined)] as const),
        );
        if (!cancelled) setData(Object.fromEntries(entries) as unknown as Tables);
      } catch (e: any) {
        if (!cancelled) setError(e?.message ?? String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [source, projectId]);

  // realtime: apply each change event in place, no refetch
  useEffect(() => {
    const unsub = source.subscribe((e: ChangeEvent) => {
      const ent = ENTITIES[e.table];
      if (e.row && ent.projectScoped && e.row.project_id !== pidRef.current) return;
      setData((prev) => {
        const rows = prev[e.table];
        let next: Row[];
        if (e.type === 'DELETE') next = rows.filter((r) => r.id !== e.oldId);
        else {
          const i = rows.findIndex((r) => r.id === e.row!.id);
          next = i >= 0 ? rows.map((r, j) => (j === i ? e.row! : r)) : [...rows, e.row!];
        }
        return { ...prev, [e.table]: next };
      });
      const id = e.row?.id ?? e.oldId;
      if (id) {
        setRecent((s) => new Set(s).add(id));
        setTimeout(() => setRecent((s) => { const n = new Set(s); n.delete(id); return n; }), 2500);
      }
      setLastEvent({ at: Date.now(), label: `${ent.singular} ${e.type.toLowerCase()}d` });
    });
    setLive(true);
    return () => { unsub(); setLive(false); };
  }, [source]);

  const index = useMemo(() => {
    const m = new Map<string, Row>();
    ALL_TABLES.forEach((t) => data[t].forEach((r) => m.set(`${t}:${r.id}`, r)));
    return m;
  }, [data]);
  const byId = useCallback((t: TableName, id?: string | null) => (id ? index.get(`${t}:${id}`) : undefined), [index]);

  const save = useCallback(async (t: TableName, row: Partial<Row>) => {
    const payload = { ...row };
    if (ENTITIES[t].projectScoped && !payload.project_id) payload.project_id = pidRef.current;
    if (payload.id) await source.update(t, payload.id, payload);
    else await source.insert(t, payload);
    // UI updates arrive through the realtime subscription
  }, [source]);

  const remove = useCallback((t: TableName, id: string) => source.remove(t, id), [source]);

  const value: Store = { source, projectId, setProjectId, data, byId, loading, error, live, lastEvent, recent, save, remove };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
