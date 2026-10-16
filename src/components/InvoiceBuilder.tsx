import { useEffect, useMemo, useRef, useState } from 'react';
import type { Row } from '../lib/schema';
import { useStore } from '../lib/store';
import { buildInvoicePdf, DESC_LIMIT, invoiceNumber, longDate, money, type InvoiceLine } from '../lib/invoicePdf';
import { uploadFile } from '../lib/files';
import { useFilesClient } from './Attachments';

const CLIENTS = ['Related', 'Venture', 'Grubb', 'PK Management'];
const NOTE_PRESETS = [
  'See attached EMS Billing Report, and Final Completion Report for details',
  'See attached EMS billing report, Xactimate, and completion report for details',
  'See attached EMS Billing Report for details',
];
const isoToday = () => new Date().toLocaleDateString('en-CA');
const fromIso = (d: string) => new Date(d + 'T12:00');

/** SDR client invoice: fill in the fields, see the PDF update live, download it or save it to the job's Files. */
export function InvoiceBuilder({ project, onClose }: { project?: Row; onClose: () => void }) {
  const { save } = useStore();
  const client = useFilesClient();
  const job = project?.code ?? '';
  const [date, setDate] = useState(isoToday());
  const [invNo, setInvNo] = useState(invoiceNumber(fromIso(isoToday()), job));
  const [invTouched, setInvTouched] = useState(false);
  // invoice BILL TO line = the job's Client; ATTN line = the job's Bill To (Trello "Invoice To")
  const [billTo, setBillTo] = useState<string>(project?.client || '');
  const [attn, setAttn] = useState<string>(project?.billed_to || '');
  const [forText, setForText] = useState(project ? `${job ? `#${job} ` : ''}${project.name ?? ''}`.trim() : '');
  const [lines, setLines] = useState<{ desc: string; amount: string }[]>([{ desc: '', amount: '' }]);
  const [note, setNote] = useState(NOTE_PRESETS[0]);
  const [url, setUrl] = useState<string | null>(null);
  const [pdf, setPdf] = useState<{ bytes: Uint8Array; total: number; descEnd: number } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const urlRef = useRef<string | null>(null);

  useEffect(() => { if (!invTouched) setInvNo(invoiceNumber(fromIso(date), job)); }, [date, job, invTouched]);
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);

  const parsed: InvoiceLine[] = useMemo(() => lines.map((l) => {
    const n = l.amount.trim() === '' ? null : Number(l.amount.replace(/[$,\s]/g, ''));
    return { desc: l.desc.trim(), amount: n != null && Number.isFinite(n) ? n : null };
  }), [lines]);
  const total = Math.round(parsed.reduce((s, l) => s + (l.amount ?? 0), 0) * 100) / 100;
  const badAmount = lines.some((l, i) => l.amount.trim() !== '' && parsed[i].amount == null);
  const spec = useMemo(() => ({
    date: longDate(fromIso(date)), invoice_no: invNo.trim(), bill_to: billTo.trim(), attn: attn.trim(), for_text: forText.trim(),
    lines: parsed, notes: note.trim() ? [note.trim()] : [],
  }), [date, invNo, billTo, attn, forText, parsed, note]);

  // rebuild the preview shortly after typing stops
  useEffect(() => {
    let alive = true;
    const t = setTimeout(async () => {
      try {
        const r = await buildInvoicePdf(spec);
        if (!alive) return;
        const u = URL.createObjectURL(new Blob([r.bytes as BlobPart], { type: 'application/pdf' }));
        if (urlRef.current) URL.revokeObjectURL(urlRef.current);
        urlRef.current = u; setUrl(u); setPdf(r); setErr(null);
      } catch (e: any) { if (alive) setErr(e.message ?? String(e)); }
    }, 350);
    return () => { alive = false; clearTimeout(t); };
  }, [spec]);
  useEffect(() => () => { if (urlRef.current) URL.revokeObjectURL(urlRef.current); }, []);

  const overflow = !!pdf && pdf.descEnd > DESC_LIMIT;
  const fileName = `${[project?.name, 'Invoice', invNo].filter(Boolean).join(' ').replace(/[\\/:*?"<>|]+/g, '-')}.pdf`;
  const ready = !!pdf && !overflow && !badAmount && !!billTo.trim() && parsed.some((l) => l.desc);
  const why = !billTo.trim() ? 'Add who it’s billed to.' : !parsed.some((l) => l.desc) ? 'Add at least one line item.'
    : badAmount ? 'One of the amounts isn’t a number.' : overflow ? 'Too much text for one page; shorten the line items.' : '';

  const download = () => {
    if (!pdf) return;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([pdf.bytes as BlobPart], { type: 'application/pdf' }));
    a.download = fileName; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  };
  const saveToFiles = async () => {
    if (!pdf || !client || !project) return;
    setBusy(true); setErr(null);
    try {
      await uploadFile(client, save, { project_id: project.id, folder: 'Client invoice' }, new File([pdf.bytes as BlobPart], fileName, { type: 'application/pdf' }));
      setSaved(fileName);
    } catch (e: any) { setErr(e.message ?? String(e)); }
    finally { setBusy(false); }
  };

  const setLine = (i: number, k: 'desc' | 'amount', v: string) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, [k]: v } : l)));

  return (
    <div className="drawer-wrap" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="drawer invoice-drawer">
        <div className="drawer-head">
          <h2>Create invoice{job ? ` · ${job}` : ''}</h2>
          <button type="button" className="ghost" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className="inv-body">
          <form className="inv-form" onSubmit={(e) => e.preventDefault()}>
            <div className="inv-row">
              <label className="field"><span>Date</span><input type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} /></label>
              <label className="field"><span>Invoice #</span>
                <input value={invNo} onChange={(e) => { setInvNo(e.target.value); setInvTouched(true); }} />
              </label>
            </div>
            <div className="inv-row">
              <label className="field"><span>Bill to *</span>
                <input list="inv-clients" value={billTo} onChange={(e) => setBillTo(e.target.value)} placeholder="Related, Venture, Grubb…" />
                <datalist id="inv-clients">{[...new Set([project?.client, ...CLIENTS].filter(Boolean))].map((c) => <option key={c} value={c} />)}</datalist>
                <span className="muted small">The job’s client</span>
              </label>
              <label className="field"><span>ATTN</span><input value={attn} onChange={(e) => setAttn(e.target.value)} placeholder="Who the invoice goes to" />
                <span className="muted small">The job’s “Bill to”</span></label>
            </div>
            <label className="field"><span>For</span>
              <input value={forText} onChange={(e) => setForText(e.target.value)} placeholder="#26-370 Allen Ceiling Disinfection UNCW" />
              <span className="muted small">Shows in the boxed FOR field (up to 3 lines).</span>
            </label>

            <div className="inv-lines">
              <div className="inv-lines-head"><span>Description</span><span>Amount</span><span /></div>
              {lines.map((l, i) => (
                <div key={i} className="inv-line">
                  <textarea rows={2} value={l.desc} onChange={(e) => setLine(i, 'desc', e.target.value)}
                    placeholder={i === 0 ? 'Water loss repairs completed through **10/14/2026** at Link Caylx unit 302.' : 'Another line item'} aria-label={`Line ${i + 1} description`} />
                  <span className="inv-amt"><span>$</span>
                    <input inputMode="decimal" value={l.amount} onChange={(e) => setLine(i, 'amount', e.target.value)} placeholder="0.00"
                      className={l.amount.trim() && parsed[i].amount == null ? 'bad' : ''} aria-label={`Line ${i + 1} amount`}
                      onBlur={() => parsed[i].amount != null && setLine(i, 'amount', money(parsed[i].amount!))} />
                  </span>
                  <button type="button" className="ghost small" aria-label={`Remove line ${i + 1}`} disabled={lines.length === 1}
                    onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}>✕</button>
                </div>
              ))}
              <div className="inv-line-foot">
                <button type="button" onClick={() => setLines((ls) => [...ls, { desc: '', amount: '' }])}>+ Add line item</button>
                <span className="inv-total"><span>TOTAL</span><b>$ {money(total)}</b></span>
              </div>
              <p className="muted small">Wrap a date in **double stars** to print it bold. Lines without an amount print as scope text only.</p>
            </div>

            <label className="field"><span>Note (italic, under the last line item)</span>
              <input list="inv-notes" value={note} onChange={(e) => setNote(e.target.value)} />
              <datalist id="inv-notes">{NOTE_PRESETS.map((n) => <option key={n} value={n} />)}</datalist>
            </label>
          </form>

          <div className="inv-preview">
            <div className="inv-preview-bar">
              <span>Preview{pdf ? ` · total $${money(pdf.total)}` : ''}</span>
              {url && <a href={url} target="_blank" rel="noreferrer">Open preview in new tab ↗</a>}
            </div>
            {url ? <iframe title="Invoice preview" src={`${url}#toolbar=0&navpanes=0&view=FitH`} /> : <div className="muted pad">Building preview…</div>}
          </div>
        </div>
        <div className="drawer-foot">
          {err ? <span className="err small" style={{ margin: 0 }}>{err}</span>
            : saved ? <span className="small ok-text">Saved to this job’s Files as “{saved}”.</span>
            : why ? <span className="small warn-text">{why}</span> : <span className="muted small">{fileName}</span>}
          <span style={{ flex: 1 }} />
          <button type="button" className="ghost" onClick={onClose}>Close</button>
          {client && project && <button type="button" disabled={!ready || busy} onClick={saveToFiles}>{busy ? 'Saving…' : 'Save to job Files'}</button>}
          <button type="button" className="primary" disabled={!ready} onClick={download}>⤓ Download PDF</button>
        </div>
      </div>
    </div>
  );
}
