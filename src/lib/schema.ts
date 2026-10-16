// Single source of truth for every table the UI knows about.
// Adding a column = add it to the SQL migration + one line here.

export type TableName =
  | 'projects' | 'vendors' | 'budget_lines' | 'buyout_packages' | 'commitments'
  | 'change_orders' | 'material_buys' | 'invoices' | 'progress' | 'scope_gaps'
  | 'specs' | 'scopes' | 'project_vendors' | 'sdr_people';

export type Row = { id: string; [k: string]: any };

export type FieldType =
  | 'text' | 'textarea' | 'number' | 'money' | 'percent' | 'date' | 'select' | 'ref' | 'bool' | 'url' | 'email' | 'phone';

export interface Field {
  key: string;
  label: string;
  type: FieldType;
  options?: string[];
  ref?: TableName;
  required?: boolean;
  table?: boolean;      // show as a table column (default true)
  total?: boolean;      // sum in the table footer
  computed?: (r: Row) => any;  // read-only derived column
  showIf?: (r: Partial<Row>) => boolean;  // only show in the form when this is true
  section?: string;     // heading shown above this field in the form
  optionLabels?: Record<string, string>;  // display names for select options
}

export interface Entity {
  table: TableName;
  label: string;
  singular: string;
  projectScoped: boolean;
  statusKey?: string;
  /** text fields offered as dropdown filters; with split, "Roofing / siding" counts under each part */
  filters?: { key: string; label: string; split?: boolean }[];
  fields: Field[];
}

const STATUS = {
  project: ['precon', 'active', 'closeout', 'complete', 'on_hold'],
  buyout: ['not_started', 'bidding', 'leveling', 'awarded', 'contracted'],
  commitment: ['draft', 'out_for_signature', 'executed', 'closed'],
  co: ['pending', 'approved', 'rejected'],
  material: ['quoted', 'ordered', 'shipped', 'delivered', 'installed'],
  invoice: ['received', 'approved', 'paid', 'disputed'],
  progress: ['not_started', 'in_progress', 'complete', 'blocked'],
  gap: ['open', 'assigned', 'priced', 'resolved'],
  spec: ['draft', 'issued', 'approved', 'superseded'],
};
export const STATUS_OPTIONS = STATUS;

// ---------- job classification ----------
export const JOB_TYPES = ['renovation', 'loss', 'gc'] as const;
export type JobType = (typeof JOB_TYPES)[number];
export const JOB_TYPE_LABEL: Record<string, string> = { renovation: 'Renovation', loss: 'Water/Fire Loss', gc: 'GC' };
export const jobType = (p?: Partial<Row> | null): JobType => (JOB_TYPES as readonly string[]).includes(p?.job_type) ? p!.job_type : 'renovation';
const isLoss = (r: Partial<Row>) => jobType(r) === 'loss';
const isGc = (r: Partial<Row>) => jobType(r) === 'gc';
const notLoss = (r: Partial<Row>) => jobType(r) !== 'loss';

export const ENTITIES: Record<TableName, Entity> = {
  projects: {
    table: 'projects', label: 'Projects', singular: 'Project', projectScoped: false, statusKey: 'status',
    fields: [
      { key: 'job_type', label: 'Job type', type: 'select', options: [...JOB_TYPES], optionLabels: JOB_TYPE_LABEL, required: true },
      { key: 'code', label: 'Job #', type: 'text' },
      { key: 'name', label: 'Name', type: 'text', required: true },
      { key: 'address', label: 'Address', type: 'text' },
      { key: 'client', label: 'Client', type: 'text' },
      { key: 'billed_to', label: 'Billed to', type: 'text', table: false },
      { key: 'contract_value', label: 'Contract value', type: 'money', showIf: notLoss },
      { key: 'start_date', label: 'Start', type: 'date' },
      { key: 'target_completion', label: 'Target completion', type: 'date' },
      { key: 'status', label: 'Status', type: 'select', options: STATUS.project },
      // Water / fire loss
      { key: 'loss_type', label: 'Loss type', type: 'select', options: ['water', 'fire', 'mold', 'storm', 'other'], showIf: isLoss, section: 'Water / fire loss', table: false },
      { key: 'loss_date', label: 'Date of loss', type: 'date', showIf: isLoss, table: false },
      { key: 'claim_number', label: 'Claim #', type: 'text', showIf: isLoss, table: false },
      { key: 'carrier', label: 'Carrier / adjuster', type: 'text', showIf: isLoss, table: false },
      { key: 'xactimate_amount', label: 'Xactimate amount', type: 'money', showIf: isLoss, table: false },
      { key: 'ems_amount', label: 'EMS amount', type: 'money', showIf: isLoss, table: false },
      { key: 'rebuild_amount', label: 'Rebuild amount', type: 'money', showIf: isLoss, table: false },
      { key: 'encircle_url', label: 'Encircle link', type: 'url', showIf: isLoss, table: false },
      // GC
      { key: 'invoice_amount', label: 'Invoice amount', type: 'money', showIf: isGc, section: 'GC job', table: false },
      { key: 'po_number', label: 'PO / work order #', type: 'text', showIf: isGc, table: false },
      { key: 'invoiced_date', label: 'Invoiced on', type: 'date', showIf: isGc, table: false },
      { key: 'scope_description', label: 'Scope description', type: 'textarea', showIf: isGc, table: false },
    ],
  },
  vendors: {
    table: 'vendors', label: 'Vendors & Subs', singular: 'Vendor', projectScoped: false, filters: [{ key: 'trade', label: 'trades', split: true }, { key: 'state', label: 'states' }],
    fields: [
      { key: 'name', label: 'Name', type: 'text', required: true },
      { key: 'trade', label: 'Trade', type: 'text' },
      { key: 'contact_name', label: 'Contact', type: 'text' },
      { key: 'email', label: 'Email', type: 'email' },
      { key: 'phone', label: 'Phone', type: 'text' },
      { key: 'city', label: 'City', type: 'text' },
      { key: 'state', label: 'State', type: 'text' },
      { key: 'service_area', label: 'Service area', type: 'text' },
      { key: 'address', label: 'Address', type: 'text', table: false },
      { key: 'coi_expires', label: 'COI expires', type: 'date' },
      { key: 'license_no', label: 'License #', type: 'text', table: false },
    ],
  },
  budget_lines: {
    table: 'budget_lines', label: 'Budget', singular: 'Budget line', projectScoped: true,
    fields: [
      { key: 'cost_code', label: 'Cost code', type: 'text', required: true },
      { key: 'division', label: 'Division', type: 'text' },
      { key: 'description', label: 'Description', type: 'text', required: true },
      { key: 'original_budget', label: 'Original budget', type: 'money', total: true },
      { key: 'notes', label: 'Notes', type: 'textarea', table: false },
    ],
  },
  buyout_packages: {
    table: 'buyout_packages', label: 'Buyout', singular: 'Buyout package', projectScoped: true, statusKey: 'status',
    fields: [
      { key: 'package', label: 'Package', type: 'text', required: true },
      { key: 'budget_line_id', label: 'Cost code', type: 'ref', ref: 'budget_lines' },
      { key: 'budget_amount', label: 'Budget', type: 'money', total: true },
      { key: 'bid_due', label: 'Bids due', type: 'date' },
      { key: 'target_award', label: 'Target award', type: 'date' },
      { key: 'bids_received', label: '# Bids', type: 'number' },
      { key: 'status', label: 'Status', type: 'select', options: STATUS.buyout },
      { key: 'awarded_vendor_id', label: 'Awarded to', type: 'ref', ref: 'vendors' },
      { key: 'awarded_amount', label: 'Awarded $', type: 'money', total: true },
      { key: '_buyout_var', label: 'Buyout +/-', type: 'money', total: true,
        computed: (r) => (r.awarded_amount == null ? null : Number(r.budget_amount || 0) - Number(r.awarded_amount)) },
      { key: 'notes', label: 'Notes', type: 'textarea', table: false },
    ],
  },
  commitments: {
    table: 'commitments', label: 'Subcontracts & POs', singular: 'Commitment', projectScoped: true, statusKey: 'status',
    fields: [
      { key: 'number', label: 'No.', type: 'text' },
      { key: 'kind', label: 'Type', type: 'select', options: ['subcontract', 'po'] },
      { key: 'vendor_id', label: 'Vendor', type: 'ref', ref: 'vendors' },
      { key: 'description', label: 'Description', type: 'text' },
      { key: 'budget_line_id', label: 'Cost code', type: 'ref', ref: 'budget_lines' },
      { key: 'buyout_package_id', label: 'Buyout package', type: 'ref', ref: 'buyout_packages', table: false },
      { key: 'amount', label: 'Amount', type: 'money', total: true },
      { key: 'retainage_pct', label: 'Ret. %', type: 'percent' },
      { key: 'status', label: 'Status', type: 'select', options: STATUS.commitment },
      { key: 'executed_date', label: 'Executed', type: 'date' },
      { key: 'coi_received', label: 'COI', type: 'bool' },
      { key: 'scope_doc_url', label: 'Contract doc', type: 'url', table: false },
    ],
  },
  change_orders: {
    table: 'change_orders', label: 'Change Orders', singular: 'Change order', projectScoped: true, statusKey: 'status',
    fields: [
      { key: 'co_number', label: 'CO #', type: 'text' },
      { key: 'kind', label: 'Owner / Sub', type: 'select', options: ['owner', 'sub'], required: true },
      { key: 'description', label: 'Description', type: 'text' },
      { key: 'budget_line_id', label: 'Cost code', type: 'ref', ref: 'budget_lines' },
      { key: 'commitment_id', label: 'Commitment', type: 'ref', ref: 'commitments' },
      { key: 'amount', label: 'Amount', type: 'money', total: true },
      { key: 'status', label: 'Status', type: 'select', options: STATUS.co },
      { key: 'co_date', label: 'Date', type: 'date' },
    ],
  },
  material_buys: {
    table: 'material_buys', label: 'Material Buys', singular: 'Material buy', projectScoped: true, statusKey: 'status',
    fields: [
      { key: 'item', label: 'Item', type: 'text', required: true },
      { key: 'vendor_id', label: 'Supplier', type: 'ref', ref: 'vendors' },
      { key: 'budget_line_id', label: 'Cost code', type: 'ref', ref: 'budget_lines' },
      { key: 'quantity', label: 'Qty', type: 'number' },
      { key: 'unit', label: 'Unit', type: 'text' },
      { key: 'unit_cost', label: 'Unit $', type: 'money' },
      { key: '_ext', label: 'Extended', type: 'money', total: true,
        computed: (r) => Number(r.quantity || 0) * Number(r.unit_cost || 0) },
      { key: 'po_number', label: 'PO #', type: 'text' },
      { key: 'order_date', label: 'Ordered', type: 'date', table: false },
      { key: 'need_by', label: 'Need by', type: 'date' },
      { key: 'delivered_date', label: 'Delivered', type: 'date' },
      { key: 'status', label: 'Status', type: 'select', options: STATUS.material },
      { key: 'location', label: 'Staged at', type: 'text', table: false },
    ],
  },
  invoices: {
    table: 'invoices', label: 'Invoices', singular: 'Invoice', projectScoped: true, statusKey: 'status',
    fields: [
      { key: 'invoice_number', label: 'Invoice #', type: 'text' },
      { key: 'vendor_id', label: 'Vendor', type: 'ref', ref: 'vendors' },
      { key: 'commitment_id', label: 'Against', type: 'ref', ref: 'commitments' },
      { key: 'budget_line_id', label: 'Cost code', type: 'ref', ref: 'budget_lines' },
      { key: 'invoice_date', label: 'Date', type: 'date' },
      { key: 'period_end', label: 'Period end', type: 'date', table: false },
      { key: 'amount', label: 'Amount', type: 'money', total: true },
      { key: 'retainage_held', label: 'Retainage', type: 'money', total: true },
      { key: 'status', label: 'Status', type: 'select', options: STATUS.invoice },
      { key: 'paid_date', label: 'Paid', type: 'date' },
      { key: 'file_url', label: 'File', type: 'url', table: false },
    ],
  },
  progress: {
    table: 'progress', label: 'Onsite Progress', singular: 'Progress item', projectScoped: true, statusKey: 'status',
    fields: [
      { key: 'building', label: 'Building', type: 'text', required: true },
      { key: 'unit', label: 'Unit', type: 'text' },
      { key: 'activity', label: 'Activity', type: 'text', required: true },
      { key: 'pct_complete', label: '% complete', type: 'percent' },
      { key: 'status', label: 'Status', type: 'select', options: STATUS.progress },
      { key: 'updated_by', label: 'Updated by', type: 'text' },
      { key: 'notes', label: 'Notes', type: 'textarea' },
    ],
  },
  scope_gaps: {
    table: 'scope_gaps', label: 'Scope Gaps', singular: 'Scope gap', projectScoped: true, statusKey: 'status',
    fields: [
      { key: 'title', label: 'Gap', type: 'text', required: true },
      { key: 'trade_a', label: 'Between', type: 'text' },
      { key: 'trade_b', label: 'And', type: 'text' },
      { key: 'budget_line_id', label: 'Cost code', type: 'ref', ref: 'budget_lines' },
      { key: 'est_cost', label: 'Est. cost', type: 'money', total: true },
      { key: 'status', label: 'Status', type: 'select', options: STATUS.gap },
      { key: 'owner', label: 'Owner', type: 'text' },
      { key: 'raised_date', label: 'Raised', type: 'date' },
      { key: 'description', label: 'Description', type: 'textarea', table: false },
      { key: 'resolution', label: 'Resolution', type: 'textarea', table: false },
    ],
  },
  specs: {
    table: 'specs', label: 'Specs', singular: 'Spec section', projectScoped: true, statusKey: 'status',
    fields: [
      { key: 'section', label: 'Section', type: 'text', required: true },
      { key: 'title', label: 'Title', type: 'text', required: true },
      { key: 'product', label: 'Basis of design', type: 'text' },
      { key: 'manufacturer', label: 'Manufacturer', type: 'text' },
      { key: 'revision', label: 'Rev', type: 'text' },
      { key: 'status', label: 'Status', type: 'select', options: STATUS.spec },
      { key: 'doc_url', label: 'Document', type: 'url' },
    ],
  },
  scopes: {
    table: 'scopes', label: 'Scopes of Work', singular: 'Scope', projectScoped: true,
    fields: [
      { key: 'trade', label: 'Trade', type: 'text', required: true },
      { key: 'commitment_id', label: 'Subcontract', type: 'ref', ref: 'commitments' },
      { key: 'revision', label: 'Rev', type: 'text' },
      { key: 'inclusions', label: 'Inclusions', type: 'textarea' },
      { key: 'exclusions', label: 'Exclusions', type: 'textarea' },
      { key: 'clarifications', label: 'Clarifications', type: 'textarea', table: false },
      { key: 'doc_url', label: 'Document', type: 'url', table: false },
    ],
  },
  sdr_people: {
    table: 'sdr_people', label: 'SDR Directory', singular: 'Person', projectScoped: false,
    filters: [{ key: 'department', label: 'departments' }, { key: 'location', label: 'offices' }],
    fields: [
      { key: 'name', label: 'Name', type: 'text', required: true },
      { key: 'title', label: 'Title', type: 'text' },
      { key: 'department', label: 'Department', type: 'text' },
      { key: 'email', label: 'Email', type: 'email' },
      { key: 'mobile', label: 'Mobile', type: 'phone' },
      { key: 'office_phone', label: 'Office', type: 'phone' },
      { key: 'location', label: 'Office location', type: 'text' },
      { key: 'kind', label: 'Type', type: 'select', options: ['person', 'shared'], optionLabels: { person: 'Person', shared: 'Shared mailbox' }, table: false },
      { key: 'active', label: 'Active', type: 'bool', table: false },
      { key: 'notes', label: 'Notes', type: 'textarea', table: false },
    ],
  },
  project_vendors: {
    table: 'project_vendors', label: 'Vendors on this job', singular: 'Vendor assignment', projectScoped: true,
    fields: [
      { key: 'vendor_id', label: 'Vendor', type: 'ref', ref: 'vendors', required: true },
      { key: 'role', label: 'Role / scope on this job', type: 'text' },
      { key: 'amount', label: 'Amount', type: 'money', total: true },
      { key: 'notes', label: 'Notes', type: 'textarea', table: false },
    ],
  },
};

export const ALL_TABLES = Object.keys(ENTITIES) as TableName[];

/** How a referenced row is displayed in dropdowns and table cells. */
export function refLabel(table: TableName, r: Row | undefined): string {
  if (!r) return '';
  switch (table) {
    case 'vendors': return r.name;
    case 'budget_lines': return `${r.cost_code} · ${r.description}`;
    case 'commitments': return `${r.number ?? ''} ${r.description ?? ''}`.trim();
    case 'buyout_packages': return r.package;
    case 'projects': return r.name;
    default: return r.title ?? r.name ?? r.id;
  }
}
