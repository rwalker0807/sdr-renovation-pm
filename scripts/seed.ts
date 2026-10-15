// Loads the sample data into a real Supabase database.
//   1. Fill VITE_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local
//   2. npm run seed
// Safe to skip once you're entering real project data.
import { readFileSync, existsSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import { buildSeed } from '../src/lib/data/seed';
import type { TableName } from '../src/lib/schema';

for (const f of ['.env.local', '.env']) {
  if (!existsSync(f)) continue;
  for (const line of readFileSync(f, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}
const url = process.env.VITE_SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.error('Set VITE_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY'); process.exit(1); }

const db = createClient(url, key);
const seed = buildSeed();
// parents before children
const order: TableName[] = ['vendors', 'projects', 'budget_lines', 'buyout_packages', 'commitments', 'change_orders',
  'material_buys', 'invoices', 'progress', 'scope_gaps', 'specs', 'scopes'];

for (const t of order) {
  const rows = seed[t];
  if (!rows.length) continue;
  const { error } = await db.from(t).upsert(rows);
  if (error) { console.error(t, error.message); process.exit(1); }
  console.log(`${t}: ${rows.length}`);
}
console.log('Seed complete.');
