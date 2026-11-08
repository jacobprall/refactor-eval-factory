export function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

/** Whole-percent share of an amount in cents, rounded half-up. */
export function percentOf(amountCents: number, percent: number): number {
  return Math.round((amountCents * percent) / 100);
}
