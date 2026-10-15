import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { ALL_TABLES, ENTITIES, type Row, type TableName } from '../schema';
import type { DataSource, ChangeEvent } from './source';

// Strip client-only computed keys (prefixed "_") before writing.
const clean = (r: Partial<Row>) =>
  Object.fromEntries(Object.entries(r).filter(([k]) => !k.startsWith('_')));

export function createSupabaseSource(url: string, anonKey: string): DataSource & { client: SupabaseClient } {
  const client = createClient(url, anonKey);

  return {
    kind: 'supabase',
    client,

    async list(table, projectId) {
      let q = client.from(table).select('*');
      if (ENTITIES[table].projectScoped && projectId) q = q.eq('project_id', projectId);
      const { data, error } = await q.limit(10000);
      if (error) throw error;
      return (data ?? []) as Row[];
    },

    async insert(table, row) {
      const { data, error } = await client.from(table).insert(clean(row)).select().single();
      if (error) throw error;
      return data as Row;
    },

    async update(table, id, patch) {
      const { id: _drop, ...rest } = clean(patch);
      const { data, error } = await client.from(table).update(rest).eq('id', id).select().single();
      if (error) throw error;
      return data as Row;
    },

    async remove(table, id) {
      const { error } = await client.from(table).delete().eq('id', id);
      if (error) throw error;
    },

    // One websocket channel; Postgres pushes every insert/update/delete on our tables.
    subscribe(cb: (e: ChangeEvent) => void) {
      const channel = client.channel('reno-pm-live');
      channel.on('postgres_changes', { event: '*', schema: 'public' }, (payload: any) => {
        const table = payload.table as TableName;
        if (!ALL_TABLES.includes(table)) return;
        if (payload.eventType === 'DELETE') cb({ table, type: 'DELETE', oldId: payload.old?.id });
        else cb({ table, type: payload.eventType, row: payload.new });
      });
      channel.subscribe();
      return () => { client.removeChannel(channel); };
    },
  };
}
