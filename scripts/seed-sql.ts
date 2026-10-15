// Prints the sample data as SQL INSERTs (for pasting into the Supabase SQL editor).
import { buildSeed } from '../src/lib/data/seed';
import type { TableName } from '../src/lib/schema';
const seed = buildSeed();
const order: TableName[] = ['vendors', 'projects', 'budget_lines', 'buyout_packages', 'commitments', 'change_orders',
  'material_buys', 'invoices', 'progress', 'scope_gaps', 'specs', 'scopes'];
const lit = (v: any) => v == null ? 'null' : typeof v === 'number' || typeof v === 'boolean' ? String(v) : `'${String(v).replace(/'/g, "''")}'`;
const out: string[] = [];
for (const t of order) {
  const rows = seed[t]; if (!rows.length) continue;
  const cols = [...new Set(rows.flatMap((r) => Object.keys(r)))];
  out.push(`insert into ${t} (${cols.join(', ')}) values\n` + rows.map((r) => `(${cols.map((c) => lit(r[c])).join(', ')})`).join(',\n') + ';');
}
console.log(out.join('\n\n'));
