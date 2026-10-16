// SDR client invoice PDF, built in the browser. A line-for-line port of the sdr-invoice-builder skill's
// scripts/build_invoice.py (which reproduces SDR's Excel invoice template, ref. 25-375 Arden Summit):
// same logo, fonts (Liberation Sans = Arial metrics, Archivo Black for the INVOICE title) and positions,
// measured in points from the top of a Letter page.
import { PDFDocument, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';

export type InvoiceLine = { desc: string; amount?: number | null };
export type InvoiceSpec = {
  date: string;            // "September 30, 2026"
  invoice_no: string;      // "93026-26354"
  bill_to: string;
  attn: string;
  for_text: string;        // FOR box; wraps to 3 lines
  lines: InvoiceLine[];    // one paragraph each; **bold** runs allowed; amount optional
  notes: string[];         // italic, indented, under the last item
  kind?: 'invoice' | 'proposal';   // proposal: same template, titled PROPOSAL, with validity + acceptance lines
  valid_days?: number;     // proposal only (default 30)
};

const W = 612, H = 792;
const FS = 9.34;
const HDR_GRAY = rgb(0.949, 0.949, 0.949);
const AMT_GRAY = rgb(0.9176, 0.9176, 0.9176);
const BLACK = rgb(0, 0, 0);
const X0 = 39.72;
const TL = 38.4, TR = 525.7, TD = 424.1;
const DESC_WRAP = 335;
const BODY_LINE = 11.6;          // single-spaced lines inside a line item, as typed in the form
const ITEM_GAP = 7;              // small gap between line items
export const DESC_LIMIT = 527;   // last body line must sit above the Equipment row
/** wrap width of the description column, exported so the form's text box can wrap identically */
export const DESC_WRAP_PT = 335;
export const BODY_FONT_PT = 9.34;

const Y = (top: number) => H - top;
export const money = (v: number) => v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

type Fonts = { R: PDFFont; B: PDFFont; I: PDFFont; BI: PDFFont; HV: PDFFont };
let assets: Promise<{ fonts: Record<keyof Fonts, ArrayBuffer>; logo: ArrayBuffer }> | null = null;
function loadAssets() {
  const base = `${import.meta.env.BASE_URL}invoice/`;
  const get = (f: string) => fetch(base + f).then((r) => { if (!r.ok) throw new Error(`Missing invoice asset ${f}`); return r.arrayBuffer(); });
  assets ??= Promise.all([
    get('LiberationSans-Regular.ttf'), get('LiberationSans-Bold.ttf'), get('LiberationSans-Italic.ttf'),
    get('LiberationSans-BoldItalic.ttf'), get('ArchivoBlack-Regular.ttf'), get('logo.jpg'),
  ]).then(([R, B, I, BI, HV, logo]) => ({ fonts: { R, B, I, BI, HV }, logo }));
  assets.catch(() => { assets = null; });
  return assets;
}

/** '**bold**' markup -> [(text, bold)] */
function runs(text: string) {
  return text.split('**').map((part, i) => [part, i % 2 === 1] as const).filter(([p]) => p);
}

function wrapRuns(text: string, width: number, f: Fonts) {
  const words: [string, boolean][] = [];
  for (const [t, b] of runs(text)) {
    if (/^\s/.test(t) && words.length && !words[words.length - 1][0].endsWith(' ')) {
      words[words.length - 1] = [words[words.length - 1][0] + ' ', words[words.length - 1][1]];
    }
    for (const w of t.match(/\S+\s*/g) ?? []) words.push([w, b]);
  }
  const lines: [string, boolean][][] = [];
  let cur: [string, boolean][] = [], cw = 0;
  const sp = f.R.widthOfTextAtSize(' ', FS);
  for (const [w, b] of words) {
    const ww = (b ? f.B : f.R).widthOfTextAtSize(w.trimEnd(), FS);
    if (cur.length && cw + ww > width) { lines.push(cur); cur = []; cw = 0; }
    cur.push([w, b]); cw += ww + (w.endsWith(' ') ? sp : 0);
  }
  if (cur.length) lines.push(cur);
  return lines;
}

function wrapPlain(text: string, font: PDFFont, width: number) {
  const out: string[] = []; let cur = '';
  for (const w of text.split(/\s+/).filter(Boolean)) {
    const t = (cur + ' ' + w).trim();
    if (font.widthOfTextAtSize(t, FS) <= width) cur = t; else { out.push(cur); cur = w; }
  }
  if (cur) out.push(cur);
  return out;
}

/** Where the description text ends (points from top); over DESC_LIMIT means it won't fit. */
export type InvoiceResult = { bytes: Uint8Array; total: number; descEnd: number };

export async function buildInvoicePdf(spec: InvoiceSpec): Promise<InvoiceResult> {
  const a = await loadAssets();
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const f: Fonts = {
    R: await doc.embedFont(a.fonts.R, { subset: true }), B: await doc.embedFont(a.fonts.B, { subset: true }),
    I: await doc.embedFont(a.fonts.I, { subset: true }), BI: await doc.embedFont(a.fonts.BI, { subset: true }),
    HV: await doc.embedFont(a.fonts.HV, { subset: true }),
  };
  const prop = spec.kind === 'proposal';
  doc.setTitle((prop ? 'Proposal ' : 'Invoice ') + (spec.invoice_no ?? ''));
  doc.setAuthor('Stone Development & Restoration, LLC');
  const p: PDFPage = doc.addPage([W, H]);
  const text = (s: string, x: number, top: number, font: PDFFont, size = FS) => s && p.drawText(s, { x, y: Y(top), size, font, color: BLACK });
  const centred = (s: string, cx: number, top: number, font: PDFFont, size = FS) => text(s, cx - font.widthOfTextAtSize(s, size) / 2, top, font, size);
  const right = (s: string, rx: number, top: number, font: PDFFont) => text(s, rx - font.widthOfTextAtSize(s, FS), top, font);
  const right2 = (s: string, rx: number, top: number, font: PDFFont, size: number) => text(s, rx - font.widthOfTextAtSize(s, size), top, font, size);
  const bar = (x0: number, x1: number, top: number, bottom: number, color = BLACK) =>
    p.drawRectangle({ x: x0, y: Y(bottom), width: x1 - x0, height: bottom - top, color, borderWidth: 0 });

  // Logo + title
  const logo = await doc.embedJpg(a.logo);
  p.drawImage(logo, { x: 39.7, y: Y(103.6), width: 259.5, height: 66.2 });
  if (prop) right2('PROPOSAL', 396.84 + f.HV.widthOfTextAtSize('INVOICE', 26.23), 90.6, f.HV, 26.23);   // same right edge as INVOICE
  else text('INVOICE', 396.84, 90.6, f.HV, 26.23);

  // Company block
  text('Stone Development & Restoration, LLC', 39.84, 112.44, f.B, 10.3);
  text('201 Marsh Field Drive', X0, 126.84, f.R);
  text('Wilmington, NC 28411', X0, 140.52, f.R);
  text('Phone (910) 686-7454', X0, 154.2, f.R);
  text('Fax (910) 686-9747', 140.67, 154.2, f.R);

  // Date / invoice #
  text('DATE:', 301.44, 140.52, f.B); text(prop ? 'PROPOSAL #' : 'INVOICE #', 301.44, 154.2, f.B);
  text(spec.date, 366.6, 140.52, f.R); text(spec.invoice_no ?? '', 366.6, 154.2, f.R);

  // Bill to
  text(prop ? 'PREPARED FOR:' : 'BILL TO:', X0, 181.56, f.B); text(spec.bill_to ?? '', X0, 195.24, f.R);
  text('ATTN:', X0, 208.92, f.B); text(spec.attn ?? '', X0, 221.76, f.R);

  // For box
  text('FOR:', 301.44, 180.12, f.B);
  wrapPlain(spec.for_text ?? '', f.R, 526.1 - 301.44 - 4).slice(0, 3).forEach((ln, i) => text(ln, 301.44, 195.24 + i * 12.5, f.R));
  bar(299.2, 300.1, 183.7, 225.7); bar(525.1, 526.1, 184.7, 225.7);
  bar(300.1, 526.1, 183.7, 184.7); bar(300.1, 526.1, 224.8, 225.7);

  // Table fills + rules
  bar(TL, TR, 252.6, 271.0, HDR_GRAY);
  bar(TD, TR, 270.8, 617.5, AMT_GRAY);
  bar(37.4, 38.4, 252.1, 599.6);       // left
  bar(525.1, 526.1, 253.1, 617.9);     // right
  bar(423.6, 424.6, 253.1, 617.9);     // divider
  bar(38.4, 526.1, 252.1, 253.1);      // top
  bar(38.4, 526.1, 270.4, 271.3);      // under header
  bar(38.4, 526.1, 598.7, 599.6);      // bottom
  bar(424.6, 526.1, 616.9, 617.9);     // under total

  centred('DESCRIPTION', (TL + TD) / 2 + 0.2, 264.72, f.B);
  centred('AMOUNT', (TD + TR) / 2 + 0.5, 265.2, f.B);
  centred('Labor and Materials as Outlined Below', (TL + TD) / 2 - 0.7, 282.96, f.BI);

  const amt = (top: number, v: number) => { text('$', 429.24, top, f.R); right(money(v), 520.72, top, f.R); };

  // Description body: each line item exactly as typed (its own line breaks kept, blank lines kept),
  // wrapped at the column width, single-spaced, with a small gap between items.
  let base = 304;
  let last = 0;                                   // baseline of the last line drawn
  const lines = spec.lines.filter((l) => l.desc.trim() || l.amount != null);
  lines.forEach((item, k) => {
    if (k > 0) base += ITEM_GAP;
    const paras = (item.desc || ' ').replace(/\r/g, '').replace(/\s+$/, '').split('\n');
    let first = true;
    for (const para of paras) {
      const wrapped = para.trim() ? wrapRuns(para, DESC_WRAP, f) : [[]];   // empty line -> blank line
      for (const ln of wrapped) {
        if (base <= DESC_LIMIT) {
          let x = X0;
          for (const [w, b] of ln) { const font = b ? f.B : f.R; text(w, x, base, font); x += font.widthOfTextAtSize(w, FS); }
          if (first && item.amount != null && Number.isFinite(item.amount)) amt(base, item.amount);
        }
        first = false; last = base; base += BODY_LINE;
      }
    }
  });
  const notes = spec.notes.filter((x) => x.trim());
  if (notes.length && lines.length) base += BODY_LINE;   // one blank line before the note
  for (const n of notes) {
    if (base <= DESC_LIMIT) text(n, 52.93, base, f.I);
    last = base; base += BODY_LINE;
  }

  ['Equipment', 'Supervision', 'Protection'].forEach((t, i) => text(t, X0, 541.8 + i * 18.24, f.R));

  // Total = sum of line amounts, rounded to the cent
  const total = Math.round(lines.reduce((s, l) => s + (Number(l.amount) || 0), 0) * 100) / 100;
  text('TOTAL', 386.28, 611.76, f.B);
  amt(611.64, total);

  // Footer
  if (prop) {
    const days = spec.valid_days && spec.valid_days > 0 ? Math.round(spec.valid_days) : 30;
    text(`This proposal is valid for ${days} days from the date above. To accept, sign below and return a copy to `, X0, 649.56, f.R);
    text('Stone Development & Restoration LLC.', X0, 662.4, f.B);
    text('Accepted by:', X0, 694.0, f.B); bar(100, 300, 694.6, 695.4);
    text('Date:', 318, 694.0, f.B); bar(345, 450, 694.6, 695.4);
    text('Printed name / title:', X0, 716.0, f.B); bar(135, 300, 716.6, 717.4);
    centred('THANK YOU FOR THE OPPORTUNITY!', 282.25, 748.0, f.B, 9.36);
  } else {
    const s1 = 'Please make checks payable to ', s2 = 'Stone Development & Restoration LLC';
    text(s1, X0, 649.56, f.R);
    let x = X0 + f.R.widthOfTextAtSize(s1, FS);
    text(s2, x, 649.56, f.B); x += f.B.widthOfTextAtSize(s2, FS);
    text('*', x, 649.56, f.R);
    centred('THANK YOU FOR YOUR BUSINESS!', 282.25, 698.89, f.B, 9.36);
  }

  return { bytes: await doc.save(), total, descEnd: last };
}

/** "September 30, 2026" */
export const longDate = (d: Date) => d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
/** MDDYY-<job> with the job's dash removed for yy-nnn numbers (9/24/26 + 26-331 -> 92426-26331; + D6671 -> 92426-D6671) */
export function invoiceNumber(d: Date, job?: string | null) {
  const mdyy = `${d.getMonth() + 1}${String(d.getDate()).padStart(2, '0')}${String(d.getFullYear()).slice(-2)}`;
  const j = String(job ?? '').replace(/^#/, '').trim();
  return j ? `${mdyy}-${/^\d{2}-\d+/.test(j) ? j.replace('-', '') : j}` : mdyy;
}
