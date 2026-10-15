import type { Row, TableName } from '../schema';

export type ChangeEvent = {
  table: TableName;
  type: 'INSERT' | 'UPDATE' | 'DELETE';
  row?: Row;     // new row for INSERT/UPDATE
  oldId?: string // id for DELETE
};

/**
 * Everything the UI needs from a backend. Two implementations:
 *  - supabaseSource: live Postgres + realtime websockets (production)
 *  - demoSource:     in-browser sample data, syncs across tabs (no setup needed)
 * Swapping backends later (e.g. SQL Server / Procore API) = write a third adapter.
 */
export interface DataSource {
  kind: 'supabase' | 'demo';
  list(table: TableName, projectId?: string): Promise<Row[]>;
  insert(table: TableName, row: Partial<Row>): Promise<Row>;
  update(table: TableName, id: string, patch: Partial<Row>): Promise<Row>;
  remove(table: TableName, id: string): Promise<void>;
  subscribe(cb: (e: ChangeEvent) => void): () => void;
}
