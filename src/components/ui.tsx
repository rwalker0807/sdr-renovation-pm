import type { ReactNode } from 'react';
import { label } from '../lib/format';

const TONE: Record<string, string> = {
  // green
  contracted: 'g', executed: 'g', approved: 'g', paid: 'g', delivered: 'g', installed: 'g', complete: 'g', resolved: 'g', active: 'g',
  // blue
  awarded: 'b', out_for_signature: 'b', ordered: 'b', shipped: 'b', issued: 'b', in_progress: 'b', priced: 'b', assigned: 'b', precon: 'b',
  // amber
  bidding: 'a', leveling: 'a', pending: 'a', received: 'a', quoted: 'a', open: 'a', draft: 'a', on_hold: 'a',
  // red
  disputed: 'r', blocked: 'r', rejected: 'r',
};

export function Pill({ value }: { value: any }) {
  if (!value) return null;
  return <span className={`pill pill-${TONE[value] ?? 'n'}`}>{label(value)}</span>;
}

export function Kpi({ title, value, sub, tone }: { title: string; value: ReactNode; sub?: ReactNode; tone?: 'good' | 'bad' }) {
  return (
    <div className="kpi">
      <div className="kpi-title">{title}</div>
      <div className={`kpi-value ${tone ?? ''}`}>{value}</div>
      {sub && <div className="kpi-sub">{sub}</div>}
    </div>
  );
}

export function Meter({ value, max = 100, warn }: { value: number; max?: number; warn?: boolean }) {
  const w = Math.max(0, Math.min(100, (value / (max || 1)) * 100));
  return <div className="meter"><div className={`meter-fill ${warn ? 'warn' : ''}`} style={{ width: `${w}%` }} /></div>;
}

export function PageHead({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="page-head">
      <h1>{title}</h1>
      <div className="page-actions">{children}</div>
    </div>
  );
}

/** Small coloured tag for a project's job type. */
export function JobTypeTag({ type }: { type?: string }) {
  const t = type === 'loss' || type === 'gc' ? type : 'renovation';
  const text = t === 'loss' ? 'Water/Fire Loss' : t === 'gc' ? 'GC' : 'Renovation';
  return <span className={`jt jt-${t}`}>{text}</span>;
}
