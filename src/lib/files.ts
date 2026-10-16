// Job file attachments: files in the private Supabase storage bucket "job-files", one row each in `attachments`.
import type { SupabaseClient } from '@supabase/supabase-js';
import { ENTITIES, refLabel, type Row, type TableName } from './schema';

export const BUCKET = 'job-files';
export const MAX_BYTES = 50 * 1024 * 1024; // matches the bucket limit (free plan cap)

export type Target = { project_id: string; record_table?: TableName | null; record_id?: string | null; folder?: string | null };

const safeName = (n: string) => n.normalize('NFKD').replace(/[^\w.\- ]+/g, '').replace(/\s+/g, '_').slice(-120) || 'file';

/** Upload one file and record it. Returns the attachments row. */
export async function uploadFile(client: SupabaseClient, save: (t: TableName, r: Partial<Row>) => Promise<Row>, t: Target, file: File) {
  if (file.size > MAX_BYTES) throw new Error(`${file.name} is ${fmtSize(file.size)}; the limit is ${fmtSize(MAX_BYTES)} per file.`);
  const path = [t.project_id, t.record_table ?? 'job', t.record_id ?? 'general', `${crypto.randomUUID().slice(0, 8)}-${safeName(file.name)}`].join('/');
  const up = await client.storage.from(BUCKET).upload(path, file, { contentType: file.type || undefined, upsert: false });
  if (up.error) throw new Error(`${file.name}: ${up.error.message}`);
  try {
    return await save('attachments', {
      project_id: t.project_id, record_table: t.record_table ?? null, record_id: t.record_id ?? null, folder: t.folder ?? null,
      storage_path: path, filename: file.name, size_bytes: file.size, mime: file.type || null,
    });
  } catch (e) {
    await client.storage.from(BUCKET).remove([path]);   // don't leave an orphaned file behind
    throw e;
  }
}

/** Open a file in a new tab (PDFs and photos show in the browser) or download it. Links expire after an hour. */
export async function openFile(client: SupabaseClient, a: Row, download = false) {
  // open the tab first (inside the click) so pop-up blockers allow it, then point it at the signed link
  const win = download ? null : window.open('', '_blank');
  const { data, error } = await client.storage.from(BUCKET).createSignedUrl(a.storage_path, 3600, download ? { download: a.filename } : undefined);
  if (error || !data) { win?.close(); throw new Error(error?.message ?? 'Could not open the file'); }
  if (win) win.location.href = data.signedUrl;
  else window.location.href = data.signedUrl;
}

/** Delete files from storage and their rows. */
export async function deleteFiles(client: SupabaseClient, remove: (t: TableName, id: string) => Promise<void>, rows: Row[]) {
  if (!rows.length) return;
  for (let i = 0; i < rows.length; i += 100) {
    const { error } = await client.storage.from(BUCKET).remove(rows.slice(i, i + 100).map((r) => r.storage_path));
    if (error) throw error;
  }
  for (const r of rows) await remove('attachments', r.id);
}

export function fmtSize(n?: number | null) {
  if (n == null) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1024 ** 2).toFixed(n < 10 * 1024 ** 2 ? 1 : 0)} MB`;
}

export function fileIcon(a: { mime?: string | null; filename?: string; [k: string]: any }) {
  const m = a.mime ?? '', n = (a.filename ?? '').toLowerCase();
  if (m.startsWith('image/')) return '🖼';
  if (m === 'application/pdf' || n.endsWith('.pdf')) return '📄';
  if (/sheet|excel|csv/.test(m) || /\.(xlsx?|xlsm|csv)$/.test(n)) return '📊';
  if (/word|document/.test(m) || /\.docx?$/.test(n)) return '📝';
  if (/\.(esx|xml)$/.test(n)) return '🧾';
  if (/zip|compressed/.test(m) || /\.(zip|7z|rar)$/.test(n)) return '🗜';
  if (m.startsWith('video/')) return '🎞';
  return '📎';
}

/** Short name for the record a file is attached to, e.g. "Invoice 1043 · ABC Plumbing". */
export function recordName(table: string | null | undefined, r: Row | undefined, byId: (t: TableName, id?: string | null) => Row | undefined) {
  if (!table) return 'General job file';
  const ent = ENTITIES[table as TableName];
  if (!r) return `${ent?.singular ?? table} (deleted)`;
  const vendor = (id?: string | null) => byId('vendors', id)?.name;
  const join = (...xs: unknown[]) => xs.filter((x) => x != null && x !== '').join(' · ');
  switch (table) {
    case 'invoices': return join(`Invoice ${r.invoice_number ?? ''}`.trim(), vendor(r.vendor_id));
    case 'change_orders': return join(`CO ${r.co_number ?? ''}`.trim(), r.description);
    case 'commitments': return join(r.kind === 'po' ? `PO ${r.number ?? ''}`.trim() : `Subcontract ${r.number ?? ''}`.trim(), vendor(r.vendor_id) ?? r.description);
    case 'material_buys': return join('Material', r.item, r.po_number && `PO ${r.po_number}`);
    case 'buyout_packages': return join('Buyout', r.package);
    case 'scope_gaps': return join('Scope gap', r.title);
    case 'scopes': return join('Scope', r.trade);
    case 'specs': return join('Spec', r.section, r.title);
    case 'project_vendors': return join('Vendor', vendor(r.vendor_id));
    case 'progress': return join('Progress', r.building, r.unit, r.activity);
    default: return join(ent?.singular, refLabel(table as TableName, r));
  }
}

export const GENERAL_FOLDERS = ['Contract', 'Proposal / estimate', 'Xactimate / EMS', 'Drawings & specs', 'Permits & inspections', 'Insurance / COI', 'Photos', 'Closeout', 'Other'];
