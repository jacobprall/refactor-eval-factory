import type { EvalTarget } from "./types.js";

const packageJson = `${JSON.stringify(
	{
		name: "eval-usage-metering",
		version: "1.0.0",
		private: true,
		type: "module",
		scripts: {
			test: "node --experimental-strip-types --test tests/*.test.ts",
			check: "npm test",
		},
	},
	null,
	2,
)}\n`;

const seedTypes = `export interface MeterKey {
  accountId: string;
  metric: string;
}

export interface UsagePlan {
  ceilings: Readonly<Record<string, number>>;
}

export interface UsageRequest extends MeterKey {
  units: number;
  timestamp?: number;
}

export interface UsageDecision extends MeterKey {
  allowed: boolean;
  units: number;
  used: number;
  projected: number;
  limit: number | null;
  reason?: "limit_exceeded";
}

export interface UsageMeterOptions {
  plan?: UsagePlan;
}
`;

const seedErrors = `export type UsageErrorCode =
  | "invalid_input"
  | "limit_exceeded"
  | "insufficient_usage";

export class UsageError extends Error {
  readonly code: UsageErrorCode;

  constructor(code: UsageErrorCode, message: string) {
    super(message);
    this.name = "UsageError";
    this.code = code;
  }
}

export function fail(code: UsageErrorCode, message: string): never {
  throw new UsageError(code, message);
}
`;

const seedKeys = `import { fail } from "./errors.ts";
import type { MeterKey, UsageRequest } from "./types.ts";

export function clean(value: string, field: string): string {
  const result = value.trim();
  if (!result) fail("invalid_input", field + " must not be empty");
  return result;
}

export function units(value: number): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    fail("invalid_input", "units must be a positive safe integer");
  }
  return value;
}

export function timestamp(value: number | undefined): number {
  const result = value ?? Date.now();
  if (!Number.isFinite(result) || result < 0) fail("invalid_input", "timestamp must be finite and non-negative");
  return result;
}

export function normalizeKey(input: MeterKey): MeterKey {
  return { accountId: clean(input.accountId, "accountId"), metric: clean(input.metric, "metric") };
}

export function normalizeRequest(input: UsageRequest): Required<UsageRequest> {
  return { ...normalizeKey(input), units: units(input.units), timestamp: timestamp(input.timestamp) };
}

export function storageKey(input: MeterKey): string {
  const key = normalizeKey(input);
  return key.accountId + "\\u0000" + key.metric;
}
`;

const seedLedger = `import { fail } from "./errors.ts";
import { storageKey } from "./keys.ts";
import type { MeterKey } from "./types.ts";

interface Entry {
  units: number;
  timestamp: number;
}

interface LedgerEntrySnapshot extends MeterKey {
  units: number;
  timestamp: number;
}

export class UsageLedger {
  private readonly entries = new Map<string, Entry[]>();
  private readonly keys = new Map<string, MeterKey>();

  total(key: MeterKey): number {
    return (this.entries.get(storageKey(key)) ?? []).reduce((sum, entry) => sum + entry.units, 0);
  }

  add(key: MeterKey, units: number, timestamp: number): void {
    const id = storageKey(key);
    const entries = this.entries.get(id) ?? [];
    entries.push({ units, timestamp });
    this.entries.set(id, entries);
    this.keys.set(id, { accountId: key.accountId, metric: key.metric });
  }

  remove(key: MeterKey, units: number): void {
    const id = storageKey(key);
    const entries = this.entries.get(id) ?? [];
    if (this.total(key) < units) fail("insufficient_usage", "cannot release more usage than was recorded");
    let remaining = units;
    for (let index = entries.length - 1; index >= 0 && remaining > 0; index--) {
      const entry = entries[index]!;
      const removed = Math.min(entry.units, remaining);
      entry.units -= removed;
      remaining -= removed;
      if (entry.units === 0) entries.splice(index, 1);
    }
    if (entries.length === 0) {
      this.entries.delete(id);
      this.keys.delete(id);
    }
  }

  snapshot(key: MeterKey): ReadonlyArray<{ units: number; timestamp: number }> {
    return (this.entries.get(storageKey(key)) ?? []).map((entry) => ({ ...entry }));
  }

  has(key: MeterKey): boolean {
    return this.entries.has(storageKey(key));
  }

  entryCount(key: MeterKey): number {
    return this.entries.get(storageKey(key))?.length ?? 0;
  }

  firstTimestamp(key: MeterKey): number | undefined {
    return this.entries.get(storageKey(key))?.[0]?.timestamp;
  }

  lastTimestamp(key: MeterKey): number | undefined {
    const entries = this.entries.get(storageKey(key));
    return entries?.[entries.length - 1]?.timestamp;
  }

  allEntries(): LedgerEntrySnapshot[] {
    const result: LedgerEntrySnapshot[] = [];
    for (const [id, entries] of this.entries) {
      const key = this.keys.get(id);
      if (!key) continue;
      for (const entry of entries) {
        result.push({ ...key, ...entry });
      }
    }
    return result;
  }

  totals(): Array<MeterKey & { units: number }> {
    const result: Array<MeterKey & { units: number }> = [];
    for (const key of this.keys.values()) {
      result.push({ ...key, units: this.total(key) });
    }
    return result;
  }

  compact(key: MeterKey): void {
    const id = storageKey(key);
    const entries = this.entries.get(id);
    if (!entries || entries.length < 2) return;
    const combined = new Map<number, number>();
    for (const entry of entries) {
      combined.set(entry.timestamp, (combined.get(entry.timestamp) ?? 0) + entry.units);
    }
    this.entries.set(
      id,
      [...combined].map(([timestamp, units]) => ({ timestamp, units })),
    );
  }

  clear(key: MeterKey): void {
    const id = storageKey(key);
    this.entries.delete(id);
    this.keys.delete(id);
  }

  clearAll(): void {
    this.entries.clear();
    this.keys.clear();
  }
}
`;

const seedPolicy = `import { fail } from "./errors.ts";
import type { UsagePlan } from "./types.ts";

export function validatePlan(plan: UsagePlan): UsagePlan {
  const ceilings: Record<string, number> = {};
  for (const [metric, limit] of Object.entries(plan.ceilings)) {
    const name = metric.trim();
    if (!name) fail("invalid_input", "metric must not be empty");
    if (!Number.isSafeInteger(limit) || limit < 0) fail("invalid_input", "ceilings must be non-negative safe integers");
    ceilings[name] = limit;
  }
  return { ceilings };
}

export function ceiling(plan: UsagePlan, metric: string): number | undefined {
  return plan.ceilings[metric];
}
`;

const seedMeter = `import { fail } from "./errors.ts";
import { normalizeKey, normalizeRequest, units } from "./keys.ts";
import { UsageLedger } from "./ledger.ts";
import { ceiling, validatePlan } from "./policy.ts";
import type { MeterKey, UsageDecision, UsageMeterOptions, UsagePlan, UsageRequest } from "./types.ts";

export class UsageMeter {
  private readonly ledger = new UsageLedger();
  private readonly plan: UsagePlan;

  constructor(options: UsageMeterOptions = {}) {
    this.plan = validatePlan(options.plan ?? { ceilings: {} });
  }

  record(request: UsageRequest): UsageDecision {
    const normalized = normalizeRequest(request);
    const used = this.ledger.total(normalized);
    const limit = ceiling(this.plan, normalized.metric);
    const projected = used + normalized.units;
    if (limit !== undefined && projected > limit) {
      return {
        accountId: normalized.accountId,
        metric: normalized.metric,
        allowed: false,
        units: normalized.units,
        used,
        projected,
        limit,
        reason: "limit_exceeded",
      };
    }
    this.ledger.add(normalized, normalized.units, normalized.timestamp);
    return {
      accountId: normalized.accountId,
      metric: normalized.metric,
      allowed: true,
      units: normalized.units,
      used,
      projected,
      limit: limit ?? null,
    };
  }

  preview(request: UsageRequest): UsageDecision {
    const normalized = normalizeRequest(request);
    const used = this.ledger.total(normalized);
    const limit = this.plan.ceilings[normalized.metric];
    const projected = used + normalized.units;
    if (limit !== undefined && projected > limit) {
      return {
        accountId: normalized.accountId,
        metric: normalized.metric,
        allowed: false,
        units: normalized.units,
        used,
        projected,
        limit,
        reason: "limit_exceeded",
      };
    }
    return {
      accountId: normalized.accountId,
      metric: normalized.metric,
      allowed: true,
      units: normalized.units,
      used,
      projected,
      limit: limit ?? null,
    };
  }

  remaining(key: MeterKey): number | null {
    const normalized = normalizeKey(key);
    const used = this.ledger.total(normalized);
    const limit = this.plan.ceilings[normalized.metric];
    if (limit === undefined) return null;
    return Math.max(0, limit - used);
  }

  usage(key: MeterKey): number {
    return this.ledger.total(normalizeKey(key));
  }

  release(key: MeterKey, amount: number): number {
    const normalized = normalizeKey(key);
    this.ledger.remove(normalized, units(amount));
    return this.ledger.total(normalized);
  }

  assertAllowed(request: UsageRequest): void {
    const decision = this.preview(request);
    if (!decision.allowed) fail("limit_exceeded", "usage limit exceeded");
  }
}
`;

const seedIndex = `export * from "./types.ts";
export * from "./errors.ts";
export * from "./keys.ts";
export * from "./policy.ts";
export * from "./meter.ts";
`;

const seedPublicTest = `import test from "node:test";
import assert from "node:assert/strict";
import { UsageError, UsageMeter } from "../src/index.ts";

test("seed records usage and enforces a metric ceiling", () => {
  const meter = new UsageMeter({ plan: { ceilings: { api: 3 } } });
  assert.equal(meter.record({ accountId: "a1", metric: "api", units: 2, timestamp: 1 }).allowed, true);
  assert.equal(meter.usage({ accountId: "a1", metric: "api" }), 2);
  assert.equal(meter.record({ accountId: "a1", metric: "api", units: 2, timestamp: 2 }).allowed, false);
  assert.equal(meter.usage({ accountId: "a1", metric: "api" }), 2);
});

test("seed validates usage at its boundary", () => {
  const meter = new UsageMeter();
  assert.throws(
    () => meter.record({ accountId: "", metric: "api", units: 1 }),
    (error) => error instanceof UsageError && error.code === "invalid_input",
  );
});
`;

const readme = `# Usage metering evaluation

Implement only the current iteration's requirement. Preserve documented compatibility and run \`npm test\` before finishing.
`;

function projectFiles(sources: Readonly<Record<string, string>>): Readonly<Record<string, string>> {
	return {
		"package.json": packageJson,
		...sources,
		"tests/public.test.ts": seedPublicTest,
		"README.md": readme,
	};
}

const seedSources = {
	"src/types.ts": seedTypes,
	"src/errors.ts": seedErrors,
	"src/keys.ts": seedKeys,
	"src/ledger.ts": seedLedger,
	"src/policy.ts": seedPolicy,
	"src/meter.ts": seedMeter,
	"src/index.ts": seedIndex,
};

const referenceTypes = `export type ScopeKind = "account" | "project" | "user";
export type MeterHealth = "healthy" | "degraded" | "down";
export type DecisionReason = "limit_exceeded" | "service_unavailable";
export type LimitSource = "plan" | "tier" | "override" | "unlimited";

export interface UsageScope {
  kind: ScopeKind;
  id: string;
}

export interface MeterKey {
  accountId: string;
  metric: string;
  scope?: UsageScope;
}

export interface TierRule {
  ceilings: Readonly<Record<string, number>>;
}

export interface UsagePlan {
  ceilings: Readonly<Record<string, number>>;
  windowMs?: number;
  tierCeilings?: Readonly<Record<string, TierRule>>;
  burstAllowance?: Readonly<Record<string, number>>;
  softThresholdRatio?: number;
}

export interface UsageRequest extends MeterKey {
  units: number;
  timestamp?: number;
  idempotencyKey?: string;
}

export interface UsageDecision extends MeterKey {
  allowed: boolean;
  units: number;
  used: number;
  projected: number;
  limit: number | null;
  effectiveLimit: number | null;
  softExceeded: boolean;
  degraded: boolean;
  source: LimitSource;
  reason?: DecisionReason;
}

export interface UsageMeterOptions {
  plan?: UsagePlan;
  now?: () => number;
}

export interface BatchResult {
  allowed: boolean;
  decisions: UsageDecision[];
}

export interface UsageExplanation {
  decision: UsageDecision;
  windowStart: number | null;
  baseLimit: number | null;
  burst: number;
  override: number | null;
  tier: string | null;
}

export interface AuditEvent {
  sequence: number;
  type: "record" | "release" | "override" | "health";
  accountId?: string;
  metric?: string;
  units?: number;
  timestamp: number;
  allowed?: boolean;
}

export interface MeterSnapshot {
  health: MeterHealth;
  usage: ReadonlyArray<{ key: MeterKey; units: number }>;
  audit: readonly AuditEvent[];
}
`;

const referenceErrors = `export type UsageErrorCode =
  | "invalid_input"
  | "limit_exceeded"
  | "insufficient_usage"
  | "idempotency_conflict"
  | "service_unavailable";

export class UsageError extends Error {
  readonly code: UsageErrorCode;

  constructor(code: UsageErrorCode, message: string) {
    super(message);
    this.name = "UsageError";
    this.code = code;
  }
}

export function fail(code: UsageErrorCode, message: string): never {
  throw new UsageError(code, message);
}
`;

const referenceKeys = `import { fail } from "./errors.ts";
import type { MeterKey, UsageRequest, UsageScope } from "./types.ts";

export function clean(value: string, field: string): string {
  const result = value.trim();
  if (!result) fail("invalid_input", field + " must not be empty");
  return result;
}

export function units(value: number): number {
  if (!Number.isSafeInteger(value) || value <= 0) fail("invalid_input", "units must be a positive safe integer");
  return value;
}

export function timestamp(value: number): number {
  if (!Number.isFinite(value) || value < 0) fail("invalid_input", "timestamp must be finite and non-negative");
  return value;
}

export function normalizeScope(scope?: UsageScope): UsageScope {
  if (!scope) return { kind: "account", id: "default" };
  if (scope.kind !== "account" && scope.kind !== "project" && scope.kind !== "user") {
    fail("invalid_input", "unknown scope kind");
  }
  return { kind: scope.kind, id: clean(scope.id, "scope id") };
}

export function normalizeKey(input: MeterKey): Required<MeterKey> {
  return {
    accountId: clean(input.accountId, "accountId"),
    metric: clean(input.metric, "metric"),
    scope: normalizeScope(input.scope),
  };
}

export function normalizeRequest(input: UsageRequest, now: number): Required<Omit<UsageRequest, "idempotencyKey">> & { idempotencyKey?: string } {
  const idempotencyKey = input.idempotencyKey === undefined ? undefined : clean(input.idempotencyKey, "idempotencyKey");
  return { ...normalizeKey(input), units: units(input.units), timestamp: timestamp(input.timestamp ?? now), ...(idempotencyKey ? { idempotencyKey } : {}) };
}

export function storageKey(input: MeterKey): string {
  const key = normalizeKey(input);
  return [key.accountId, key.metric, key.scope.kind, key.scope.id].join("\\u0000");
}
`;

const referenceLedger = `import { fail } from "./errors.ts";
import { storageKey } from "./keys.ts";
import type { MeterKey } from "./types.ts";

interface Entry { units: number; timestamp: number }

export class UsageLedger {
  private readonly entries = new Map<string, Entry[]>();
  private readonly keys = new Map<string, Required<MeterKey>>();

  total(key: MeterKey, since = Number.NEGATIVE_INFINITY): number {
    return (this.entries.get(storageKey(key)) ?? [])
      .filter((entry) => entry.timestamp >= since)
      .reduce((sum, entry) => sum + entry.units, 0);
  }

  add(key: Required<MeterKey>, amount: number, at: number): void {
    const id = storageKey(key);
    const entries = this.entries.get(id) ?? [];
    entries.push({ units: amount, timestamp: at });
    this.entries.set(id, entries);
    this.keys.set(id, { ...key, scope: { ...key.scope } });
  }

  remove(key: MeterKey, amount: number, since = Number.NEGATIVE_INFINITY): void {
    const id = storageKey(key);
    const entries = this.entries.get(id) ?? [];
    if (this.total(key, since) < amount) fail("insufficient_usage", "cannot release more usage than was recorded");
    let remaining = amount;
    for (let index = entries.length - 1; index >= 0 && remaining > 0; index--) {
      const entry = entries[index]!;
      if (entry.timestamp < since) continue;
      const removed = Math.min(entry.units, remaining);
      entry.units -= removed;
      remaining -= removed;
      if (entry.units === 0) entries.splice(index, 1);
    }
  }

  snapshot(sinceFor: (metric: string) => number): Array<{ key: Required<MeterKey>; units: number }> {
    const result: Array<{ key: Required<MeterKey>; units: number }> = [];
    for (const [id, key] of this.keys) {
      const amount = this.total(key, sinceFor(key.metric));
      if (amount > 0) result.push({ key: { ...key, scope: { ...key.scope } }, units: amount });
      if (!this.entries.has(id)) this.keys.delete(id);
    }
    return result;
  }
}
`;

const referencePolicy = `import { fail } from "./errors.ts";
import type { LimitSource, MeterHealth, UsageDecision, UsagePlan, UsageRequest } from "./types.ts";

export interface PolicyContext {
  used: number;
  tier?: string;
  override?: number;
  health: MeterHealth;
}

export function validatePlan(plan: UsagePlan): UsagePlan {
  const checkLimits = (limits: Readonly<Record<string, number>>): Record<string, number> => {
    const result: Record<string, number> = {};
    for (const [metric, limit] of Object.entries(limits)) {
      const name = metric.trim();
      if (!name || !Number.isSafeInteger(limit) || limit < 0) fail("invalid_input", "limits must use names and non-negative safe integers");
      result[name] = limit;
    }
    return result;
  };
  if (plan.windowMs !== undefined && (!Number.isSafeInteger(plan.windowMs) || plan.windowMs <= 0)) fail("invalid_input", "windowMs must be positive");
  if (plan.softThresholdRatio !== undefined && (!Number.isFinite(plan.softThresholdRatio) || plan.softThresholdRatio < 0 || plan.softThresholdRatio > 1)) {
    fail("invalid_input", "softThresholdRatio must be between zero and one");
  }
  const tiers: Record<string, { ceilings: Record<string, number> }> = {};
  for (const [name, tier] of Object.entries(plan.tierCeilings ?? {})) tiers[name] = { ceilings: checkLimits(tier.ceilings) };
  return {
    ceilings: checkLimits(plan.ceilings),
    ...(plan.windowMs === undefined ? {} : { windowMs: plan.windowMs }),
    ...(Object.keys(tiers).length === 0 ? {} : { tierCeilings: tiers }),
    ...(plan.burstAllowance ? { burstAllowance: checkLimits(plan.burstAllowance) } : {}),
    ...(plan.softThresholdRatio === undefined ? {} : { softThresholdRatio: plan.softThresholdRatio }),
  };
}

export function baseLimit(plan: UsagePlan, metric: string, tier?: string): { limit?: number; source: LimitSource } {
  const tierLimit = tier === undefined ? undefined : plan.tierCeilings?.[tier]?.ceilings[metric];
  if (tierLimit !== undefined) return { limit: tierLimit, source: "tier" };
  const limit = plan.ceilings[metric];
  return limit === undefined ? { source: "unlimited" } : { limit, source: "plan" };
}

export function evaluateUsage(
  request: Required<Omit<UsageRequest, "idempotencyKey">>,
  plan: UsagePlan,
  context: PolicyContext,
): UsageDecision {
  const base = baseLimit(plan, request.metric, context.tier);
  const configured = context.override ?? base.limit;
  const source: LimitSource = context.override === undefined ? base.source : "override";
  const burst = plan.burstAllowance?.[request.metric] ?? 0;
  const effectiveLimit = configured === undefined ? null : configured + burst;
  const projected = context.used + request.units;
  const healthBlocked = context.health === "down";
  const limitBlocked = effectiveLimit !== null && projected > effectiveLimit;
  const softAt = configured === undefined ? null : configured * (plan.softThresholdRatio ?? 1);
  return {
    accountId: request.accountId,
    metric: request.metric,
    scope: { ...request.scope },
    allowed: !healthBlocked && !limitBlocked,
    units: request.units,
    used: context.used,
    projected,
    limit: configured ?? null,
    effectiveLimit,
    softExceeded: softAt !== null && projected >= softAt,
    degraded: context.health === "degraded",
    source,
    ...(healthBlocked ? { reason: "service_unavailable" as const } : limitBlocked ? { reason: "limit_exceeded" as const } : {}),
  };
}
`;

const referenceMeter = `import { fail } from "./errors.ts";
import { normalizeKey, normalizeRequest, storageKey, timestamp, units } from "./keys.ts";
import { UsageLedger } from "./ledger.ts";
import { baseLimit, evaluateUsage, validatePlan } from "./policy.ts";
import type {
  AuditEvent,
  BatchResult,
  MeterHealth,
  MeterKey,
  MeterSnapshot,
  UsageDecision,
  UsageExplanation,
  UsageMeterOptions,
  UsagePlan,
  UsageRequest,
} from "./types.ts";

interface RequestRecord { fingerprint: string; decision: UsageDecision }

function copyDecision(decision: UsageDecision): UsageDecision {
  return { ...decision, ...(decision.scope ? { scope: { ...decision.scope } } : {}) };
}

export class UsageMeter {
  private readonly ledger = new UsageLedger();
  private readonly plan: UsagePlan;
  private readonly now: () => number;
  private readonly tiers = new Map<string, string>();
  private readonly overrides = new Map<string, number>();
  private readonly requests = new Map<string, RequestRecord>();
  private readonly audit: AuditEvent[] = [];
  private health: MeterHealth = "healthy";
  private nextSequence = 1;

  constructor(options: UsageMeterOptions = {}) {
    this.plan = validatePlan(options.plan ?? { ceilings: {} });
    this.now = options.now ?? Date.now;
  }

  private since(at: number): number {
    return this.plan.windowMs === undefined ? Number.NEGATIVE_INFINITY : at - this.plan.windowMs;
  }

  private tier(accountId: string): string | undefined {
    return this.tiers.get(accountId);
  }

  private override(key: MeterKey): number | undefined {
    return this.overrides.get(storageKey(key));
  }

  private evaluate(request: UsageRequest): { normalized: ReturnType<typeof normalizeRequest>; decision: UsageDecision } {
    const normalized = normalizeRequest(request, timestamp(request.timestamp ?? this.now()));
    const used = this.ledger.total(normalized, this.since(normalized.timestamp));
    const decision = evaluateUsage(normalized, this.plan, {
      used,
      tier: this.tier(normalized.accountId),
      override: this.override(normalized),
      health: this.health,
    });
    return { normalized, decision };
  }

  record(request: UsageRequest): UsageDecision {
    if (request.idempotencyKey !== undefined) return this.recordIdempotent(request);
    const { normalized, decision } = this.evaluate(request);
    if (decision.allowed) this.ledger.add(normalized, normalized.units, normalized.timestamp);
    this.log("record", normalized.timestamp, normalized, decision.allowed);
    return copyDecision(decision);
  }

  preview(request: UsageRequest): UsageDecision {
    return copyDecision(this.evaluate(request).decision);
  }

  usage(key: MeterKey, at = this.now()): number {
    timestamp(at);
    return this.ledger.total(normalizeKey(key), this.since(at));
  }

  remaining(key: MeterKey, at = this.now()): number | null {
    const normalized = normalizeKey(key);
    const configured = this.override(normalized) ?? baseLimit(this.plan, normalized.metric, this.tier(normalized.accountId)).limit;
    if (configured === undefined) return null;
    const effective = configured + (this.plan.burstAllowance?.[normalized.metric] ?? 0);
    return Math.max(0, effective - this.usage(normalized, at));
  }

  release(key: MeterKey, amount: number, at = this.now()): number {
    const normalized = normalizeKey(key);
    const checkedAt = timestamp(at);
    const checkedUnits = units(amount);
    this.ledger.remove(normalized, checkedUnits, this.since(checkedAt));
    this.log("release", checkedAt, { ...normalized, units: checkedUnits }, true);
    return this.ledger.total(normalized, this.since(checkedAt));
  }

  setTier(accountId: string, tier: string): void {
    const account = normalizeKey({ accountId, metric: "_" }).accountId;
    if (!this.plan.tierCeilings?.[tier]) fail("invalid_input", "unknown tier");
    this.tiers.set(account, tier);
  }

  recordIdempotent(request: UsageRequest): UsageDecision {
    const { normalized, decision } = this.evaluate(request);
    if (!normalized.idempotencyKey) fail("invalid_input", "idempotencyKey is required");
    const requestKey = normalized.accountId + "\\u0000" + normalized.idempotencyKey;
    const fingerprint = JSON.stringify({ ...normalized, idempotencyKey: undefined });
    const prior = this.requests.get(requestKey);
    if (prior) {
      if (prior.fingerprint !== fingerprint) fail("idempotency_conflict", "idempotency key was reused with different input");
      return copyDecision(prior.decision);
    }
    if (decision.allowed) this.ledger.add(normalized, normalized.units, normalized.timestamp);
    this.requests.set(requestKey, { fingerprint, decision: copyDecision(decision) });
    this.log("record", normalized.timestamp, normalized, decision.allowed);
    return copyDecision(decision);
  }

  recordBatch(requests: readonly UsageRequest[]): BatchResult {
    const decisions: UsageDecision[] = [];
    const pending = new Map<string, number>();
    const normalizedRequests = requests.map((request) => normalizeRequest(request, timestamp(request.timestamp ?? this.now())));
    for (const request of normalizedRequests) {
      const id = storageKey(request);
      const used = this.ledger.total(request, this.since(request.timestamp)) + (pending.get(id) ?? 0);
      const decision = evaluateUsage(request, this.plan, {
        used,
        tier: this.tier(request.accountId),
        override: this.override(request),
        health: this.health,
      });
      decisions.push(decision);
      if (!decision.allowed) return { allowed: false, decisions: decisions.map(copyDecision) };
      pending.set(id, (pending.get(id) ?? 0) + request.units);
    }
    normalizedRequests.forEach((request) => {
      this.ledger.add(request, request.units, request.timestamp);
      this.log("record", request.timestamp, request, true);
    });
    return { allowed: true, decisions: decisions.map(copyDecision) };
  }

  setOverride(key: MeterKey, limit: number | null, at = this.now()): void {
    const normalized = normalizeKey(key);
    const id = storageKey(normalized);
    if (limit === null) this.overrides.delete(id);
    else {
      if (!Number.isSafeInteger(limit) || limit < 0) fail("invalid_input", "override must be a non-negative safe integer");
      this.overrides.set(id, limit);
    }
    this.log("override", timestamp(at), { ...normalized, units: limit ?? 0 }, true);
  }

  setHealth(health: MeterHealth, at = this.now()): void {
    if (health !== "healthy" && health !== "degraded" && health !== "down") fail("invalid_input", "unknown health");
    this.health = health;
    this.log("health", timestamp(at), undefined, true);
  }

  explain(request: UsageRequest): UsageExplanation {
    const { normalized, decision } = this.evaluate(request);
    const base = baseLimit(this.plan, normalized.metric, this.tier(normalized.accountId));
    return {
      decision: copyDecision(decision),
      windowStart: this.plan.windowMs === undefined ? null : this.since(normalized.timestamp),
      baseLimit: base.limit ?? null,
      burst: this.plan.burstAllowance?.[normalized.metric] ?? 0,
      override: this.override(normalized) ?? null,
      tier: this.tier(normalized.accountId) ?? null,
    };
  }

  auditSnapshot(at = this.now()): MeterSnapshot {
    const checkedAt = timestamp(at);
    return {
      health: this.health,
      usage: this.ledger.snapshot(() => this.since(checkedAt)).map((entry) => ({ key: entry.key, units: entry.units })),
      audit: this.audit.map((event) => ({ ...event })),
    };
  }

  private log(
    type: AuditEvent["type"],
    at: number,
    request?: MeterKey & { units?: number },
    allowed?: boolean,
  ): void {
    this.audit.push({
      sequence: this.nextSequence++,
      type,
      timestamp: at,
      ...(request ? { accountId: request.accountId, metric: request.metric, units: request.units } : {}),
      ...(allowed === undefined ? {} : { allowed }),
    });
  }
}
`;

const referenceIndex = `export * from "./types.ts";
export * from "./errors.ts";
export * from "./keys.ts";
export * from "./policy.ts";
export * from "./meter.ts";
`;

const referenceSources = {
	"src/types.ts": referenceTypes,
	"src/errors.ts": referenceErrors,
	"src/keys.ts": referenceKeys,
	"src/ledger.ts": referenceLedger,
	"src/policy.ts": referencePolicy,
	"src/meter.ts": referenceMeter,
	"src/index.ts": referenceIndex,
};

export const usageMetering: EvalTarget = {
	id: "usage-metering",
	title: "Usage and quota metering",
	files: projectFiles(seedSources),
	referenceFiles: projectFiles(referenceSources),
	publicVerify: ["npm test"],
	steps: [
		{
			id: "base-recording",
			title: "Record metered usage",
			prompt:
				"Implement UsageMeter.record(request: UsageRequest): UsageDecision, preview(request), usage(key), and remaining(key). Usage is isolated by accountId and metric. Positive safe-integer units that keep projected usage at or below UsagePlan.ceilings[metric] are recorded; over-limit decisions return allowed false with reason 'limit_exceeded' and do not mutate usage. Missing ceilings are unlimited. Preserve exported types, validation, and Node strip-types compatibility.",
			publicTest: `test("records accepted units and rejects an overage without mutation", () => {
  const meter = new subject.UsageMeter({ plan: { ceilings: { api: 3 } } });
  assert.equal(meter.record({ accountId: "a", metric: "api", units: 2, timestamp: 1 }).allowed, true);
  assert.equal(meter.record({ accountId: "a", metric: "api", units: 2, timestamp: 2 }).reason, "limit_exceeded");
  assert.equal(meter.usage({ accountId: "a", metric: "api" }, 2), 2);
  assert.equal(meter.remaining({ accountId: "a", metric: "api" }, 2), 1);
});`,
			hiddenTest: `test("base metering isolates keys and accepts the exact ceiling", () => {
  const meter = new subject.UsageMeter({ plan: { ceilings: { api: 2 } } });
  assert.equal(meter.record({ accountId: "a", metric: "api", units: 2, timestamp: 1 }).allowed, true);
  assert.equal(meter.usage({ accountId: "b", metric: "api" }, 1), 0);
  assert.equal(meter.preview({ accountId: "a", metric: "other", units: 99, timestamp: 1 }).limit, null);
});`,
		},
		{
			id: "usage-release",
			title: "Release recorded usage",
			prompt:
				"Add UsageMeter.release(key: MeterKey, units: number, at?: number): number. It removes the newest matching recorded units first and returns current usage. Releasing a non-positive/non-integer amount throws 'invalid_input'; releasing more than recorded throws 'insufficient_usage' without mutation. Keep record, preview, usage, remaining, decision shapes, and unlimited behavior compatible.",
			publicTest: `test("release restores quota", () => {
  const meter = new subject.UsageMeter({ plan: { ceilings: { api: 3 } } });
  meter.record({ accountId: "a", metric: "api", units: 3, timestamp: 1 });
  assert.equal(meter.release({ accountId: "a", metric: "api" }, 2, 2), 1);
  assert.equal(meter.record({ accountId: "a", metric: "api", units: 2, timestamp: 2 }).allowed, true);
});`,
			hiddenTest: `test("failed release preserves usage", () => {
  const meter = new subject.UsageMeter();
  meter.record({ accountId: "a", metric: "api", units: 1, timestamp: 1 });
  assert.throws(() => meter.release({ accountId: "a", metric: "api" }, 2, 2), (error: any) => error.code === "insufficient_usage");
  assert.equal(meter.usage({ accountId: "a", metric: "api" }, 2), 1);
});`,
		},
		{
			id: "rolling-windows",
			title: "Apply rolling usage windows",
			prompt:
				"Add UsagePlan.windowMs?: number. When configured, record, preview, usage, remaining, and release count entries with timestamp >= at - windowMs; the boundary is inclusive. Request timestamps default to the injected UsageMeterOptions.now function. windowMs must be a positive safe integer and timestamps finite and non-negative. Preserve unwindowed behavior when omitted.",
			publicTest: `test("expires usage outside the rolling window", () => {
  const meter = new subject.UsageMeter({ plan: { ceilings: { api: 2 }, windowMs: 10 }, now: () => 20 });
  meter.record({ accountId: "a", metric: "api", units: 2, timestamp: 5 });
  assert.equal(meter.usage({ accountId: "a", metric: "api" }, 20), 0);
  assert.equal(meter.record({ accountId: "a", metric: "api", units: 2 }).allowed, true);
});`,
			hiddenTest: `test("includes the exact rolling-window boundary", () => {
  const meter = new subject.UsageMeter({ plan: { ceilings: { api: 2 }, windowMs: 10 } });
  meter.record({ accountId: "a", metric: "api", units: 1, timestamp: 10 });
  assert.equal(meter.usage({ accountId: "a", metric: "api" }, 20), 1);
  assert.equal(meter.usage({ accountId: "a", metric: "api" }, 21), 0);
});`,
		},
		{
			id: "scoped-usage",
			title: "Isolate usage scopes",
			prompt:
				"Extend MeterKey and UsageRequest with scope?: { kind: 'account' | 'project' | 'user'; id: string }. Omitted scope normalizes to { kind: 'account', id: 'default' }. Every record, preview, release, usage, and remaining operation must isolate scope kind and id while preserving account and metric isolation. Decisions include a defensive normalized scope.",
			publicTest: `test("isolates project scopes", () => {
  const meter = new subject.UsageMeter({ plan: { ceilings: { api: 2 } } });
  meter.record({ accountId: "a", metric: "api", scope: { kind: "project", id: "p1" }, units: 2, timestamp: 1 });
  assert.equal(meter.usage({ accountId: "a", metric: "api", scope: { kind: "project", id: "p2" } }, 1), 0);
});`,
			hiddenTest: `test("normalizes omitted scope without colliding with named account scope", () => {
  const meter = new subject.UsageMeter();
  const decision = meter.record({ accountId: "a", metric: "api", units: 1, timestamp: 1 });
  assert.deepEqual(decision.scope, { kind: "account", id: "default" });
  assert.equal(meter.usage({ accountId: "a", metric: "api", scope: { kind: "account", id: "other" } }, 1), 0);
});`,
		},
		{
			id: "tier-ceilings",
			title: "Select account tier ceilings",
			prompt:
				"Add UsagePlan.tierCeilings?: Record<string, { ceilings: Record<string, number> }> and UsageMeter.setTier(accountId: string, tier: string): void. A configured tier ceiling replaces the base ceiling for that account and metric; metrics absent from the tier fall back to the base plan. Unknown tiers throw 'invalid_input'. Existing recorded usage is immediately evaluated under the new tier.",
			publicTest: `test("uses account tier ceilings with base fallback", () => {
  const meter = new subject.UsageMeter({ plan: { ceilings: { api: 2, files: 1 }, tierCeilings: { pro: { ceilings: { api: 5 } } } } });
  meter.setTier("a", "pro");
  assert.equal(meter.record({ accountId: "a", metric: "api", units: 5, timestamp: 1 }).allowed, true);
  assert.equal(meter.record({ accountId: "a", metric: "files", units: 2, timestamp: 1 }).allowed, false);
});`,
			hiddenTest: `test("tier changes apply to existing usage", () => {
  const meter = new subject.UsageMeter({ plan: { ceilings: { api: 5 }, tierCeilings: { small: { ceilings: { api: 2 } } } } });
  meter.record({ accountId: "a", metric: "api", units: 3, timestamp: 1 });
  meter.setTier("a", "small");
  assert.equal(meter.remaining({ accountId: "a", metric: "api" }, 1), 0);
});`,
		},
		{
			id: "burst-allowance",
			title: "Allow bounded bursts",
			prompt:
				"Add UsagePlan.burstAllowance?: Record<string, number>. The non-negative allowance extends the selected base/tier ceiling for allowed decisions and remaining, while UsageDecision.limit remains the selected ceiling and effectiveLimit includes burst. Unlimited metrics remain unlimited. Apply identical rules to record, preview, usage decisions, and remaining without changing prior signatures.",
			publicTest: `test("allows usage through the burst ceiling", () => {
  const meter = new subject.UsageMeter({ plan: { ceilings: { api: 2 }, burstAllowance: { api: 1 } } });
  const decision = meter.record({ accountId: "a", metric: "api", units: 3, timestamp: 1 });
  assert.equal(decision.allowed, true);
  assert.equal(decision.limit, 2);
  assert.equal(decision.effectiveLimit, 3);
});`,
			hiddenTest: `test("rejects one unit past burst and reports zero remaining", () => {
  const meter = new subject.UsageMeter({ plan: { ceilings: { api: 2 }, burstAllowance: { api: 1 } } });
  meter.record({ accountId: "a", metric: "api", units: 3, timestamp: 1 });
  assert.equal(meter.preview({ accountId: "a", metric: "api", units: 1, timestamp: 1 }).allowed, false);
  assert.equal(meter.remaining({ accountId: "a", metric: "api" }, 1), 0);
});`,
		},
		{
			id: "idempotent-recording",
			title: "Deduplicate usage records",
			prompt:
				"Add UsageRequest.idempotencyKey?: string and UsageMeter.recordIdempotent(request): UsageDecision. Keys are scoped per account. A retry with the same normalized request returns the original decision without recording or auditing again; reuse with different metric, scope, units, or timestamp throws 'idempotency_conflict'. record(request) must use this behavior when a key is present. Preserve all shared tier, window, and burst policy rules.",
			publicTest: `test("does not double count an idempotent retry", () => {
  const meter = new subject.UsageMeter({ plan: { ceilings: { api: 5 } } });
  const request = { accountId: "a", metric: "api", units: 2, timestamp: 1, idempotencyKey: "r1" };
  assert.deepEqual(meter.record(request), meter.record(request));
  assert.equal(meter.usage({ accountId: "a", metric: "api" }, 1), 2);
});`,
			hiddenTest: `test("rejects conflicting idempotency input but isolates accounts", () => {
  const meter = new subject.UsageMeter();
  meter.recordIdempotent({ accountId: "a", metric: "api", units: 1, timestamp: 1, idempotencyKey: "r" });
  assert.throws(() => meter.recordIdempotent({ accountId: "a", metric: "api", units: 2, timestamp: 1, idempotencyKey: "r" }), (error: any) => error.code === "idempotency_conflict");
  assert.equal(meter.recordIdempotent({ accountId: "b", metric: "api", units: 1, timestamp: 1, idempotencyKey: "r" }).allowed, true);
});`,
		},
		{
			id: "soft-thresholds",
			title: "Report soft quota thresholds",
			prompt:
				"Add UsagePlan.softThresholdRatio?: number from 0 through 1 and UsageDecision.softExceeded. For limited metrics, softExceeded is true when projected usage is greater than or equal to selected limit times the ratio, independent of burst allowance and even when the hard decision is denied. Unlimited metrics report false. Apply this through the same record, preview, and idempotent decision path.",
			publicTest: `test("reports the inclusive soft threshold without blocking", () => {
  const meter = new subject.UsageMeter({ plan: { ceilings: { api: 10 }, softThresholdRatio: 0.8 } });
  const decision = meter.record({ accountId: "a", metric: "api", units: 8, timestamp: 1 });
  assert.equal(decision.allowed, true);
  assert.equal(decision.softExceeded, true);
});`,
			hiddenTest: `test("soft threshold uses base limit rather than burst ceiling", () => {
  const meter = new subject.UsageMeter({ plan: { ceilings: { api: 10 }, burstAllowance: { api: 5 }, softThresholdRatio: 0.8 } });
  assert.equal(meter.preview({ accountId: "a", metric: "api", units: 8, timestamp: 1 }).softExceeded, true);
  assert.equal(meter.preview({ accountId: "a", metric: "other", units: 999, timestamp: 1 }).softExceeded, false);
});`,
		},
		{
			id: "atomic-batches",
			title: "Record atomic usage batches",
			prompt:
				"Add UsageMeter.recordBatch(requests: readonly UsageRequest[]): BatchResult. Evaluate requests in order, including earlier pending units for the same normalized key. If any decision is denied, return allowed false and the decisions through the failure without recording or auditing any item. Otherwise record all and return allowed true. Inputs remain unchanged and every existing window, scope, tier, burst, and soft-threshold rule applies.",
			publicTest: `test("records a fully allowed batch", () => {
  const meter = new subject.UsageMeter({ plan: { ceilings: { api: 3 } } });
  const result = meter.recordBatch([
    { accountId: "a", metric: "api", units: 1, timestamp: 1 },
    { accountId: "a", metric: "api", units: 2, timestamp: 1 },
  ]);
  assert.equal(result.allowed, true);
  assert.equal(meter.usage({ accountId: "a", metric: "api" }, 1), 3);
});`,
			hiddenTest: `test("failed batch is atomic and accounts for pending units", () => {
  const meter = new subject.UsageMeter({ plan: { ceilings: { api: 2 } } });
  const result = meter.recordBatch([
    { accountId: "a", metric: "api", units: 2, timestamp: 1 },
    { accountId: "a", metric: "api", units: 1, timestamp: 1 },
  ]);
  assert.equal(result.allowed, false);
  assert.equal(meter.usage({ accountId: "a", metric: "api" }, 1), 0);
});`,
		},
		{
			id: "admin-overrides",
			title: "Apply scoped admin overrides",
			prompt:
				"Add UsageMeter.setOverride(key: MeterKey, limit: number | null, at?: number): void. A non-negative safe-integer override replaces the selected plan/tier ceiling for that exact account, metric, and scope; burst and soft-threshold rules then use the override as their base. null removes it. UsageDecision.source is 'override', 'tier', 'plan', or 'unlimited'. Existing usage is not changed.",
			publicTest: `test("applies and removes an exact scoped override", () => {
  const meter = new subject.UsageMeter({ plan: { ceilings: { api: 2 } } });
  const key = { accountId: "a", metric: "api", scope: { kind: "project" as const, id: "p" } };
  meter.setOverride(key, 4, 1);
  assert.equal(meter.record({ ...key, units: 4, timestamp: 1 }).source, "override");
  meter.setOverride(key, null, 2);
  assert.equal(meter.preview({ ...key, units: 1, timestamp: 2 }).allowed, false);
});`,
			hiddenTest: `test("override does not leak across scopes and composes with burst", () => {
  const meter = new subject.UsageMeter({ plan: { ceilings: { api: 2 }, burstAllowance: { api: 1 } } });
  meter.setOverride({ accountId: "a", metric: "api", scope: { kind: "user", id: "u1" } }, 4, 1);
  assert.equal(meter.preview({ accountId: "a", metric: "api", scope: { kind: "user", id: "u1" }, units: 5, timestamp: 1 }).allowed, true);
  assert.equal(meter.preview({ accountId: "a", metric: "api", scope: { kind: "user", id: "u2" }, units: 4, timestamp: 1 }).allowed, false);
});`,
		},
		{
			id: "meter-health",
			title: "Handle degraded metering health",
			prompt:
				"Add MeterHealth = 'healthy' | 'degraded' | 'down' and UsageMeter.setHealth(health, at?). Healthy and degraded use all normal policy rules; degraded decisions are marked degraded true but may record. Down makes record, preview, idempotent, and batch decisions denied with reason 'service_unavailable' and no usage mutation. release remains available. Preserve decision precedence and prior APIs.",
			publicTest: `test("marks degraded decisions but still records", () => {
  const meter = new subject.UsageMeter();
  meter.setHealth("degraded", 1);
  const decision = meter.record({ accountId: "a", metric: "api", units: 1, timestamp: 1 });
  assert.equal(decision.allowed, true);
  assert.equal(decision.degraded, true);
});`,
			hiddenTest: `test("down mode blocks batches without mutation while release works", () => {
  const meter = new subject.UsageMeter();
  meter.record({ accountId: "a", metric: "api", units: 2, timestamp: 1 });
  meter.setHealth("down", 2);
  const result = meter.recordBatch([{ accountId: "a", metric: "api", units: 1, timestamp: 2 }]);
  assert.equal(result.decisions[0]?.reason, "service_unavailable");
  assert.equal(meter.release({ accountId: "a", metric: "api" }, 1, 2), 1);
});`,
		},
		{
			id: "explanation-audit",
			title: "Explain and snapshot metering",
			prompt:
				"Add UsageMeter.explain(request): UsageExplanation and auditSnapshot(at?): MeterSnapshot. explain exposes the exact shared decision plus windowStart, selected baseLimit, burst, exact-scope override, and tier. auditSnapshot returns health, current in-window usage, and successful/denied record plus release/override/health events in sequence order. Idempotent retries and failed atomic batches add no events. All returned nested state is defensive.",
			publicTest: `test("explanation matches preview and snapshot exposes ordered audit", () => {
  const meter = new subject.UsageMeter({ plan: { ceilings: { api: 2 }, burstAllowance: { api: 1 }, windowMs: 10 } });
  meter.record({ accountId: "a", metric: "api", units: 2, timestamp: 5 });
  const request = { accountId: "a", metric: "api", units: 1, timestamp: 6 };
  assert.deepEqual(meter.explain(request).decision, meter.preview(request));
  assert.deepEqual(meter.auditSnapshot(6).audit.map((event: any) => event.type), ["record"]);
});`,
			hiddenTest: `test("snapshot is defensive and excludes retry and failed-batch events", () => {
  const meter = new subject.UsageMeter({ plan: { ceilings: { api: 1 } } });
  const request = { accountId: "a", metric: "api", units: 1, timestamp: 1, idempotencyKey: "r" };
  meter.record(request); meter.record(request);
  meter.recordBatch([{ accountId: "a", metric: "api", units: 1, timestamp: 1 }]);
  const snapshot = meter.auditSnapshot(1);
  assert.equal(snapshot.audit.length, 1);
  (snapshot.audit[0] as any).type = "health";
  assert.equal(meter.auditSnapshot(1).audit[0]?.type, "record");
});`,
		},
	],
};
