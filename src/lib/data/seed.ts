import type { Row, TableName } from '../schema';

// Sample data so the app is usable before a database exists.
// Shape mirrors a 160-unit / 20-building garden-style renovation.
// All names and figures are fictional.

let n = 0;
const uid = () => {
  // stable-looking v4 UUIDs (Postgres accepts these for the seed script)
  n++;
  const h = n.toString(16).padStart(12, '0');
  return `00000000-0000-4000-8000-${h}`;
};
let s = 42;
const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
const day = (offset: number) => {
  const d = new Date(); d.setDate(d.getDate() + offset);
  return d.toISOString().slice(0, 10);
};

export const ACTIVITIES = [
  'Abatement', 'Electrical (Al wiring)', 'Roofing', 'Siding / Envelope', 'Windows',
  'HVAC', 'Plumbing', 'Kitchens', 'Baths', 'Flooring', 'Paint', 'Punch',
];

export function buildSeed(): Record<TableName, Row[]> {
  n = 0; s = 42;
  const db: Record<TableName, Row[]> = {
    projects: [], vendors: [], budget_lines: [], buyout_packages: [], commitments: [],
    change_orders: [], material_buys: [], invoices: [], progress: [], scope_gaps: [], specs: [], scopes: [], project_vendors: [], sdr_people: [],
  };

  const P1 = uid(), P2 = uid();
  db.projects.push(
    { id: P1, code: 'DEMO-160', name: 'Maple Court Apartments (sample)', address: '100 Sample Way, Raleigh NC',
      client: 'Sample Owner LLC', contract_value: 14_850_000, start_date: day(-70), target_completion: day(220), status: 'active' },
    { id: P2, code: 'DEMO-048', name: 'Oak Terrace Townhomes (sample)', address: '48 Example Rd, Durham NC',
      client: 'Example Housing Partners', contract_value: 3_200_000, start_date: day(30), target_completion: day(300), status: 'precon' },
  );

  const V = (name: string, trade: string, coiDays: number) => {
    const id = uid();
    db.vendors.push({ id, name, trade, contact_name: '', email: '', phone: '', coi_expires: day(coiDays) });
    return id;
  };
  const vAbate = V('Clearway Environmental', 'Abatement', 120);
  const vElec = V('Piedmont Electric Co.', 'Electrical', 18);
  const vRoof = V('Summit Roofing', 'Roofing', 200);
  const vSiding = V('Tarheel Exteriors', 'Siding / Envelope', 90);
  const vHvac = V('Coastal Mechanical', 'HVAC', 260);
  const vPlumb = V('Triangle Plumbing', 'Plumbing', 25);
  const vFloor = V('Carolina Floors', 'Flooring', 310);
  const vPaint = V('Brightline Painting', 'Paint', 150);
  const vCab = V('Builders Cabinet Supply', 'Cabinets (supplier)', 365);
  const vWin = V('Clearview Window Supply', 'Windows (supplier)', 365);
  const vLumber = V('84 Yard Supply', 'Lumber / general (supplier)', 365);
  const vAppl = V('ApplianceDirect Pro', 'Appliances (supplier)', 365);

  type L = { code: string; div: string; desc: string; budget: number; vendor?: string; award?: number; status?: string; kind?: 'sub' | 'mat' };
  const lines: L[] = [
    { code: '01-0000', div: 'General Conditions', desc: 'General conditions & supervision', budget: 1_150_000 },
    { code: '02-8200', div: 'Existing Conditions', desc: 'Asbestos abatement', budget: 690_000, vendor: vAbate, award: 662_500, status: 'contracted' },
    { code: '07-3100', div: 'Thermal & Moisture', desc: 'Roofing replacement', budget: 1_480_000, vendor: vRoof, award: 1_512_000, status: 'contracted' },
    { code: '07-4600', div: 'Thermal & Moisture', desc: 'Siding & envelope', budget: 1_720_000, vendor: vSiding, award: 1_655_000, status: 'contracted' },
    { code: '08-5000', div: 'Openings', desc: 'Windows (material)', budget: 980_000, vendor: vWin, kind: 'mat' },
    { code: '09-6500', div: 'Finishes', desc: 'Flooring (LVP)', budget: 820_000, vendor: vFloor, status: 'leveling' },
    { code: '09-9000', div: 'Finishes', desc: 'Interior paint', budget: 610_000, vendor: vPaint, status: 'bidding' },
    { code: '11-3100', div: 'Equipment', desc: 'Appliance packages', budget: 760_000, vendor: vAppl, kind: 'mat' },
    { code: '12-3500', div: 'Furnishings', desc: 'Kitchen cabinets & tops', budget: 1_240_000, vendor: vCab, kind: 'mat' },
    { code: '22-0000', div: 'Plumbing', desc: 'Plumbing — kitchens & baths', budget: 1_050_000, vendor: vPlumb, award: 1_096_000, status: 'awarded' },
    { code: '23-0000', div: 'HVAC', desc: 'HVAC system replacement', budget: 1_560_000, vendor: vHvac, award: 1_498_000, status: 'contracted' },
    { code: '26-0500', div: 'Electrical', desc: 'Aluminum wiring remediation', budget: 1_120_000, vendor: vElec, award: 1_138_000, status: 'contracted' },
    { code: '06-1000', div: 'Carpentry', desc: 'Rough carpentry & lumber', budget: 420_000, vendor: vLumber, kind: 'mat' },
    { code: '01-9000', div: 'Contingency', desc: 'Owner/GC contingency', budget: 650_000 },
  ];

  let sc = 0, po = 0;
  const lineIds: Record<string, string> = {};
  const commitIds: Record<string, string> = {};
  for (const l of lines) {
    const id = uid(); lineIds[l.code] = id;
    db.budget_lines.push({ id, project_id: P1, cost_code: l.code, division: l.div, description: l.desc, original_budget: l.budget });

    if (l.kind === 'mat' || !l.vendor) continue;
    const pkg = uid();
    const awarded = l.status === 'awarded' || l.status === 'contracted';
    db.buyout_packages.push({
      id: pkg, project_id: P1, budget_line_id: id, package: l.desc, budget_amount: l.budget,
      bid_due: day(l.status === 'bidding' ? 6 : -40), target_award: day(l.status === 'bidding' ? 14 : l.status === 'leveling' ? -3 : -30),
      status: l.status ?? 'not_started', bids_received: l.status === 'bidding' ? 1 : 3,
      awarded_vendor_id: awarded ? l.vendor : null, awarded_amount: awarded ? l.award : null, notes: '',
    });
    if (l.status === 'contracted' || l.status === 'awarded') {
      const cid = uid(); commitIds[l.code] = cid;
      db.commitments.push({
        id: cid, project_id: P1, kind: 'subcontract', number: `SC-${String(++sc).padStart(3, '0')}`,
        vendor_id: l.vendor, budget_line_id: id, buyout_package_id: pkg, description: l.desc, amount: l.award,
        retainage_pct: 10, status: l.status === 'contracted' ? 'executed' : 'out_for_signature',
        executed_date: l.status === 'contracted' ? day(-35) : null, coi_received: l.status === 'contracted',
      });
    }
  }

  // Unbought package with no award yet on general conditions isn't needed; add a "not started" one
  db.buyout_packages.push({
    id: uid(), project_id: P1, budget_line_id: lineIds['07-4600'], package: 'Gutters & downspouts', budget_amount: 0,
    bid_due: day(20), target_award: day(30), status: 'not_started', bids_received: 0, notes: 'Carved out of siding scope — see scope gap',
  });

  // Material buys
  const M = (code: string, vendor: string, item: string, qty: number, unit: string, cost: number, status: string, need: number) => {
    db.material_buys.push({
      id: uid(), project_id: P1, budget_line_id: lineIds[code], vendor_id: vendor, item, quantity: qty, unit, unit_cost: cost,
      po_number: status === 'quoted' ? null : `PO-${String(++po).padStart(3, '0')}`, order_date: status === 'quoted' ? null : day(-30),
      need_by: day(need), delivered_date: ['delivered', 'installed'].includes(status) ? day(need - 3) : null, status,
      location: 'Laydown yard',
    });
  };
  M('08-5000', vWin, 'Vinyl SH windows — Phase 1 (Bldgs 1–5)', 248, 'ea', 965, 'delivered', -12);
  M('08-5000', vWin, 'Vinyl SH windows — Phase 2 (Bldgs 6–10)', 252, 'ea', 965, 'shipped', 6);
  M('08-5000', vWin, 'Vinyl SH windows — Phase 3–4', 500, 'ea', 990, 'quoted', 60);
  M('12-3500', vCab, 'Kitchen cabinet sets — Phase 1', 40, 'set', 6_850, 'installed', -20);
  M('12-3500', vCab, 'Kitchen cabinet sets — Phase 2', 40, 'set', 6_850, 'ordered', 9);
  M('12-3500', vCab, 'Quartz tops — Phase 1–2', 80, 'set', 2_150, 'ordered', 12);
  M('11-3100', vAppl, 'Appliance pkg (range/fridge/DW/micro) — Ph 1', 40, 'pkg', 3_980, 'delivered', -8);
  M('11-3100', vAppl, 'Appliance pkg — Ph 2', 40, 'pkg', 3_980, 'ordered', 4);
  M('06-1000', vLumber, 'Roof sheathing & framing lumber', 1, 'lot', 96_400, 'delivered', -40);

  // Change orders
  db.change_orders.push(
    { id: uid(), project_id: P1, co_number: 'OCO-01', kind: 'owner', budget_line_id: lineIds['26-0500'], description: 'Add panel replacements Bldgs 14–16', amount: 84_000, status: 'approved', co_date: day(-15) },
    { id: uid(), project_id: P1, co_number: 'OCO-02', kind: 'owner', budget_line_id: lineIds['07-3100'], description: 'Rotten decking allowance increase', amount: 55_000, status: 'pending', co_date: day(-4) },
    { id: uid(), project_id: P1, co_number: 'SCO-01', kind: 'sub', budget_line_id: lineIds['07-3100'], commitment_id: commitIds['07-3100'], description: 'Replace rotten decking (Bldgs 1–4)', amount: 38_600, status: 'approved', co_date: day(-18) },
    { id: uid(), project_id: P1, co_number: 'SCO-02', kind: 'sub', budget_line_id: lineIds['02-8200'], commitment_id: commitIds['02-8200'], description: 'Additional ACM flooring found Bldg 7', amount: 22_400, status: 'pending', co_date: day(-2) },
  );

  // Invoices
  const I = (code: string, vendor: string, num: string, amt: number, status: string, d: number) => {
    db.invoices.push({
      id: uid(), project_id: P1, vendor_id: vendor, commitment_id: commitIds[code] ?? null, budget_line_id: lineIds[code],
      invoice_number: num, invoice_date: day(d), period_end: day(d - 2), amount: amt,
      retainage_held: commitIds[code] ? Math.round(amt * 0.1) : 0, status, paid_date: status === 'paid' ? day(d + 20) : null,
    });
  };
  I('02-8200', vAbate, 'CE-1041', 198_000, 'paid', -45);
  I('02-8200', vAbate, 'CE-1077', 176_500, 'approved', -14);
  I('07-3100', vRoof, 'SR-2208', 312_000, 'paid', -30);
  I('07-3100', vRoof, 'SR-2231', 288_400, 'received', -9);
  I('26-0500', vElec, 'PE-553', 241_000, 'approved', -16);
  I('26-0500', vElec, 'PE-571', 96_000, 'disputed', -6);
  I('23-0000', vHvac, 'CM-9001', 210_000, 'received', -11);
  I('07-4600', vSiding, 'TE-310', 165_500, 'paid', -28);
  I('08-5000', vWin, 'CW-77812', 239_320, 'paid', -25);
  I('12-3500', vCab, 'BCS-4410', 274_000, 'approved', -18);
  I('11-3100', vAppl, 'AD-5530', 159_200, 'received', -5);
  I('06-1000', vLumber, '84-99102', 96_400, 'paid', -38);

  // Progress: 20 buildings x activities, sequenced so early buildings are further along
  for (let b = 1; b <= 20; b++) {
    ACTIVITIES.forEach((act, ai) => {
      const lead = 100 - (b - 1) * 9 - ai * 8 + rnd() * 18;
      const pct = Math.max(0, Math.min(100, Math.round(lead / 5) * 5));
      const blocked = (b === 7 && act === 'Abatement') || (b === 3 && act === 'Electrical (Al wiring)');
      db.progress.push({
        id: uid(), project_id: P1, building: `Bldg ${String(b).padStart(2, '0')}`, unit: null, activity: act,
        pct_complete: blocked ? Math.min(pct, 40) : pct,
        status: blocked ? 'blocked' : pct >= 100 ? 'complete' : pct > 0 ? 'in_progress' : 'not_started',
        updated_by: 'Site super', notes: blocked ? (b === 7 ? 'Additional ACM found under VCT — awaiting SCO-02' : 'Panel backorder') : '',
      });
    });
  }

  // Scope gaps
  const G = (title: string, a: string, b: string, code: string, cost: number, status: string, owner: string, desc: string) =>
    db.scope_gaps.push({ id: uid(), project_id: P1, title, trade_a: a, trade_b: b, budget_line_id: lineIds[code], est_cost: cost, status, owner, raised_date: day(-Math.round(rnd() * 30)), description: desc, resolution: '' });
  G('Gutters & downspouts not in roofing or siding', 'Roofing', 'Siding / Envelope', '07-4600', 46_000, 'open', 'PM', 'Roofing excludes gutters; siding scope silent. Needs its own package.');
  G('Drywall patch after Al wiring remediation', 'Electrical', 'Paint', '26-0500', 58_000, 'assigned', 'APM', 'Electrician cuts access holes; paint scope assumes ready-to-paint walls.');
  G('Disposal of old appliances', 'Appliances', 'General Conditions', '01-0000', 9_600, 'priced', 'Super', '160 units × haul-off.');
  G('Window sill / interior trim replacement', 'Windows', 'Carpentry', '06-1000', 31_000, 'open', 'PM', 'Window supply is material only; install sub excludes interior trim.');
  G('Condensate line routing for new HVAC', 'HVAC', 'Plumbing', '23-0000', 12_500, 'resolved', 'APM', 'Resolved: HVAC sub carries per RFI-012.');

  // Specs
  const S = (section: string, title: string, product: string, mfr: string, status: string) =>
    db.specs.push({ id: uid(), project_id: P1, section, title, product, manufacturer: mfr, revision: '0', status, doc_url: '' });
  S('02 82 13', 'Asbestos Abatement', '—', '—', 'approved');
  S('07 31 13', 'Asphalt Shingles', 'Architectural shingle, 30-yr', 'GAF / equal', 'approved');
  S('07 46 46', 'Fiber-Cement Siding', 'Lap siding 7" exposure', 'James Hardie / equal', 'approved');
  S('08 53 13', 'Vinyl Windows', 'Single-hung, Low-E, U≤0.30', 'Basis of design TBD', 'issued');
  S('09 65 19', 'Resilient Tile Flooring (LVP)', '20 mil wear layer, click-lock', 'TBD', 'draft');
  S('09 91 23', 'Interior Painting', 'Eggshell walls / semi-gloss trim', 'Sherwin-Williams / equal', 'issued');
  S('12 35 30', 'Residential Casework', 'Shaker, soft-close', 'TBD', 'approved');
  S('23 81 26', 'Split-System Air Conditioners', '15.2 SEER2 heat pump', 'Carrier / equal', 'approved');
  S('26 05 19', 'Low-Voltage Wire & Cable', 'Cu branch circuits, COPALUM where retained', '—', 'approved');

  // Scopes
  const SW = (code: string, trade: string, inc: string, exc: string) =>
    db.scopes.push({ id: uid(), project_id: P1, trade, commitment_id: commitIds[code] ?? null, inclusions: inc, exclusions: exc, clarifications: '', revision: '1', doc_url: '' });
  SW('07-3100', 'Roofing', 'Tear-off, decking repair allowance (2 sheets/bldg), underlayment, shingles, ridge vent, flashing', 'Gutters & downspouts; fascia replacement');
  SW('26-0500', 'Electrical', 'Pigtail/COPALUM all Al branch terminations, device replacement, panel swaps per schedule', 'Drywall patch & paint; fire alarm');
  SW('23-0000', 'HVAC', 'Remove existing, new heat pump + air handler per unit, line sets, condensate to nearest drain', 'Electrical disconnect upgrades');
  SW('02-8200', 'Abatement', 'ACM flooring & mastic, drywall joint compound per survey, air monitoring', 'Unforeseen ACM beyond survey (unit-price)');

  return db;
}
