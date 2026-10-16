import type { DataSource } from './data/source';

/**
 * Shared store for the crew scheduler page (public/crew-scheduler.html).
 * The scheduler runs in a same-origin iframe and looks for `window.parent.sdrCrewDb`,
 * which mimics the small doc API it was written against: doc(path).get / set / onSnapshot.
 * The whole schedule is one JSON row in Supabase table `crew_schedule` (id 'main'),
 * streamed live to every open browser. Our own saves are skipped when they echo back
 * so typing isn't interrupted.
 */
export function makeCrewDb(source: DataSource) {
  const client: any = (source as any).client;
  if (source.kind !== 'supabase' || !client) return null;
  const mine = new Set<string>();
  const channels: any[] = [];
  const ROW = 'main';
  const doc = () => ({
    async get() {
      const { data, error } = await client.from('crew_schedule').select('state').eq('id', ROW).maybeSingle();
      if (error) throw error;
      return { exists: !!data, data: () => data?.state };
    },
    async set(state: unknown) {
      const write_id = crypto.randomUUID();
      mine.add(write_id);
      const { data: s } = await client.auth.getSession();
      const { error } = await client.from('crew_schedule')
        .upsert({ id: ROW, state: JSON.parse(JSON.stringify(state)), write_id, updated_by: s?.session?.user?.email ?? null });
      if (error) { mine.delete(write_id); throw error; }
    },
    onSnapshot(onData: (snap: { exists: boolean; data: () => unknown }) => void, onError?: (e: unknown) => void) {
      const ch = client.channel(`crew-live-${channels.length}`)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'crew_schedule', filter: `id=eq.${ROW}` }, (p: any) => {
          const row = p.new;
          if (!row?.state) return;
          if (row.write_id && mine.has(row.write_id)) { mine.delete(row.write_id); return; }
          onData({ exists: true, data: () => row.state });
        })
        .subscribe((status: string) => { if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') onError?.(new Error(status)); });
      channels.push(ch);
      return () => client.removeChannel(ch);
    },
  });
  return {
    doc,
    /** Open cards on the Raleigh Current Jobs board, with their list name. */
    async trelloCards() {
      const [l, c] = await Promise.all([
        client.from('trello_lists').select('id,name'),
        client.from('trello_cards').select('id,name,list_id').eq('closed', false),
      ]);
      if (l.error || c.error) throw l.error || c.error;
      const names = new Map((l.data ?? []).map((x: any) => [x.id, x.name]));
      return (c.data ?? []).map((x: any) => ({ id: x.id, name: x.name, list: names.get(x.list_id) ?? '' }));
    },
    onTrelloChange(cb: () => void) {
      const ch = client.channel(`crew-trello-${channels.length}`)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'trello_cards' }, () => cb())
        .subscribe();
      channels.push(ch);
    },
    close() { channels.splice(0).forEach((ch) => client.removeChannel(ch)); },
  };
}
