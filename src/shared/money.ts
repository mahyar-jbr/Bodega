// Money math, shared by both stores, the agent and the evaluation. Everything is integer cents.
// The rule (data/README.md): discount = round half up (subtotal x pct / 100); total = subtotal - discount.

/** Dollars (as the model or data/ writes them) to integer cents, rounded to the nearest cent. */
export function dollarsToCents(dollars: number): number {
  return Math.round(dollars * 100);
}

export function centsToDollars(cents: number): number {
  return cents / 100;
}

/** "$6.07" */
export function formatCents(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  return `${sign}$${(Math.abs(cents) / 100).toFixed(2)}`;
}

/** A percentage the money layer accepts: more than 0, at most 100, with at most two decimals. */
export function isValidPct(pct: unknown): pct is number {
  return typeof pct === 'number' && Number.isFinite(pct) && pct > 0 && pct <= 100
    && Math.abs(pct * 100 - Math.round(pct * 100)) < 1e-9;
}

/**
 * Round half up of (subtotal x pct / 100), in exact integer math.
 * discountCents(675, 10) = 68, discountCents(375, 10) = 38.
 */
export function discountCents(subtotalCents: number, pct: number): number {
  if (!Number.isInteger(subtotalCents) || subtotalCents < 0) throw new RangeError(`bad subtotal: ${subtotalCents}`);
  if (!isValidPct(pct)) throw new RangeError(`bad pct: ${pct}`);
  const hundredths = Math.round(pct * 100);                 // 10% -> 1000
  return Math.floor((subtotalCents * hundredths + 5_000) / 10_000);
}

export function totalCents(subtotalCents: number, pct: number | null | undefined): number {
  return subtotalCents - (pct ? discountCents(subtotalCents, pct) : 0);
}
