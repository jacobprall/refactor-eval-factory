import { type EvalTarget, seedFiles } from "./types.js";

const typesSource = `export type WarehouseId = string;
export type ReservationStatus = "active" | "released" | "committed" | "expired";

export interface StockInput {
  sku: string;
  available: number;
  warehouse?: WarehouseId;
}

export interface ReservationLine {
  sku: string;
  quantity: number;
  warehouse?: WarehouseId;
}

export interface NormalizedLine {
  sku: string;
  quantity: number;
  warehouse: WarehouseId;
}

export interface ReservationSnapshot {
  id: string;
  status: ReservationStatus;
  lines: readonly NormalizedLine[];
  expiresAt?: number;
}

export interface InventoryOptions {
  safetyStock?: readonly SafetyStockRule[];
}

export interface SafetyStockRule {
  sku: string;
  quantity: number;
  warehouse?: WarehouseId;
}

export type AuditEventType =
  | "reserve"
  | "release"
  | "commit"
  | "expire"
  | "transfer"
  | "amend"
  | "policy";

export interface AuditEvent {
  sequence: number;
  type: AuditEventType;
  reservationId?: string;
  sku?: string;
  quantity?: number;
  warehouse?: WarehouseId;
  details?: Readonly<Record<string, string | number>>;
}

export interface AuditFilter {
  type?: AuditEventType;
  reservationId?: string;
  warehouse?: WarehouseId;
}

export interface InventorySnapshot {
  stock: readonly StockInput[];
  reservations: readonly ReservationSnapshot[];
}
`;

const errorsSource = `export type InventoryErrorCode =
  | "invalid_input"
  | "duplicate_reservation"
  | "reservation_not_found"
  | "invalid_transition"
  | "insufficient_stock"
  | "idempotency_conflict";

export class InventoryError extends Error {
  readonly code: InventoryErrorCode;

  constructor(code: InventoryErrorCode, message: string) {
    super(message);
    this.name = "InventoryError";
    this.code = code;
  }
}

export function fail(code: InventoryErrorCode, message: string): never {
  throw new InventoryError(code, message);
}
`;

const keysSource = `import { fail } from "./errors.ts";

export const DEFAULT_WAREHOUSE = "default";

export function cleanName(value: string, field: string): string {
  const result = value.trim();
  if (!result) fail("invalid_input", field + " must not be empty");
  return result;
}

export function warehouseName(value?: string): string {
  return cleanName(value ?? DEFAULT_WAREHOUSE, "warehouse");
}

export function stockKey(sku: string, warehouse?: string): string {
  return warehouseName(warehouse) + "\\u0000" + cleanName(sku, "sku");
}

export function parseStockKey(key: string): { sku: string; warehouse: string } {
  const separator = key.indexOf("\\u0000");
  return { warehouse: key.slice(0, separator), sku: key.slice(separator + 1) };
}

export function positiveInteger(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) fail("invalid_input", field + " must be a positive integer");
  return value;
}
`;

const ledgerSource = `import { fail } from "./errors.ts";
import { parseStockKey, positiveInteger, stockKey, warehouseName } from "./keys.ts";
import type { NormalizedLine, StockInput } from "./types.ts";

export class StockLedger {
  private readonly quantities = new Map<string, number>();

  constructor(stock: readonly StockInput[]) {
    for (const item of stock) {
      const quantity = Number(item.available);
      if (!Number.isSafeInteger(quantity) || quantity < 0) fail("invalid_input", "available must be a non-negative integer");
      const key = stockKey(item.sku, item.warehouse);
      this.quantities.set(key, (this.quantities.get(key) ?? 0) + quantity);
    }
  }

  available(sku: string, warehouse?: string): number {
    return this.quantities.get(stockKey(sku, warehouse)) ?? 0;
  }

  normalize(lines: readonly { sku: string; quantity: number; warehouse?: string }[]): NormalizedLine[] {
    if (lines.length === 0) fail("invalid_input", "reservation requires at least one line");
    const combined = new Map<string, number>();
    for (const line of lines) {
      const key = stockKey(line.sku, line.warehouse);
      combined.set(key, (combined.get(key) ?? 0) + positiveInteger(line.quantity, "quantity"));
    }
    return [...combined].map(([key, quantity]) => ({ ...parseStockKey(key), quantity }));
  }

  canRemove(lines: readonly NormalizedLine[]): boolean {
    return lines.every((line) => this.available(line.sku, line.warehouse) >= line.quantity);
  }

  remove(lines: readonly NormalizedLine[]): void {
    if (!this.canRemove(lines)) fail("insufficient_stock", "insufficient available stock");
    for (const line of lines) {
      const key = stockKey(line.sku, line.warehouse);
      this.quantities.set(key, (this.quantities.get(key) ?? 0) - line.quantity);
    }
  }

  add(lines: readonly NormalizedLine[]): void {
    for (const line of lines) {
      const key = stockKey(line.sku, line.warehouse);
      this.quantities.set(key, (this.quantities.get(key) ?? 0) + line.quantity);
    }
  }

  transfer(sku: string, quantity: number, fromWarehouse: string, toWarehouse: string): void {
    const amount = positiveInteger(quantity, "quantity");
    const from = warehouseName(fromWarehouse);
    const to = warehouseName(toWarehouse);
    if (from === to) fail("invalid_input", "warehouses must differ");
    const line = { sku, quantity: amount, warehouse: from };
    this.remove([line]);
    this.add([{ ...line, warehouse: to }]);
  }

  entries(): StockInput[] {
    return [...this.quantities]
      .map(([key, available]) => ({ ...parseStockKey(key), available }))
      .sort((left, right) => left.warehouse.localeCompare(right.warehouse) || left.sku.localeCompare(right.sku));
  }
}
`;

const reservationsSource = `import { fail } from "./errors.ts";
import { cleanName } from "./keys.ts";
import type { NormalizedLine, ReservationSnapshot, ReservationStatus } from "./types.ts";

interface ReservationRecord {
  id: string;
  status: ReservationStatus;
  lines: NormalizedLine[];
  expiresAt?: number;
}

function copy(record: ReservationRecord): ReservationSnapshot {
  return {
    id: record.id,
    status: record.status,
    lines: record.lines.map((line) => ({ ...line })),
    ...(record.expiresAt === undefined ? {} : { expiresAt: record.expiresAt }),
  };
}

export class ReservationStore {
  private readonly records = new Map<string, ReservationRecord>();

  create(id: string, lines: readonly NormalizedLine[], expiresAt?: number): ReservationSnapshot {
    const cleanId = cleanName(id, "reservation id");
    if (this.records.has(cleanId)) fail("duplicate_reservation", "reservation already exists: " + cleanId);
    if (expiresAt !== undefined && !Number.isFinite(expiresAt)) fail("invalid_input", "expiresAt must be finite");
    const record: ReservationRecord = { id: cleanId, status: "active", lines: lines.map((line) => ({ ...line })), expiresAt };
    this.records.set(cleanId, record);
    return copy(record);
  }

  require(id: string): ReservationSnapshot {
    const record = this.records.get(id);
    if (!record) fail("reservation_not_found", "unknown reservation: " + id);
    return copy(record);
  }

  active(id: string): ReservationSnapshot {
    const reservation = this.require(id);
    if (reservation.status !== "active") fail("invalid_transition", "reservation is not active: " + id);
    return reservation;
  }

  setStatus(id: string, status: ReservationStatus): ReservationSnapshot {
    const record = this.records.get(id);
    if (!record) fail("reservation_not_found", "unknown reservation: " + id);
    record.status = status;
    return copy(record);
  }

  replaceLines(id: string, lines: readonly NormalizedLine[]): ReservationSnapshot {
    const record = this.records.get(id);
    if (!record) fail("reservation_not_found", "unknown reservation: " + id);
    record.lines = lines.map((line) => ({ ...line }));
    return copy(record);
  }

  all(): ReservationSnapshot[] {
    return [...this.records.values()].map(copy);
  }
}
`;

const policySource = `import { fail } from "./errors.ts";
import { positiveInteger, stockKey } from "./keys.ts";
import type { SafetyStockRule } from "./types.ts";

export class StockPolicy {
  private readonly floors = new Map<string, number>();

  constructor(rules: readonly SafetyStockRule[] = []) {
    for (const rule of rules) this.set(rule.sku, rule.quantity, rule.warehouse);
  }

  set(sku: string, quantity: number, warehouse?: string): void {
    if (!Number.isSafeInteger(quantity) || quantity < 0) fail("invalid_input", "safety stock must be a non-negative integer");
    this.floors.set(stockKey(sku, warehouse), quantity);
  }

  floor(sku: string, warehouse?: string): number {
    return this.floors.get(stockKey(sku, warehouse)) ?? 0;
  }

  reservable(available: number, sku: string, warehouse?: string): number {
    return Math.max(0, available - this.floor(sku, warehouse));
  }

  assertReservable(available: number, sku: string, quantity: number, warehouse?: string): void {
    positiveInteger(quantity, "quantity");
    if (this.reservable(available, sku, warehouse) < quantity) fail("insufficient_stock", "safety stock policy prevents reservation");
  }
}
`;

const auditSource = `import type { AuditEvent, AuditEventType, AuditFilter } from "./types.ts";

function eventCopy(event: AuditEvent): AuditEvent {
  return { ...event, ...(event.details ? { details: { ...event.details } } : {}) };
}

export class AuditTrail {
  private readonly events: AuditEvent[] = [];
  private nextSequence = 1;

  record(type: AuditEventType, data: Omit<AuditEvent, "sequence" | "type"> = {}): AuditEvent {
    const event: AuditEvent = { sequence: this.nextSequence++, type, ...data };
    this.events.push(event);
    return eventCopy(event);
  }

  list(filter: AuditFilter = {}): AuditEvent[] {
    return this.events
      .filter((event) => filter.type === undefined || event.type === filter.type)
      .filter((event) => filter.reservationId === undefined || event.reservationId === filter.reservationId)
      .filter((event) => filter.warehouse === undefined || event.warehouse === filter.warehouse)
      .map(eventCopy);
  }
}
`;

const inventorySeedSource = `import { AuditTrail } from "./audit.ts";
import { fail } from "./errors.ts";
import { StockLedger } from "./stock-ledger.ts";
import type { InventoryOptions, StockInput } from "./types.ts";

export class Inventory {
  protected readonly ledger: StockLedger;
  protected readonly audit = new AuditTrail();

  constructor(stock: readonly StockInput[], _options: InventoryOptions = {}) {
    this.ledger = new StockLedger(stock);
  }

  available(sku: string, warehouse = "default"): number {
    return this.ledger.available(sku, warehouse);
  }

  reserve(_id: string, _sku: string, _quantity: number, _expiresAt?: number, _warehouse = "default"): never {
    return fail("invalid_transition", "reservations are not implemented yet");
  }
}
`;

const indexSource = `export * from "./errors.ts";
export * from "./types.ts";
export * from "./inventory.ts";
`;

const seedPublicTests = `import test from "node:test";
import assert from "node:assert/strict";
import { Inventory, InventoryError } from "../src/index.ts";

test("seed aggregates stock and uses the default warehouse", () => {
  const inventory = new Inventory([
    { sku: "pen", available: 2 },
    { sku: "pen", available: 3 },
    { sku: "pen", available: 7, warehouse: "west" },
  ]);
  assert.equal(inventory.available("pen"), 5);
  assert.equal(inventory.available("pen", "west"), 7);
  assert.equal(inventory.available("missing"), 0);
});

test("seed validates stock at the domain boundary", () => {
  assert.throws(() => new Inventory([{ sku: "pen", available: -1 }]), (error) => error instanceof InventoryError && error.code === "invalid_input");
});
`;

const referenceInventorySource = `import { AuditTrail } from "./audit.ts";
import { fail } from "./errors.ts";
import { stockKey, warehouseName } from "./keys.ts";
import { StockLedger } from "./stock-ledger.ts";
import { StockPolicy } from "./stock-policy.ts";
import { ReservationStore } from "./reservation-store.ts";
import type {
  AuditEvent,
  AuditFilter,
  InventoryOptions,
  InventorySnapshot,
  NormalizedLine,
  ReservationLine,
  ReservationSnapshot,
  StockInput,
} from "./types.ts";

interface IdempotencyRecord {
  fingerprint: string;
  reservationId: string;
}

function fingerprint(id: string, lines: readonly NormalizedLine[], expiresAt?: number): string {
  return JSON.stringify({ id, lines: [...lines].sort((a, b) => stockKey(a.sku, a.warehouse).localeCompare(stockKey(b.sku, b.warehouse))), expiresAt });
}

export class Inventory {
  private readonly ledger: StockLedger;
  private readonly reservations = new ReservationStore();
  private readonly policy: StockPolicy;
  private readonly audit = new AuditTrail();
  private readonly requests = new Map<string, IdempotencyRecord>();

  constructor(stock: readonly StockInput[], options: InventoryOptions = {}) {
    this.ledger = new StockLedger(stock);
    this.policy = new StockPolicy(options.safetyStock);
  }

  available(sku: string, warehouse = "default"): number {
    return this.ledger.available(sku, warehouse);
  }

  reservable(sku: string, warehouse = "default"): number {
    return this.policy.reservable(this.available(sku, warehouse), sku, warehouse);
  }

  reservation(id: string): ReservationSnapshot {
    return this.reservations.require(id);
  }

  reserve(id: string, sku: string, quantity: number, expiresAt?: number, warehouse = "default"): ReservationSnapshot {
    return this.reserveBatch(id, [{ sku, quantity, warehouse }], expiresAt);
  }

  reserveBatch(id: string, lines: readonly ReservationLine[], expiresAt?: number): ReservationSnapshot {
    const normalized = this.ledger.normalize(lines);
    this.assertPolicy(normalized);
    this.ledger.remove(normalized);
    try {
      const reservation = this.reservations.create(id, normalized, expiresAt);
      this.audit.record("reserve", { reservationId: reservation.id, details: { lines: normalized.length } });
      return reservation;
    } catch (error) {
      this.ledger.add(normalized);
      throw error;
    }
  }

  reserveIdempotent(requestKey: string, id: string, lines: readonly ReservationLine[], expiresAt?: number): ReservationSnapshot {
    if (!requestKey.trim()) fail("invalid_input", "request key must not be empty");
    const normalized = this.ledger.normalize(lines);
    const value = fingerprint(id, normalized, expiresAt);
    const prior = this.requests.get(requestKey);
    if (prior) {
      if (prior.fingerprint !== value) fail("idempotency_conflict", "request key was used with a different reservation");
      return this.reservations.require(prior.reservationId);
    }
    const reservation = this.reserveBatch(id, normalized, expiresAt);
    this.requests.set(requestKey, { fingerprint: value, reservationId: reservation.id });
    return reservation;
  }

  release(id: string): ReservationSnapshot {
    const reservation = this.reservations.active(id);
    this.ledger.add(reservation.lines);
    const released = this.reservations.setStatus(id, "released");
    this.audit.record("release", { reservationId: id });
    return released;
  }

  commit(id: string): ReservationSnapshot {
    this.reservations.active(id);
    const committed = this.reservations.setStatus(id, "committed");
    this.audit.record("commit", { reservationId: id });
    return committed;
  }

  expire(now: number): string[] {
    if (!Number.isFinite(now)) fail("invalid_input", "now must be finite");
    const due = this.reservations
      .all()
      .filter((reservation) => reservation.status === "active" && reservation.expiresAt !== undefined && reservation.expiresAt <= now);
    for (const reservation of due) {
      this.ledger.add(reservation.lines);
      this.reservations.setStatus(reservation.id, "expired");
      this.audit.record("expire", { reservationId: reservation.id });
    }
    return due.map((reservation) => reservation.id);
  }

  setSafetyStock(sku: string, quantity: number, warehouse = "default"): void {
    this.policy.set(sku, quantity, warehouse);
    this.audit.record("policy", { sku, quantity, warehouse: warehouseName(warehouse) });
  }

  transfer(sku: string, quantity: number, fromWarehouse: string, toWarehouse: string): void {
    this.policy.assertReservable(this.available(sku, fromWarehouse), sku, quantity, fromWarehouse);
    this.ledger.transfer(sku, quantity, fromWarehouse, toWarehouse);
    this.audit.record("transfer", {
      sku,
      quantity,
      warehouse: warehouseName(fromWarehouse),
      details: { toWarehouse: warehouseName(toWarehouse) },
    });
  }

  amend(id: string, lines: readonly ReservationLine[]): ReservationSnapshot {
    const current = this.reservations.active(id);
    const replacement = this.ledger.normalize(lines);
    this.ledger.add(current.lines);
    try {
      this.assertPolicy(replacement);
      this.ledger.remove(replacement);
    } catch (error) {
      this.ledger.remove(current.lines);
      throw error;
    }
    const amended = this.reservations.replaceLines(id, replacement);
    this.audit.record("amend", { reservationId: id, details: { lines: replacement.length } });
    return amended;
  }

  auditLog(filter: AuditFilter = {}): AuditEvent[] {
    return this.audit.list(filter);
  }

  snapshot(): InventorySnapshot {
    return { stock: this.ledger.entries(), reservations: this.reservations.all() };
  }

  private assertPolicy(lines: readonly NormalizedLine[]): void {
    for (const line of lines) this.policy.assertReservable(this.available(line.sku, line.warehouse), line.sku, line.quantity, line.warehouse);
  }
}
`;

const baseFiles = seedFiles("inventory-reservations", indexSource, seedPublicTests);

export const inventoryReservations: EvalTarget = {
	id: "inventory-reservations",
	title: "Inventory reservations",
	files: {
		...baseFiles,
		"src/types.ts": typesSource,
		"src/errors.ts": errorsSource,
		"src/keys.ts": keysSource,
		"src/stock-ledger.ts": ledgerSource,
		"src/reservation-store.ts": reservationsSource,
		"src/stock-policy.ts": policySource,
		"src/audit.ts": auditSource,
		"src/inventory.ts": inventorySeedSource,
	},
	referenceFiles: {
		"src/index.ts": indexSource,
		"src/types.ts": typesSource,
		"src/errors.ts": errorsSource,
		"src/keys.ts": keysSource,
		"src/stock-ledger.ts": ledgerSource,
		"src/reservation-store.ts": reservationsSource,
		"src/stock-policy.ts": policySource,
		"src/audit.ts": auditSource,
		"src/inventory.ts": referenceInventorySource,
	},
	publicVerify: ["npm test"],
	steps: [
		{
			id: "single-reservation",
			title: "Reserve one stock item",
			prompt:
				'Implement Inventory.reserve(id: string, sku: string, quantity: number, expiresAt?: number, warehouse?: string): ReservationSnapshot and Inventory.reservation(id: string): ReservationSnapshot. A successful reserve atomically subtracts quantity and creates an active reservation; duplicate ids, non-positive integer quantities, and insufficient stock throw InventoryError with the existing codes. Preserve Inventory.available(sku: string, warehouse?: string), the "default" warehouse fallback, all exports from src/index.ts, and Node --experimental-strip-types compatibility.',
			publicTest: `test("reserve returns an active defensive snapshot", () => {
  const inventory = new subject.Inventory([{ sku: "pen", available: 3 }]);
  const reservation = inventory.reserve("r1", "pen", 2);
  assert.equal(inventory.available("pen"), 1);
  assert.deepEqual(reservation, { id: "r1", status: "active", lines: [{ sku: "pen", quantity: 2, warehouse: "default" }] });
  assert.equal(inventory.reservation("r1").status, "active");
});`,
			hiddenTest: `test("single reservation rejects duplicates and leaves stock unchanged", () => {
  const inventory = new subject.Inventory([{ sku: "pen", available: 3 }]);
  inventory.reserve("r1", "pen", 2);
  assert.throws(() => inventory.reserve("r1", "pen", 1), (error: any) => error.code === "duplicate_reservation");
  assert.throws(() => inventory.reserve("r2", "pen", 2), (error: any) => error.code === "insufficient_stock");
  assert.equal(inventory.available("pen"), 1);
});`,
		},
		{
			id: "reservation-lifecycle",
			title: "Release and commit reservations",
			prompt:
				'Add Inventory.release(id: string): ReservationSnapshot and Inventory.commit(id: string): ReservationSnapshot. release restores every reserved line and sets status "released"; commit sets status "committed" without restoring stock. Both accept only active reservations and otherwise throw InventoryError code "invalid_transition" (unknown ids remain "reservation_not_found"). Keep reserve(...), reservation(...), available(...), default-warehouse behavior, return shapes, and src/index.ts exports backward compatible.',
			publicTest: `test("release restores stock while commit consumes it", () => {
  const inventory = new subject.Inventory([{ sku: "pen", available: 4 }]);
  assert.equal(inventory.release(inventory.reserve("released", "pen", 1).id).status, "released");
  inventory.reserve("committed", "pen", 2);
  assert.equal(inventory.commit("committed").status, "committed");
  assert.equal(inventory.available("pen"), 2);
});`,
			hiddenTest: `test("terminal reservations cannot transition twice", () => {
  const inventory = new subject.Inventory([{ sku: "pen", available: 2 }]);
  inventory.reserve("r1", "pen", 1);
  inventory.release("r1");
  assert.throws(() => inventory.release("r1"), (error: any) => error.code === "invalid_transition");
  assert.throws(() => inventory.commit("r1"), (error: any) => error.code === "invalid_transition");
  assert.equal(inventory.available("pen"), 2);
});`,
		},
		{
			id: "expiration-policy",
			title: "Expire due reservations",
			prompt:
				'Add Inventory.expire(now: number): string[]. reserve(..., expiresAt?) must retain a finite millisecond deadline. expire releases all active reservations with expiresAt <= now in creation order, marks them "expired", and returns their ids; committed/released/undated reservations are ignored. Invalid now or expiresAt values throw "invalid_input". Preserve all prior Inventory method signatures and ReservationSnapshot compatibility.',
			publicTest: `test("expire releases only due active reservations", () => {
  const inventory = new subject.Inventory([{ sku: "pen", available: 3 }]);
  inventory.reserve("due", "pen", 1, 10);
  inventory.reserve("later", "pen", 1, 20);
  assert.deepEqual(inventory.expire(10), ["due"]);
  assert.equal(inventory.reservation("due").status, "expired");
  assert.equal(inventory.available("pen"), 2);
});`,
			hiddenTest: `test("expiration ignores committed, released, and undated reservations", () => {
  const inventory = new subject.Inventory([{ sku: "pen", available: 5 }]);
  inventory.reserve("committed", "pen", 1, 1); inventory.commit("committed");
  inventory.reserve("released", "pen", 1, 1); inventory.release("released");
  inventory.reserve("undated", "pen", 1);
  assert.deepEqual(inventory.expire(100), []);
  assert.equal(inventory.available("pen"), 3);
});`,
		},
		{
			id: "warehouse-routing",
			title: "Route reservations by warehouse",
			prompt:
				'Make warehouse routing explicit across Inventory.reserve(id, sku, quantity, expiresAt?, warehouse?), Inventory.available(sku, warehouse?), StockInput.warehouse?, and ReservationLine.warehouse?. Omitted warehouses must still normalize to "default"; warehouse balances and reservation snapshots must remain isolated. Existing five-argument reserve calls and all earlier return/error semantics are compatibility requirements.',
			publicTest: `test("warehouse reservations are isolated", () => {
  const inventory = new subject.Inventory([{ sku: "pen", available: 2, warehouse: "east" }, { sku: "pen", available: 1, warehouse: "west" }]);
  const reservation = inventory.reserve("r1", "pen", 2, undefined, "east");
  assert.equal(reservation.lines[0]?.warehouse, "east");
  assert.equal(inventory.available("pen", "east"), 0);
  assert.equal(inventory.available("pen", "west"), 1);
});`,
			hiddenTest: `test("default and named warehouses do not leak stock", () => {
  const inventory = new subject.Inventory([{ sku: "pen", available: 1 }, { sku: "pen", available: 1, warehouse: "east" }]);
  inventory.reserve("default-r", "pen", 1);
  assert.throws(() => inventory.reserve("default-r2", "pen", 1), (error: any) => error.code === "insufficient_stock");
  inventory.reserve("east-r", "pen", 1, undefined, "east");
  assert.equal(inventory.available("pen", "east"), 0);
});`,
		},
		{
			id: "atomic-batches",
			title: "Reserve multi-line batches",
			prompt:
				'Add Inventory.reserveBatch(id: string, lines: readonly ReservationLine[], expiresAt?: number): ReservationSnapshot. Normalize omitted warehouses to "default", combine duplicate sku/warehouse lines, and reserve every line atomically or none. release, commit, expire, reservation, and available must work unchanged for both single and batch reservations; reserve(...) must remain a backward-compatible one-line wrapper.',
			publicTest: `test("batch reservations combine lines and release together", () => {
  const inventory = new subject.Inventory([{ sku: "pen", available: 3 }, { sku: "pad", available: 2 }]);
  const reservation = inventory.reserveBatch("order", [{ sku: "pen", quantity: 1 }, { sku: "pen", quantity: 1 }, { sku: "pad", quantity: 2 }], 50);
  assert.deepEqual(reservation.lines, [{ sku: "pen", warehouse: "default", quantity: 2 }, { sku: "pad", warehouse: "default", quantity: 2 }]);
  inventory.release("order");
  assert.equal(inventory.available("pen"), 3);
});`,
			hiddenTest: `test("failed batches make no stock or reservation changes", () => {
  const inventory = new subject.Inventory([{ sku: "pen", available: 2 }, { sku: "pad", available: 1 }]);
  assert.throws(() => inventory.reserveBatch("order", [{ sku: "pen", quantity: 2 }, { sku: "pad", quantity: 2 }]), (error: any) => error.code === "insufficient_stock");
  assert.equal(inventory.available("pen"), 2);
  assert.throws(() => inventory.reservation("order"), (error: any) => error.code === "reservation_not_found");
});`,
		},
		{
			id: "safety-stock",
			title: "Protect safety stock",
			prompt:
				'Honor InventoryOptions.safetyStock in the constructor and add Inventory.reservable(sku: string, warehouse?: string): number plus Inventory.setSafetyStock(sku: string, quantity: number, warehouse?: string): void. SafetyStockRule quantities are per sku/warehouse floors: reserve and reserveBatch may not reduce available below the floor and must fail atomically with "insufficient_stock". available still reports physical unreserved units. Preserve all existing APIs and default-warehouse compatibility.',
			publicTest: `test("safety stock limits reservable rather than available", () => {
  const inventory = new subject.Inventory([{ sku: "pen", available: 5 }], { safetyStock: [{ sku: "pen", quantity: 2 }] });
  assert.equal(inventory.available("pen"), 5);
  assert.equal(inventory.reservable("pen"), 3);
  inventory.reserve("r1", "pen", 3);
  assert.equal(inventory.reservable("pen"), 0);
});`,
			hiddenTest: `test("updated warehouse policy is enforced by batches", () => {
  const inventory = new subject.Inventory([{ sku: "pen", available: 4, warehouse: "east" }, { sku: "pad", available: 2, warehouse: "east" }]);
  inventory.setSafetyStock("pen", 2, "east");
  assert.throws(() => inventory.reserveBatch("order", [{ sku: "pen", quantity: 3, warehouse: "east" }, { sku: "pad", quantity: 1, warehouse: "east" }]), (error: any) => error.code === "insufficient_stock");
  assert.equal(inventory.available("pad", "east"), 2);
});`,
		},
		{
			id: "idempotent-requests",
			title: "Deduplicate reservation requests",
			prompt:
				'Add Inventory.reserveIdempotent(requestKey: string, id: string, lines: readonly ReservationLine[], expiresAt?: number): ReservationSnapshot. Repeating a non-empty requestKey with the same normalized id, lines, and expiresAt returns the existing reservation without changing stock; reusing it with different input throws InventoryError code "idempotency_conflict". Normalization must treat reordered and duplicate-combined lines as equivalent. Do not change reserve or reserveBatch signatures or behavior.',
			publicTest: `test("identical idempotent retries do not reserve twice", () => {
  const inventory = new subject.Inventory([{ sku: "pen", available: 3 }]);
  const first = inventory.reserveIdempotent("request-1", "r1", [{ sku: "pen", quantity: 2 }], 20);
  const retry = inventory.reserveIdempotent("request-1", "r1", [{ sku: "pen", quantity: 2 }], 20);
  assert.deepEqual(retry, first);
  assert.equal(inventory.available("pen"), 1);
});`,
			hiddenTest: `test("idempotency compares canonical input and rejects conflicts", () => {
  const inventory = new subject.Inventory([{ sku: "pen", available: 4 }, { sku: "pad", available: 2 }]);
  inventory.reserveIdempotent("request-1", "r1", [{ sku: "pen", quantity: 1 }, { sku: "pad", quantity: 1 }, { sku: "pen", quantity: 1 }]);
  inventory.reserveIdempotent("request-1", "r1", [{ sku: "pad", quantity: 1 }, { sku: "pen", quantity: 2 }]);
  assert.throws(() => inventory.reserveIdempotent("request-1", "r2", [{ sku: "pen", quantity: 1 }]), (error: any) => error.code === "idempotency_conflict");
  assert.equal(inventory.available("pen"), 2);
});`,
		},
		{
			id: "policy-aware-transfers",
			title: "Transfer unreserved stock",
			prompt:
				'Add Inventory.transfer(sku: string, quantity: number, fromWarehouse: string, toWarehouse: string): void. The operation moves unreserved stock atomically, rejects equal warehouses/invalid quantities with "invalid_input", and rejects moves that breach the source safety-stock floor with "insufficient_stock". Destination policy does not block receiving. Preserve reservation balances, all prior signatures, and default normalization behavior.',
			publicTest: `test("transfer moves stock between warehouses", () => {
  const inventory = new subject.Inventory([{ sku: "pen", available: 4, warehouse: "east" }]);
  inventory.transfer("pen", 2, "east", "west");
  assert.equal(inventory.available("pen", "east"), 2);
  assert.equal(inventory.available("pen", "west"), 2);
});`,
			hiddenTest: `test("transfer is atomic and respects source safety stock", () => {
  const inventory = new subject.Inventory([{ sku: "pen", available: 4, warehouse: "east" }], { safetyStock: [{ sku: "pen", quantity: 2, warehouse: "east" }] });
  assert.throws(() => inventory.transfer("pen", 3, "east", "west"), (error: any) => error.code === "insufficient_stock");
  assert.equal(inventory.available("pen", "east"), 4);
  assert.equal(inventory.available("pen", "west"), 0);
});`,
		},
		{
			id: "atomic-amendments",
			title: "Amend active reservations",
			prompt:
				'Add Inventory.amend(id: string, lines: readonly ReservationLine[]): ReservationSnapshot. Replace all lines of an active reservation while retaining its id, active status, and expiresAt. Validate the replacement against stock plus the reservation\'s currently held units and current safety-stock policy; on failure, both reservation and balances remain unchanged. Released/committed/expired ids throw "invalid_transition". Keep every prior API and snapshot shape compatible.',
			publicTest: `test("amend can grow and reroute an active reservation", () => {
  const inventory = new subject.Inventory([{ sku: "pen", available: 4 }, { sku: "pen", available: 2, warehouse: "west" }]);
  inventory.reserve("r1", "pen", 1, 50);
  const amended = inventory.amend("r1", [{ sku: "pen", quantity: 2 }, { sku: "pen", quantity: 1, warehouse: "west" }]);
  assert.equal(amended.expiresAt, 50);
  assert.equal(inventory.available("pen"), 2);
  assert.equal(inventory.available("pen", "west"), 1);
});`,
			hiddenTest: `test("failed amendment restores old holds exactly", () => {
  const inventory = new subject.Inventory([{ sku: "pen", available: 3 }, { sku: "pad", available: 1 }]);
  inventory.reserveBatch("r1", [{ sku: "pen", quantity: 2 }]);
  assert.throws(() => inventory.amend("r1", [{ sku: "pad", quantity: 2 }]), (error: any) => error.code === "insufficient_stock");
  assert.deepEqual(inventory.reservation("r1").lines, [{ sku: "pen", warehouse: "default", quantity: 2 }]);
  assert.equal(inventory.available("pen"), 1);
  assert.equal(inventory.available("pad"), 1);
});`,
		},
		{
			id: "audit-and-snapshot",
			title: "Expose audit and state views",
			prompt:
				'Add Inventory.auditLog(filter?: AuditFilter): AuditEvent[] and Inventory.snapshot(): InventorySnapshot. Record successful reserve/reserveBatch/reserveIdempotent as "reserve", release, commit, expire, setSafetyStock as "policy", transfer, and amend operations in order with monotonically increasing sequence values; failed operations and idempotent retries add no event. AuditFilter supports type, reservationId, and warehouse intersection. Both APIs and nested data must be defensive copies. Preserve every prior public signature, error code, export, and Node strip-types compatibility.',
			publicTest: `test("audit and snapshot expose defensive ordered views", () => {
  const inventory = new subject.Inventory([{ sku: "pen", available: 3 }]);
  inventory.reserve("r1", "pen", 1);
  inventory.commit("r1");
  const log = inventory.auditLog();
  assert.deepEqual(log.map((event: any) => [event.sequence, event.type]), [[1, "reserve"], [2, "commit"]]);
  const state = inventory.snapshot();
  (state.stock[0] as any).available = 99;
  assert.equal(inventory.available("pen"), 2);
});`,
			hiddenTest: `test("audit filters intersect and exclude failures and retries", () => {
  const inventory = new subject.Inventory([{ sku: "pen", available: 4, warehouse: "east" }]);
  inventory.setSafetyStock("pen", 1, "east");
  inventory.reserveIdempotent("key", "r1", [{ sku: "pen", quantity: 1, warehouse: "east" }]);
  inventory.reserveIdempotent("key", "r1", [{ sku: "pen", quantity: 1, warehouse: "east" }]);
  assert.throws(() => inventory.transfer("pen", 9, "east", "west"));
  inventory.release("r1");
  assert.deepEqual(inventory.auditLog().map((event: any) => event.type), ["policy", "reserve", "release"]);
  assert.deepEqual(inventory.auditLog({ type: "reserve", reservationId: "r1" }).map((event: any) => event.reservationId), ["r1"]);
  const state = inventory.snapshot();
  (state.reservations[0]!.lines as any[])[0]!.quantity = 99;
  assert.equal(inventory.reservation("r1").lines[0]?.quantity, 1);
});`,
		},
	],
};
