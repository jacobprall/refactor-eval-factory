import { fail } from "./errors.ts";

export function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

export function roundPercent(amountCents: number, percent: number): number {
  return Math.round((amountCents * percent) / 100);
}

export function sumBy<T>(items: readonly T[], pick: (item: T) => number): number {
  return items.reduce((total, item) => total + pick(item), 0);
}

export function nextId(prefix: string): () => string {
  let next = 0;
  return () => `${prefix}${++next}`;
}

export function clone<T>(value: T): T {
  return structuredClone(value);
}

export function requireText(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim() === "") fail("invalid_input", `${field} must be a non-empty string`);
  return value.trim();
}

export function requirePositiveInt(value: unknown, field: string): number {
  if (!Number.isSafeInteger(value) || (value as number) <= 0) fail("invalid_input", `${field} must be a positive integer`);
  return value as number;
}

export function requireNonNegativeInt(value: unknown, field: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) fail("invalid_input", `${field} must be a non-negative integer`);
  return value as number;
}

export function requireOneOf<T extends string>(value: unknown, allowed: readonly T[], field: string): T {
  if (!allowed.includes(value as T)) fail("invalid_input", `${field} must be one of ${allowed.join(", ")}`);
  return value as T;
}
