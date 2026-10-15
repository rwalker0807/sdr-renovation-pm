import { ENTITIES, type Row, type TableName } from '../schema';
import type { DataSource, ChangeEvent } from './source';
import { buildSeed } from './seed';

const KEY = 'sdr-reno-pm-demo-v1';
type DB = Record<TableName, Row[]>;

function load(): DB {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return JSON.parse(raw);
  } catch { /* storage unavailable: fall through to seed */ }
  return buildSeed();
}

/**
 * Demo backend: sample data in the browser. Changes persist locally and
 * broadcast to other open tabs, so "live updating" can be tried with two windows.
 */
export function createDemoSource(): DataSource & { reset(): void } {
  let db = load();
  const listeners = new Set<(e: ChangeEvent) => void>();
  let bc: BroadcastChannel | null = null;
  try { bc = new BroadcastChannel(KEY); } catch { bc = null; }

  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(db)); } catch { /* ignore */ } };
  const emit = (e: ChangeEvent, local = true) => {
    listeners.forEach((l) => l(e));
    if (local) bc?.postMessage(e);
  };

  // apply events coming from another tab
  if (bc) bc.onmessage = (m) => {
    const e = m.data as ChangeEvent;
    applyLocal(e);
    emit(e, false);
  };

  function applyLocal(e: ChangeEvent) {
    const rows = db[e.table];
    if (e.type === 'DELETE') db[e.table] = rows.filter((r) => r.id !== e.oldId);
    else if (e.row) {
      const i = rows.findIndex((r) => r.id === e.row!.id);
      if (i >= 0) rows[i] = e.row; else rows.push(e.row);
    }
    save();
  }

  const clean = (r: Partial<Row>) => Object.fromEntries(Object.entries(r).filter(([k]) => !k.startsWith('_')));
  const now = () => new Date().toISOString();

  return {
    kind: 'demo',
    async list(table, projectId) {
      const rows = db[table] ?? [];
      return ENTITIES[table].projectScoped && projectId ? rows.filter((r) => r.project_id === projectId) : [...rows];
    },
    async insert(table, row) {
      const r: Row = { ...clean(row), id: crypto.randomUUID(), created_at: now(), updated_at: now() } as Row;
      const e: ChangeEvent = { table, type: 'INSERT', row: r };
      applyLocal(e); emit(e);
      return r;
    },
    async update(table, id, patch) {
      const cur = db[table].find((r) => r.id === id);
      if (!cur) throw new Error('Not found');
      const r = { ...cur, ...clean(patch), id, updated_at: now() };
      const e: ChangeEvent = { table, type: 'UPDATE', row: r };
      applyLocal(e); emit(e);
      return r;
    },
    async remove(table, id) {
      const e: ChangeEvent = { table, type: 'DELETE', oldId: id };
      applyLocal(e); emit(e);
    },
    subscribe(cb) { listeners.add(cb); return () => { listeners.delete(cb); }; },
    reset() {
      db = buildSeed(); save();
      location.reload();
    },
  };
}
