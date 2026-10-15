const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
const usdK = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', notation: 'compact', maximumFractionDigits: 2 });

export const money = (v: any) => (v == null || v === '' ? '' : usd.format(Number(v)));
export const moneyShort = (v: number) => usdK.format(v);
export const pct = (v: any, d = 0) => (v == null || v === '' ? '' : `${Number(v).toFixed(d)}%`);
export const label = (s: any) => String(s ?? '').replace(/_/g, ' ');
export const date = (v: any) => {
  if (!v) return '';
  const [y, m, d] = String(v).slice(0, 10).split('-');
  return `${m}/${d}/${y.slice(2)}`;
};
