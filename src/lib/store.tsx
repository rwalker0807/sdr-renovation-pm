import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ALL_TABLES, ENTITIES, type Row, type TableName } from './schema';
import type { DataSource, ChangeEvent } from './data/source';

export type Tables = Record<TableName, Row[]>;
const empty = (): Tables => Object.fromEntries(ALL_TABLES.map((t) => [t, []])) as unknown as Tables;

/** One project's slice of the data (shared tables like vendors/projects stay whole). */
export function forProject(all: Tables, pid: string | null): Tables {
  return Object.fromEntries(
    ALL_TABLES.map((t) => [t, ENTITIES[t].projectScoped ? all[t].filter((r) => r.project_id === pid) : all[t]]),
  ) as unknown as Tables;
}

interface Store {
  source: DataSource;
  projectId: string | null;           // null = company-wide pages (Home, Crew)
  setProjectId: (id: string | null) => void;
  all: Tables;                        // every project
  data: Tables;                       // current project only
  byId: (t: TableName, id?: string | null) => Row | undefined;
  loading: boolean;
  error: string | null;
  live: boolean;
  lastEvent: { at: number; label: string } | null;
  recent: Set<string>;                // ids changed in the last few seconds (for row flash)
  save: (t: TableName, row: Partial<Row>) => Promise<Row>;
  remove: (t: TableName, id: string) => Promise<void>;
}

const Ctx = createContext<Store | null>(null);
export const useStore = () => {
  const s = useContext(Ctx);
  if (!s) throw new Error('StoreProvider missing');
  return s;
};

export function StoreProvider({ source, children }: { source: DataSource; children: ReactNode }) {
  const [all, setAll] = useState<Tables>(empty);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [live, setLive] = useState(false);
  const [lastEvent, setLastEvent] = useState<Store['lastEvent']>(null);
  const [recent, setRecent] = useState<Set<string>>(new Set());
  const pidRef = useRef(projectId);
  pidRef.current = projectId;

  // load everything once (a few thousand rows across all jobs)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true); setError(null);
      try {
        const entries = await Promise.all(ALL_TABLES.map(async (t) => [t, await source.list(t)] as const));
        if (!cancelled) setAll(Object.fromEntries(entries) as unknown as Tables);
      } catch (e: any) {
        if (!cancelled) setError(e?.message ?? String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [source]);

  // realtime: apply each change event in place, no refetch
  useEffect(() => {
    const unsub = source.subscribe((e: ChangeEvent) => {
      const ent = ENTITIES[e.table];
      setAll((prev) => {
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

  const data = useMemo(() => forProject(all, projectId), [all, projectId]);

  const index = useMemo(() => {
    const m = new Map<string, Row>();
    ALL_TABLES.forEach((t) => all[t].forEach((r) => m.set(`${t}:${r.id}`, r)));
    return m;
  }, [all]);
  const byId = useCallback((t: TableName, id?: string | null) => (id ? index.get(`${t}:${id}`) : undefined), [index]);

  const save = useCallback(async (t: TableName, row: Partial<Row>) => {
    const payload = { ...row };
    if (ENTITIES[t].projectScoped && !payload.project_id) payload.project_id = pidRef.current;
    const saved = payload.id ? await source.update(t, payload.id, payload) : await source.insert(t, payload);
    // apply it now (the realtime echo that follows is idempotent); the row is returned for follow-up work (e.g. attaching files)
    if (saved?.id) setAll((prev) => {
      const rows = prev[t]; const i = rows.findIndex((r) => r.id === saved.id);
      return { ...prev, [t]: i >= 0 ? rows.map((r, j) => (j === i ? saved : r)) : [...rows, saved] };
    });
    return saved;
  }, [source]);

  const remove = useCallback(async (t: TableName, id: string) => {
    await source.remove(t, id);
    setAll((prev) => ({ ...prev, [t]: prev[t].filter((r) => r.id !== id) }));
  }, [source]);

  const value: Store = { source, projectId, setProjectId, all, data, byId, loading, error, live, lastEvent, recent, save, remove };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
