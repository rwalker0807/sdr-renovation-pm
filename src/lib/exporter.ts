import { ENTITIES, refLabel, type Row, type TableName } from './schema';
import { budgetRollup } from './rollups';

type ById = (t: TableName, id?: string | null) => Row | undefined;
type Sheet = { name: string; rows: Record<string, any>[] };

/** Turn records into spreadsheet rows: friendly headers, linked records shown by name. */
export function sheetRows(table: TableName, rows: Row[], byId: ById): Record<string, any>[] {
  const fields = ENTITIES[table].fields;
  return rows.map((r) => {
    const o: Record<string, any> = {};
    for (const f of fields) {
      let v = f.computed ? f.computed(r) : r[f.key];
      if (f.type === 'ref') v = refLabel(f.ref!, byId(f.ref!, v));
      else if (['money', 'number', 'percent'].includes(f.type)) v = v == null || v === '' ? null : Number(v);
      else if (f.type === 'bool') v = v ? 'Y' : 'N';
      else if (f.type === 'date') v = v ? String(v).slice(0, 10) : null;
      o[f.label] = v ?? null;
    }
    return o;
  });
}

function budgetRows(data: Record<TableName, Row[]>) {
  return budgetRollup(data).map((r) => ({
    'Cost code': r.line.cost_code, Division: r.line.division, Description: r.line.description,
    Original: r.original, 'Owner COs': r.ownerChanges, Revised: r.revised, Committed: r.committed,
    Unbought: r.unbought, Exposure: r.exposure, Projected: r.projected, 'Over / under': r.variance,
    Invoiced: r.invoiced, Paid: r.paid,
  }));
}

const safe = (s: string) => s.replace(/[\\/?*[\]:]/g, '-').slice(0, 31);
const stamp = () => new Date().toISOString().slice(0, 10);

export async function downloadWorkbook(filename: string, sheets: Sheet[]) {
  const XLSX = await import('xlsx');
  const wb = XLSX.utils.book_new();
  for (const s of sheets) {
    const ws = XLSX.utils.json_to_sheet(s.rows.length ? s.rows : [{ '': 'No records' }]);
    const keys = Object.keys(s.rows[0] ?? {});
    ws['!cols'] = keys.map((k) => ({ wch: Math.min(48, Math.max(10, k.length + 2, ...s.rows.slice(0, 200).map((r) => String(r[k] ?? '').length))) }));
    XLSX.utils.book_append_sheet(wb, ws, safe(s.name));
  }
  XLSX.writeFile(wb, `${filename} ${stamp()}.xlsx`);
}

export function exportTable(project: Row | undefined, table: TableName, rows: Row[], byId: ById) {
  const label = ENTITIES[table].label;
  return downloadWorkbook(`${project?.code ?? ''} ${label}`.trim(), [{ name: label, rows: sheetRows(table, rows, byId) }]);
}

export function exportBudget(project: Row | undefined, data: Record<TableName, Row[]>) {
  return downloadWorkbook(`${project?.code ?? ''} Budget`.trim(), [{ name: 'Budget', rows: budgetRows(data) }]);
}

/** Every tracker for the selected project in one workbook (pay app support, owner/lender reports). */
export function exportProject(project: Row | undefined, data: Record<TableName, Row[]>, byId: ById) {
  const order: TableName[] = ['change_orders', 'buyout_packages', 'commitments', 'material_buys', 'invoices',
    'progress', 'scope_gaps', 'scopes', 'specs'];
  const sheets: Sheet[] = [
    { name: 'Budget', rows: budgetRows(data) },
    ...order.map((t) => ({ name: ENTITIES[t].label, rows: sheetRows(t, data[t], byId) })),
  ];
  return downloadWorkbook(`${project?.code ?? ''} ${project?.name ?? 'Project'} - Tracker Export`.trim(), sheets);
}
