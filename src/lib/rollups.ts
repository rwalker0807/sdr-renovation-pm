import type { Row, TableName } from './schema';

type Tables = Record<TableName, Row[]>;
const num = (v: any) => Number(v) || 0;
const sumBy = (rows: Row[], f: (r: Row) => number) => rows.reduce((a, r) => a + f(r), 0);

export interface BudgetRollup {
  line: Row;
  original: number;
  ownerChanges: number;   // approved owner COs
  revised: number;
  committed: number;      // executed/out-for-sig commitments + approved sub COs + ordered materials
  unbought: number;       // forecast for scope not yet bought out
  exposure: number;       // open scope gaps + pending sub COs
  projected: number;      // committed + unbought + exposure
  variance: number;       // revised - projected (negative = over)
  invoiced: number;
  paid: number;
}

/**
 * Cost-code rollup. Same logic as the `budget_rollup` SQL view.
 * Lines with no buyout packages forecast their remaining budget as "unbought"
 * (e.g. general conditions, material-only lines).
 */
export function budgetRollup(d: Tables): BudgetRollup[] {
  return d.budget_lines
    .slice()
    .sort((a, b) => String(a.cost_code).localeCompare(String(b.cost_code)))
    .map((line) => {
      const on = (r: Row) => r.budget_line_id === line.id;
      const ownerChanges = sumBy(d.change_orders.filter((c) => on(c) && c.kind === 'owner' && c.status === 'approved'), (c) => num(c.amount));
      const subApproved = sumBy(d.change_orders.filter((c) => on(c) && c.kind === 'sub' && c.status === 'approved'), (c) => num(c.amount));
      const subPending = sumBy(d.change_orders.filter((c) => on(c) && c.kind === 'sub' && c.status === 'pending'), (c) => num(c.amount));
      const commits = sumBy(d.commitments.filter((c) => on(c) && c.status !== 'draft'), (c) => num(c.amount));
      const mats = sumBy(d.material_buys.filter((m) => on(m) && m.status !== 'quoted'), (m) => num(m.quantity) * num(m.unit_cost));
      const pkgs = d.buyout_packages.filter(on);
      const original = num(line.original_budget);
      const revised = original + ownerChanges;
      const committed = commits + subApproved + mats;
      const unbought = pkgs.length
        ? sumBy(pkgs.filter((p) => !['awarded', 'contracted'].includes(p.status)), (p) => num(p.budget_amount))
        : Math.max(revised - committed, 0);
      const exposure = subPending + sumBy(d.scope_gaps.filter((g) => on(g) && g.status !== 'resolved'), (g) => num(g.est_cost));
      const projected = committed + unbought + exposure;
      const inv = d.invoices.filter(on);
      return {
        line, original, ownerChanges, revised, committed, unbought, exposure, projected,
        variance: revised - projected,
        invoiced: sumBy(inv, (i) => num(i.amount)),
        paid: sumBy(inv.filter((i) => i.status === 'paid'), (i) => num(i.amount)),
      };
    });
}

export function totals(rs: BudgetRollup[]) {
  const keys = ['original', 'ownerChanges', 'revised', 'committed', 'unbought', 'exposure', 'projected', 'variance', 'invoiced', 'paid'] as const;
  return Object.fromEntries(keys.map((k) => [k, sumBy(rs as any, (r: any) => r[k])])) as Record<(typeof keys)[number], number>;
}

export function overallProgress(d: Tables) {
  if (!d.progress.length) return 0;
  return sumBy(d.progress, (p) => num(p.pct_complete)) / d.progress.length;
}

export function buyoutSummary(d: Tables) {
  const pk = d.buyout_packages;
  const budget = sumBy(pk, (p) => num(p.budget_amount));
  const bought = pk.filter((p) => ['awarded', 'contracted'].includes(p.status));
  const boughtBudget = sumBy(bought, (p) => num(p.budget_amount));
  const awarded = sumBy(bought, (p) => num(p.awarded_amount));
  return { count: pk.length, boughtCount: bought.length, budget, boughtBudget, awarded, savings: boughtBudget - awarded,
           pct: budget ? (boughtBudget / budget) * 100 : 0 };
}

/** Items that need someone's attention today. */
export function attentionItems(d: Tables, byId: (t: TableName, id?: string) => Row | undefined) {
  const today = new Date().toISOString().slice(0, 10);
  const inDays = (n: number) => { const x = new Date(); x.setDate(x.getDate() + n); return x.toISOString().slice(0, 10); };
  const out: { kind: string; text: string; tone: 'red' | 'amber'; table: TableName; id: string }[] = [];

  d.buyout_packages.forEach((p) => {
    if (p.target_award && p.target_award < today && !['awarded', 'contracted'].includes(p.status))
      out.push({ kind: 'Buyout', text: `${p.package} — award was due ${p.target_award}`, tone: 'red', table: 'buyout_packages', id: p.id });
  });
  d.material_buys.forEach((m) => {
    if (m.need_by && m.need_by <= inDays(14) && !['delivered', 'installed'].includes(m.status))
      out.push({ kind: 'Material', text: `${m.item} — need by ${m.need_by} (${m.status})`, tone: m.need_by < today ? 'red' : 'amber', table: 'material_buys', id: m.id });
  });
  d.invoices.forEach((i) => {
    if (i.status === 'disputed') out.push({ kind: 'Invoice', text: `${byId('vendors', i.vendor_id)?.name ?? ''} #${i.invoice_number} disputed`, tone: 'red', table: 'invoices', id: i.id });
    else if (i.status === 'received' && i.invoice_date && i.invoice_date < inDays(-7))
      out.push({ kind: 'Invoice', text: `${byId('vendors', i.vendor_id)?.name ?? ''} #${i.invoice_number} awaiting approval since ${i.invoice_date}`, tone: 'amber', table: 'invoices', id: i.id });
  });
  const activeVendors = new Set(d.commitments.map((c) => c.vendor_id));
  d.vendors.forEach((v) => {
    if (activeVendors.has(v.id) && v.coi_expires && v.coi_expires <= inDays(30))
      out.push({ kind: 'COI', text: `${v.name} insurance expires ${v.coi_expires}`, tone: v.coi_expires < today ? 'red' : 'amber', table: 'vendors', id: v.id });
  });
  d.commitments.forEach((c) => {
    if (c.status === 'executed' && !c.coi_received)
      out.push({ kind: 'COI', text: `${c.number} executed without COI on file`, tone: 'red', table: 'commitments', id: c.id });
  });
  d.progress.forEach((p) => {
    if (p.status === 'blocked') out.push({ kind: 'Field', text: `${p.building} ${p.activity} blocked${p.notes ? ': ' + p.notes : ''}`, tone: 'red', table: 'progress', id: p.id });
  });
  d.scope_gaps.forEach((g) => {
    if (g.status === 'open') out.push({ kind: 'Scope gap', text: `${g.title}`, tone: 'amber', table: 'scope_gaps', id: g.id });
  });
  return out.sort((a, b) => (a.tone === b.tone ? 0 : a.tone === 'red' ? -1 : 1));
}
