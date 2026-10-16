import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { DataSource } from './data/source';

export type TList = { id: string; name: string; pos: number; closed: boolean };
export type TLabel = { id: string; name: string | null; color: string | null };
export type TCard = {
  id: string; list_id: string; name: string; job_code: string | null; labels: TLabel[];
  due: string | null; due_complete: boolean; description: string | null; closed: boolean;
  pos: number; short_url: string; last_activity: string | null;
  client: string | null; invoice_to: string | null; claim_id: string | null; encircle_url: string | null;
  custom_fields: Record<string, string>;
};

export const TRELLO_BOARD_URL = 'https://trello.com/b/DzJDcnGb/raleigh-current-jobs';

// Trello's label colour names -> hex
const COLORS: Record<string, string> = {
  green: '#4bce97', green_dark: '#1f845a', green_light: '#baf3db', yellow: '#f5cd47', yellow_dark: '#946f00', yellow_light: '#f8e6a0',
  orange: '#fea362', orange_dark: '#c25100', orange_light: '#fedec8', red: '#f87168', red_dark: '#c9372c', red_light: '#ffd5d2',
  purple: '#9f8fef', purple_dark: '#6e5dc6', purple_light: '#dfd8fd', blue: '#579dff', blue_dark: '#0c66e4', blue_light: '#cce0ff',
  sky: '#6cc3e0', sky_dark: '#227d9b', sky_light: '#c6edfb', lime: '#94c748', lime_dark: '#5b7f24', lime_light: '#d3f1a7',
  pink: '#e774bb', pink_dark: '#ae4787', pink_light: '#fdd0ec', black: '#8590a2', black_dark: '#626f86', black_light: '#dcdfe4',
};
const LIGHT = new Set(['green_light', 'yellow', 'yellow_light', 'orange_light', 'red_light', 'purple_light', 'blue_light', 'sky_light', 'lime_light', 'pink_light', 'black_light', 'green', 'lime', 'sky']);
export const labelStyle = (c: string | null) => ({ background: c ? COLORS[c] ?? '#8590a2' : '#dcdfe4', color: c && !LIGHT.has(c) ? '#fff' : '#1d2125' });

interface TrelloState {
  available: boolean;            // false in demo mode
  lists: TList[]; labels: TLabel[]; cards: TCard[];
  loading: boolean; error: string | null;
  call: (action: string, payload?: Record<string, unknown>) => Promise<any>;
  patchLocal: (id: string, patch: Partial<TCard>) => void;
}
const Ctx = createContext<TrelloState | null>(null);
export const useTrello = () => {
  const s = useContext(Ctx);
  if (!s) throw new Error('TrelloProvider missing');
  return s;
};

export function TrelloProvider({ source, children }: { source: DataSource; children: ReactNode }) {
  const client: any = (source as any).client;
  const available = source.kind === 'supabase' && !!client;
  const [lists, setLists] = useState<TList[]>([]);
  const [labels, setLabels] = useState<TLabel[]>([]);
  const [cards, setCards] = useState<TCard[]>([]);
  const [loading, setLoading] = useState(available);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!available) return;
    let alive = true;
    (async () => {
      const [l, lb, c] = await Promise.all([
        client.from('trello_lists').select('*').eq('closed', false),
        client.from('trello_labels').select('*'),
        client.from('trello_cards').select('*').eq('closed', false),
      ]);
      if (!alive) return;
      const err = l.error || lb.error || c.error;
      if (err) setError(err.message);
      setLists(l.data ?? []); setLabels(lb.data ?? []); setCards(c.data ?? []);
      setLoading(false);
    })();
    const apply = <T extends { id: string }>(set: (f: (p: T[]) => T[]) => void, keep: (r: T) => boolean) => (payload: any) => {
      set((prev) => {
        if (payload.eventType === 'DELETE') return prev.filter((r) => r.id !== payload.old?.id);
        const row = payload.new as T;
        const rest = prev.filter((r) => r.id !== row.id);
        return keep(row) ? [...rest, row] : rest;
      });
    };
    const ch = client.channel('trello-live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'trello_lists' }, apply<TList>(setLists, (r) => !r.closed))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'trello_labels' }, apply<TLabel>(setLabels, () => true))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'trello_cards' }, apply<TCard>(setCards, (r) => !r.closed))
      .subscribe();
    return () => { alive = false; client.removeChannel(ch); };
  }, [available, client]);

  const call = useCallback(async (action: string, payload: Record<string, unknown> = {}) => {
    if (!available) throw new Error('Trello is only connected on the live site.');
    const { data, error } = await client.functions.invoke('trello', { body: { action, ...payload } });
    if (error) {
      let msg = error.message;
      try { const b = await error.context?.json?.(); if (b?.error) msg = b.error; } catch { /* ignore */ }
      throw new Error(msg);
    }
    if (data?.error) throw new Error(data.error);
    return data;
  }, [available, client]);

  const patchLocal = useCallback((id: string, patch: Partial<TCard>) => {
    setCards((prev) => prev.map((c) => (c.id === id ? { ...c, ...patch } : c)));
  }, []);

  const value = useMemo(() => ({ available, lists, labels, cards, loading, error, call, patchLocal }),
    [available, lists, labels, cards, loading, error, call, patchLocal]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
