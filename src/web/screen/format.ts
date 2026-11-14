// Formatting by the design system's voice: money always shows cents and a true minus when it
// moves; times are 12-hour without a leading zero.

const MINUS = '−';

export function money(cents: number): string {
  const abs = Math.abs(cents);
  const dollars = Math.floor(abs / 100).toLocaleString('en-CA');
  return `$${dollars}.${String(abs % 100).padStart(2, '0')}`;
}

export function signedMoney(cents: number): string {
  if (cents === 0) return money(0);
  return `${cents < 0 ? MINUS : '+'}${money(cents)}`;
}

export function clock(at: Date): string {
  const h = at.getHours() % 12 || 12;
  return `${h}:${String(at.getMinutes()).padStart(2, '0')}`;
}

export function seconds(ms: number): string {
  return `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)}s`;
}

export function ago(at: Date, now: number = Date.now()): string {
  const s = Math.max(0, Math.round((now - at.getTime()) / 1000));
  if (s < 60) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  return `${h} h ago`;
}
