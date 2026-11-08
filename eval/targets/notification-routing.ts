import type { EvalTarget } from "./types.js";

const packageJson = `${JSON.stringify(
	{
		name: "eval-notification-routing",
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

const seedTypes = `export const CHANNELS = ["email", "sms", "push", "inApp"] as const;

export type Channel = (typeof CHANNELS)[number];
export type Urgency = "low" | "normal" | "high" | "critical";
export type Capability = "text" | "rich" | "attachment" | "action";

export interface Notification {
  id: string;
  userId: string;
  topic: string;
  urgency?: Urgency;
}

export interface NotificationContent {
  subject?: string;
  text: string;
  html?: string;
  attachmentIds?: readonly string[];
  actionUrl?: string;
}

export interface NotificationEnvelope {
  notification: Notification;
  content: NotificationContent;
  createdAt: number;
}

export interface QuietHours {
  start: number;
  end: number;
}

export interface ChannelAddress {
  channel: Channel;
  value: string;
  verified: boolean;
}

export interface UserRoutingProfile {
  channelOrder?: readonly Channel[];
  disabledChannels?: readonly Channel[];
}

export interface RoutingContext {
  availableChannels: readonly Channel[];
  profile?: UserRoutingProfile;
}

export interface ChannelDefinition {
  channel: Channel;
  capabilities: readonly Capability[];
  disruptive: boolean;
}

export interface Candidate {
  channel: Channel;
  available: boolean;
  disabled: boolean;
}

export interface CandidateSet {
  eligible: readonly Candidate[];
  rejected: readonly Candidate[];
}

export interface RoutingSnapshot {
  notificationId: string;
  candidates: readonly Candidate[];
  rankedChannels: readonly Channel[];
  selected: Channel | null;
}

export interface RouteManyResult {
  notificationId: string;
  selected: Channel | null;
}

export const DEFAULT_CHANNEL_ORDER: readonly Channel[] = ["email", "push", "sms", "inApp"];
`;

const seedCatalog = `import type { Capability, Channel, ChannelDefinition } from "./types.ts";

const DEFINITIONS: Readonly<Record<Channel, ChannelDefinition>> = {
  email: {
    channel: "email",
    capabilities: ["text", "rich", "attachment", "action"],
    disruptive: false,
  },
  sms: {
    channel: "sms",
    capabilities: ["text"],
    disruptive: true,
  },
  push: {
    channel: "push",
    capabilities: ["text", "rich", "action"],
    disruptive: true,
  },
  inApp: {
    channel: "inApp",
    capabilities: ["text", "rich", "attachment", "action"],
    disruptive: false,
  },
};

export function channelDefinition(channel: Channel): ChannelDefinition {
  return DEFINITIONS[channel];
}

export function defaultCapabilities(channel: Channel): readonly Capability[] {
  return channelDefinition(channel).capabilities;
}

export function isDisruptive(channel: Channel): boolean {
  return channelDefinition(channel).disruptive;
}

export function knownChannels(): Channel[] {
  return Object.keys(DEFINITIONS) as Channel[];
}

export function channelsWithCapability(capability: Capability): Channel[] {
  return knownChannels().filter((channel) => defaultCapabilities(channel).includes(capability));
}

export function disruptiveChannels(): Channel[] {
  return knownChannels().filter(isDisruptive);
}

export function passiveChannels(): Channel[] {
  return knownChannels().filter((channel) => !isDisruptive(channel));
}

export function catalogSnapshot(): ChannelDefinition[] {
  return knownChannels().map((channel) => ({
    ...channelDefinition(channel),
    capabilities: [...channelDefinition(channel).capabilities],
  }));
}
`;

const seedValidation = `import { CHANNELS } from "./types.ts";
import type { Channel, Notification } from "./types.ts";

export function assertNotification(notification: Notification): void {
  if (notification.id.trim().length === 0) {
    throw new Error("notification id is required");
  }
  if (notification.userId.trim().length === 0) {
    throw new Error("notification userId is required");
  }
  if (notification.topic.trim().length === 0) {
    throw new Error("notification topic is required");
  }
}

export function assertNonEmpty(value: string, field: string): void {
  if (value.trim().length === 0) {
    throw new Error(\`\${field} is required\`);
  }
}

export function assertFiniteTimestamp(value: number, field: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(\`\${field} must be a non-negative timestamp\`);
  }
}

export function isChannel(value: string): value is Channel {
  return (CHANNELS as readonly string[]).includes(value);
}

export function uniqueChannels(channels: readonly Channel[]): Channel[] {
  const seen = new Set<Channel>();
  const result: Channel[] = [];
  for (const channel of channels) {
    if (!seen.has(channel)) {
      seen.add(channel);
      result.push(channel);
    }
  }
  return result;
}

export function sameChannels(left: readonly Channel[], right: readonly Channel[]): boolean {
  if (left.length !== right.length) return false;
  return left.every((channel, index) => channel === right[index]);
}

export function assertKnownChannels(channels: readonly string[]): asserts channels is readonly Channel[] {
  const unknown = channels.find((channel) => !isChannel(channel));
  if (unknown) {
    throw new Error(\`unknown channel: \${unknown}\`);
  }
}

export function copyRecord<T>(record: Readonly<Partial<Record<Channel, T>>>): Partial<Record<Channel, T>> {
  const copy: Partial<Record<Channel, T>> = {};
  for (const channel of CHANNELS) {
    const value = record[channel];
    if (value !== undefined) copy[channel] = value;
  }
  return copy;
}

export function assertHour(hour: number): void {
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) {
    throw new RangeError("hour must be an integer from 0 through 23");
  }
}
`;

const seedCapabilities = `import { defaultCapabilities } from "./catalog.ts";
import type { Capability, Channel } from "./types.ts";

export function supportsCapabilities(
  channel: Channel,
  required: readonly Capability[],
  available: readonly Capability[] = defaultCapabilities(channel),
): boolean {
  const supported = new Set(available);
  return required.every((capability) => supported.has(capability));
}

export function missingCapabilities(
  channel: Channel,
  required: readonly Capability[],
  available: readonly Capability[] = defaultCapabilities(channel),
): Capability[] {
  const supported = new Set(available);
  return required.filter((capability) => !supported.has(capability));
}

export function requiredCapabilitiesForContent(content: {
  html?: string;
  attachmentIds?: readonly string[];
  actionUrl?: string;
}): Capability[] {
  const required: Capability[] = ["text"];
  if (content.html) required.push("rich");
  if ((content.attachmentIds?.length ?? 0) > 0) required.push("attachment");
  if (content.actionUrl) required.push("action");
  return required;
}

export function capableChannels(
  channels: readonly Channel[],
  required: readonly Capability[],
): Channel[] {
  return channels.filter((channel) => supportsCapabilities(channel, required));
}

export function capabilityCoverage(channel: Channel, required: readonly Capability[]): number {
  if (required.length === 0) return 1;
  const missing = missingCapabilities(channel, required);
  return (required.length - missing.length) / required.length;
}
`;

const seedPreferences = `import { DEFAULT_CHANNEL_ORDER } from "./types.ts";
import type { Channel, UserRoutingProfile } from "./types.ts";
import { uniqueChannels } from "./validation.ts";

export function preferenceOrder(profile?: UserRoutingProfile): Channel[] {
  const configured = profile?.channelOrder ?? [];
  return uniqueChannels([...configured, ...DEFAULT_CHANNEL_ORDER]);
}

export function isProfileDisabled(channel: Channel, profile?: UserRoutingProfile): boolean {
  return profile?.disabledChannels?.includes(channel) ?? false;
}

export function preferenceIndex(channel: Channel, profile?: UserRoutingProfile): number {
  const index = preferenceOrder(profile).indexOf(channel);
  return index < 0 ? Number.MAX_SAFE_INTEGER : index;
}

export function compareByPreference(left: Channel, right: Channel, profile?: UserRoutingProfile): number {
  return preferenceIndex(left, profile) - preferenceIndex(right, profile);
}

export function sortByPreference(channels: readonly Channel[], profile?: UserRoutingProfile): Channel[] {
  return [...channels].sort((left, right) => compareByPreference(left, right, profile));
}

export function preferredAvailable(
  available: readonly Channel[],
  profile?: UserRoutingProfile,
): Channel | null {
  const availableSet = new Set(available);
  return preferenceOrder(profile).find((channel) => availableSet.has(channel) && !isProfileDisabled(channel, profile)) ?? null;
}

export function mergeChannelOrder(primary: readonly Channel[], fallback: readonly Channel[]): Channel[] {
  return uniqueChannels([...primary, ...fallback]);
}
`;

const seedFilters = `import type { Candidate, Channel, RoutingContext } from "./types.ts";
import { isProfileDisabled } from "./preferences.ts";

export function candidateFor(channel: Channel, context: RoutingContext): Candidate {
  return {
    channel,
    available: context.availableChannels.includes(channel),
    disabled: isProfileDisabled(channel, context.profile),
  };
}

export function isEligible(candidate: Candidate): boolean {
  return candidate.available && !candidate.disabled;
}

export function eligibleChannels(channels: readonly Channel[], context: RoutingContext): Channel[] {
  return channels.filter((channel) => isEligible(candidateFor(channel, context)));
}

export function candidatesFor(channels: readonly Channel[], context: RoutingContext): Candidate[] {
  return channels.map((channel) => candidateFor(channel, context));
}

export function partitionCandidates(candidates: readonly Candidate[]): {
  eligible: Candidate[];
  rejected: Candidate[];
} {
  const eligible: Candidate[] = [];
  const rejected: Candidate[] = [];
  for (const candidate of candidates) {
    (isEligible(candidate) ? eligible : rejected).push(candidate);
  }
  return { eligible, rejected };
}

export function rejectedChannels(channels: readonly Channel[], context: RoutingContext): Channel[] {
  return candidatesFor(channels, context)
    .filter((candidate) => !isEligible(candidate))
    .map((candidate) => candidate.channel);
}

export function hasEligibleChannel(channels: readonly Channel[], context: RoutingContext): boolean {
  return channels.some((channel) => isEligible(candidateFor(channel, context)));
}
`;

const seedRouter = `import { eligibleChannels } from "./filters.ts";
import { preferenceOrder } from "./preferences.ts";
import type { Candidate, Channel, Notification, RoutingContext } from "./types.ts";
import { assertNotification, uniqueChannels } from "./validation.ts";

export function rankChannels(notification: Notification, context: RoutingContext): Channel[] {
  assertNotification(notification);
  const available = uniqueChannels(context.availableChannels);
  const preferred = preferenceOrder(context.profile);
  const eligible = new Set(eligibleChannels(available, context));
  return preferred.filter((channel) => eligible.has(channel));
}

export function routeNotification(notification: Notification, context: RoutingContext): Channel | null {
  return rankChannels(notification, context)[0] ?? null;
}

export function routeNotifications(
  notifications: readonly Notification[],
  context: RoutingContext,
): Array<{ notificationId: string; selected: Channel | null }> {
  return notifications.map((notification) => ({
    notificationId: notification.id,
    selected: routeNotification(notification, context),
  }));
}

export function routingSnapshot(notification: Notification, context: RoutingContext): {
  notificationId: string;
  candidates: Candidate[];
  rankedChannels: Channel[];
  selected: Channel | null;
} {
  const rankedChannels = rankChannels(notification, context);
  const candidates = context.availableChannels.map((channel) => ({
    channel,
    available: true,
    disabled: context.profile?.disabledChannels?.includes(channel) ?? false,
  }));
  return {
    notificationId: notification.id,
    candidates,
    rankedChannels,
    selected: rankedChannels[0] ?? null,
  };
}
`;

const seedIndex = `export * from "./types.ts";
export * from "./catalog.ts";
export * from "./capabilities.ts";
export * from "./preferences.ts";
export * from "./filters.ts";
export * from "./router.ts";
`;

const seedPublicTest = `import test from "node:test";
import assert from "node:assert/strict";
import { rankChannels, routeNotification } from "../src/index.ts";

test("routes a valid notification through the default channel order", () => {
  const notification = { id: "n-1", userId: "u-1", topic: "invoice.ready" };
  const context = { availableChannels: ["sms", "email"] as const };
  assert.equal(routeNotification(notification, context), "email");
  assert.deepEqual(rankChannels(notification, context), ["email", "sms"]);
});

test("ignores unavailable defaults and profile-disabled channels", () => {
  const notification = { id: "n-2", userId: "u-1", topic: "security.alert" };
  const context = {
    availableChannels: ["push", "sms"] as const,
    profile: { disabledChannels: ["push"] as const },
  };
  assert.equal(routeNotification(notification, context), "sms");
});
`;

const readme = `# Notification routing evaluation

Implement only the current iteration's requirement. Preserve all documented compatibility and run \`npm test\` before finishing.
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
	"src/catalog.ts": seedCatalog,
	"src/validation.ts": seedValidation,
	"src/capabilities.ts": seedCapabilities,
	"src/preferences.ts": seedPreferences,
	"src/filters.ts": seedFilters,
	"src/router.ts": seedRouter,
	"src/index.ts": seedIndex,
};

const referenceTypes = `export const CHANNELS = ["email", "sms", "push", "inApp"] as const;

export type Channel = (typeof CHANNELS)[number];
export type Urgency = "low" | "normal" | "high" | "critical";
export type Capability = "text" | "rich" | "attachment" | "action";
export type Health = "up" | "degraded" | "down";
export type ExclusionReason =
  | "unavailable"
  | "disabled"
  | "incapable"
  | "opted-out"
  | "quiet-hours"
  | "rate-limited"
  | "provider-down";

export interface Notification {
  id: string;
  userId: string;
  topic: string;
  urgency?: Urgency;
  requiredCapabilities?: readonly Capability[];
}

export interface NotificationContent {
  subject?: string;
  text: string;
  html?: string;
  attachmentIds?: readonly string[];
  actionUrl?: string;
}

export interface NotificationEnvelope {
  notification: Notification;
  content: NotificationContent;
  createdAt: number;
}

export interface QuietHours {
  start: number;
  end: number;
}

export interface ChannelAddress {
  channel: Channel;
  value: string;
  verified: boolean;
}

export interface UserRoutingProfile {
  channelOrder?: readonly Channel[];
  disabledChannels?: readonly Channel[];
  topicOptIns?: Readonly<Partial<Record<string, readonly Channel[]>>>;
  quietHours?: QuietHours;
}

export interface RoutingPolicy {
  disabledChannels?: readonly Channel[];
  forcedChannelByUrgency?: Readonly<Partial<Record<Urgency, Channel>>>;
  channelLimits?: Readonly<Partial<Record<Channel, number>>>;
}

export interface RoutingContext {
  availableChannels: readonly Channel[];
  profile?: UserRoutingProfile;
  capabilities?: Readonly<Partial<Record<Channel, readonly Capability[]>>>;
  localHour?: number;
  policy?: RoutingPolicy;
  usage?: Readonly<Partial<Record<Channel, number>>>;
  health?: Readonly<Partial<Record<Channel, Health>>>;
}

export interface ChannelDefinition {
  channel: Channel;
  capabilities: readonly Capability[];
  disruptive: boolean;
}

export interface Candidate {
  channel: Channel;
  available: boolean;
  disabled: boolean;
}

export interface CandidateSet {
  eligible: readonly Candidate[];
  rejected: readonly Candidate[];
}

export interface RoutingSnapshot {
  notificationId: string;
  candidates: readonly Candidate[];
  rankedChannels: readonly Channel[];
  selected: Channel | null;
}

export interface RouteManyResult {
  notificationId: string;
  selected: Channel | null;
}

export interface ChannelEvaluation {
  channel: Channel;
  eligible: boolean;
  reason?: ExclusionReason;
  health: Health;
}

export interface DeliveryPlan {
  attempts: Channel[];
  selected: Channel | null;
}

export interface RoutingExplanation extends DeliveryPlan {
  excluded: Partial<Record<Channel, ExclusionReason>>;
  evaluations: ChannelEvaluation[];
}

export interface BatchDecision extends DeliveryPlan {
  notificationId: string;
  suppressionReason?: "suppressed" | "duplicate";
}

export const DEFAULT_CHANNEL_ORDER: readonly Channel[] = ["email", "push", "sms", "inApp"];
`;

const referenceCatalog = `import type { Capability, Channel, ChannelDefinition, Health, RoutingContext } from "./types.ts";

const DEFINITIONS: Readonly<Record<Channel, ChannelDefinition>> = {
  email: { channel: "email", capabilities: ["text", "rich", "attachment", "action"], disruptive: false },
  sms: { channel: "sms", capabilities: ["text"], disruptive: true },
  push: { channel: "push", capabilities: ["text", "rich", "action"], disruptive: true },
  inApp: { channel: "inApp", capabilities: ["text", "rich", "attachment", "action"], disruptive: false },
};

export function channelDefinition(channel: Channel): ChannelDefinition {
  return DEFINITIONS[channel];
}

export function defaultCapabilities(channel: Channel): readonly Capability[] {
  return channelDefinition(channel).capabilities;
}

export function isDisruptive(channel: Channel): boolean {
  return channelDefinition(channel).disruptive;
}

export function channelHealth(channel: Channel, context: RoutingContext): Health {
  return context.health?.[channel] ?? "up";
}

export function knownChannels(): Channel[] {
  return Object.keys(DEFINITIONS) as Channel[];
}

export function channelsWithCapability(capability: Capability): Channel[] {
  return knownChannels().filter((channel) => defaultCapabilities(channel).includes(capability));
}

export function disruptiveChannels(): Channel[] {
  return knownChannels().filter(isDisruptive);
}

export function passiveChannels(): Channel[] {
  return knownChannels().filter((channel) => !isDisruptive(channel));
}

export function catalogSnapshot(): ChannelDefinition[] {
  return knownChannels().map((channel) => ({
    ...channelDefinition(channel),
    capabilities: [...channelDefinition(channel).capabilities],
  }));
}
`;

const referenceValidation = `import { CHANNELS } from "./types.ts";
import type { Channel, Notification } from "./types.ts";

export function assertNotification(notification: Notification): void {
  if (notification.id.trim().length === 0) throw new Error("notification id is required");
  if (notification.userId.trim().length === 0) throw new Error("notification userId is required");
  if (notification.topic.trim().length === 0) throw new Error("notification topic is required");
}

export function assertNonEmpty(value: string, field: string): void {
  if (value.trim().length === 0) throw new Error(\`\${field} is required\`);
}

export function assertFiniteTimestamp(value: number, field: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(\`\${field} must be a non-negative timestamp\`);
  }
}

export function isChannel(value: string): value is Channel {
  return (CHANNELS as readonly string[]).includes(value);
}

export function uniqueChannels(channels: readonly Channel[]): Channel[] {
  return [...new Set(channels)];
}

export function sameChannels(left: readonly Channel[], right: readonly Channel[]): boolean {
  return left.length === right.length && left.every((channel, index) => channel === right[index]);
}

export function assertKnownChannels(channels: readonly string[]): asserts channels is readonly Channel[] {
  const unknown = channels.find((channel) => !isChannel(channel));
  if (unknown) throw new Error(\`unknown channel: \${unknown}\`);
}

export function copyRecord<T>(record: Readonly<Partial<Record<Channel, T>>>): Partial<Record<Channel, T>> {
  const copy: Partial<Record<Channel, T>> = {};
  for (const channel of CHANNELS) {
    const value = record[channel];
    if (value !== undefined) copy[channel] = value;
  }
  return copy;
}

export function assertHour(hour: number): void {
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) {
    throw new RangeError("hour must be an integer from 0 through 23");
  }
}

export function nonNegativeInteger(value: number | undefined): number {
  if (value === undefined) return 0;
  if (!Number.isInteger(value) || value < 0) throw new RangeError("counts and limits must be non-negative integers");
  return value;
}
`;

const referenceCapabilities = `import { defaultCapabilities } from "./catalog.ts";
import type { Capability, Channel, RoutingContext } from "./types.ts";

export function capabilitiesFor(channel: Channel, context?: RoutingContext): readonly Capability[] {
  return context?.capabilities?.[channel] ?? defaultCapabilities(channel);
}

export function supportsCapabilities(
  channel: Channel,
  required: readonly Capability[],
  available: readonly Capability[] = defaultCapabilities(channel),
): boolean {
  const supported = new Set(available);
  return required.every((capability) => supported.has(capability));
}

export function missingCapabilities(
  channel: Channel,
  required: readonly Capability[],
  available: readonly Capability[] = defaultCapabilities(channel),
): Capability[] {
  const supported = new Set(available);
  return required.filter((capability) => !supported.has(capability));
}

export function requiredCapabilitiesForContent(content: {
  html?: string;
  attachmentIds?: readonly string[];
  actionUrl?: string;
}): Capability[] {
  const required: Capability[] = ["text"];
  if (content.html) required.push("rich");
  if ((content.attachmentIds?.length ?? 0) > 0) required.push("attachment");
  if (content.actionUrl) required.push("action");
  return required;
}

export function capableChannels(channels: readonly Channel[], required: readonly Capability[]): Channel[] {
  return channels.filter((channel) => supportsCapabilities(channel, required));
}

export function capabilityCoverage(channel: Channel, required: readonly Capability[]): number {
  if (required.length === 0) return 1;
  return (required.length - missingCapabilities(channel, required).length) / required.length;
}
`;

const referencePreferences = `import { DEFAULT_CHANNEL_ORDER } from "./types.ts";
import type { Channel, Notification, UserRoutingProfile } from "./types.ts";
import { uniqueChannels } from "./validation.ts";

export function preferenceOrder(profile?: UserRoutingProfile): Channel[] {
  return uniqueChannels([...(profile?.channelOrder ?? []), ...DEFAULT_CHANNEL_ORDER]);
}

export function isProfileDisabled(channel: Channel, profile?: UserRoutingProfile): boolean {
  return profile?.disabledChannels?.includes(channel) ?? false;
}

export function isTopicOptedIn(channel: Channel, notification: Notification, profile?: UserRoutingProfile): boolean {
  const topicOptIns = profile?.topicOptIns;
  if (!topicOptIns || !Object.prototype.hasOwnProperty.call(topicOptIns, notification.topic)) return true;
  return topicOptIns[notification.topic]?.includes(channel) ?? false;
}

export function preferenceIndex(channel: Channel, profile?: UserRoutingProfile): number {
  const index = preferenceOrder(profile).indexOf(channel);
  return index < 0 ? Number.MAX_SAFE_INTEGER : index;
}

export function compareByPreference(left: Channel, right: Channel, profile?: UserRoutingProfile): number {
  return preferenceIndex(left, profile) - preferenceIndex(right, profile);
}

export function sortByPreference(channels: readonly Channel[], profile?: UserRoutingProfile): Channel[] {
  return [...channels].sort((left, right) => compareByPreference(left, right, profile));
}

export function preferredAvailable(available: readonly Channel[], profile?: UserRoutingProfile): Channel | null {
  const availableSet = new Set(available);
  return preferenceOrder(profile).find((channel) => availableSet.has(channel) && !isProfileDisabled(channel, profile)) ?? null;
}

export function mergeChannelOrder(primary: readonly Channel[], fallback: readonly Channel[]): Channel[] {
  return uniqueChannels([...primary, ...fallback]);
}
`;

const referenceFilters = `import { capabilitiesFor, supportsCapabilities } from "./capabilities.ts";
import { channelHealth, isDisruptive } from "./catalog.ts";
import { isProfileDisabled, isTopicOptedIn } from "./preferences.ts";
import type {
  Candidate,
  Channel,
  ChannelEvaluation,
  Notification,
  RoutingContext,
  Urgency,
} from "./types.ts";
import { assertHour, nonNegativeInteger } from "./validation.ts";

export function isHourInWindow(hour: number, start: number, end: number): boolean {
  assertHour(hour);
  assertHour(start);
  assertHour(end);
  if (start === end) return false;
  return start < end ? hour >= start && hour < end : hour >= start || hour < end;
}

export function isWithinLimit(used: number, limit: number, urgency: Urgency): boolean {
  const checkedUsed = nonNegativeInteger(used);
  const checkedLimit = nonNegativeInteger(limit);
  return urgency === "critical" ? checkedUsed <= checkedLimit : checkedUsed < checkedLimit;
}

export function evaluateChannel(
  channel: Channel,
  notification: Notification,
  context: RoutingContext,
): ChannelEvaluation {
  const health = channelHealth(channel, context);
  if (!context.availableChannels.includes(channel)) return { channel, eligible: false, reason: "unavailable", health };
  if (isProfileDisabled(channel, context.profile) || context.policy?.disabledChannels?.includes(channel)) {
    return { channel, eligible: false, reason: "disabled", health };
  }
  if (!supportsCapabilities(channel, notification.requiredCapabilities ?? ["text"], capabilitiesFor(channel, context))) {
    return { channel, eligible: false, reason: "incapable", health };
  }
  if (!isTopicOptedIn(channel, notification, context.profile)) {
    return { channel, eligible: false, reason: "opted-out", health };
  }
  const urgency = notification.urgency ?? "normal";
  const quiet = context.profile?.quietHours;
  if (
    quiet &&
    context.localHour !== undefined &&
    (urgency === "low" || urgency === "normal") &&
    isDisruptive(channel) &&
    isHourInWindow(context.localHour, quiet.start, quiet.end)
  ) {
    return { channel, eligible: false, reason: "quiet-hours", health };
  }
  const limit = context.policy?.channelLimits?.[channel];
  if (limit !== undefined && !isWithinLimit(context.usage?.[channel] ?? 0, limit, urgency)) {
    return { channel, eligible: false, reason: "rate-limited", health };
  }
  if (health === "down") return { channel, eligible: false, reason: "provider-down", health };
  return { channel, eligible: true, health };
}

export function eligibleChannels(
  channels: readonly Channel[],
  notificationOrContext: Notification | RoutingContext,
  optionalContext?: RoutingContext,
): Channel[] {
  if (optionalContext) {
    return channels.filter((channel) => evaluateChannel(channel, notificationOrContext as Notification, optionalContext).eligible);
  }
  const context = notificationOrContext as RoutingContext;
  return channels.filter(
    (channel) => context.availableChannels.includes(channel) && !isProfileDisabled(channel, context.profile),
  );
}

export function candidateFor(channel: Channel, context: RoutingContext): Candidate {
  return {
    channel,
    available: context.availableChannels.includes(channel),
    disabled: isProfileDisabled(channel, context.profile),
  };
}

export function isEligible(candidate: Candidate): boolean {
  return candidate.available && !candidate.disabled;
}

export function candidatesFor(channels: readonly Channel[], context: RoutingContext): Candidate[] {
  return channels.map((channel) => candidateFor(channel, context));
}

export function partitionCandidates(candidates: readonly Candidate[]): {
  eligible: Candidate[];
  rejected: Candidate[];
} {
  return {
    eligible: candidates.filter(isEligible),
    rejected: candidates.filter((candidate) => !isEligible(candidate)),
  };
}

export function rejectedChannels(channels: readonly Channel[], context: RoutingContext): Channel[] {
  return candidatesFor(channels, context)
    .filter((candidate) => !isEligible(candidate))
    .map((candidate) => candidate.channel);
}

export function hasEligibleChannel(channels: readonly Channel[], context: RoutingContext): boolean {
  return channels.some((channel) => isEligible(candidateFor(channel, context)));
}
`;

const referencePolicy = `import { channelHealth } from "./catalog.ts";
import { preferenceOrder } from "./preferences.ts";
import type { Channel, Notification, RoutingContext } from "./types.ts";
import { uniqueChannels } from "./validation.ts";

export function policyOrder(notification: Notification, context: RoutingContext): Channel[] {
  const preferred = preferenceOrder(context.profile);
  const forced = context.policy?.forcedChannelByUrgency?.[notification.urgency ?? "normal"];
  return uniqueChannels(forced ? [forced, ...preferred] : preferred);
}

export function orderByHealth(channels: readonly Channel[], context: RoutingContext, forced?: Channel): Channel[] {
  const forcedPrefix = forced && channels.includes(forced) ? [forced] : [];
  const remaining = channels.filter((channel) => channel !== forced);
  const up = remaining.filter((channel) => channelHealth(channel, context) === "up");
  const degraded = remaining.filter((channel) => channelHealth(channel, context) === "degraded");
  return [...forcedPrefix, ...up, ...degraded];
}
`;

const referenceRouter = `import { evaluateChannel } from "./filters.ts";
import { orderByHealth, policyOrder } from "./policy.ts";
import { CHANNELS } from "./types.ts";
import type {
  BatchDecision,
  Channel,
  DeliveryPlan,
  Notification,
  RoutingContext,
  RoutingExplanation,
  RoutingSnapshot,
} from "./types.ts";
import { assertNotification } from "./validation.ts";

export function rankChannels(notification: Notification, context: RoutingContext): Channel[] {
  assertNotification(notification);
  const eligible = policyOrder(notification, context).filter(
    (channel) => evaluateChannel(channel, notification, context).eligible,
  );
  const forced = context.policy?.forcedChannelByUrgency?.[notification.urgency ?? "normal"];
  return orderByHealth(eligible, context, forced);
}

export function planDelivery(notification: Notification, context: RoutingContext): DeliveryPlan {
  const attempts = rankChannels(notification, context);
  return { attempts, selected: attempts[0] ?? null };
}

export function routeNotification(notification: Notification, context: RoutingContext): Channel | null {
  return planDelivery(notification, context).selected;
}

export function routeNotifications(
  notifications: readonly Notification[],
  context: RoutingContext,
): Array<{ notificationId: string; selected: Channel | null }> {
  return notifications.map((notification) => ({
    notificationId: notification.id,
    selected: routeNotification(notification, context),
  }));
}

export function routingSnapshot(notification: Notification, context: RoutingContext): RoutingSnapshot {
  const rankedChannels = rankChannels(notification, context);
  return {
    notificationId: notification.id,
    candidates: context.availableChannels.map((channel) => ({
      channel,
      available: true,
      disabled: context.profile?.disabledChannels?.includes(channel) ?? false,
    })),
    rankedChannels,
    selected: rankedChannels[0] ?? null,
  };
}

export function explainRouting(notification: Notification, context: RoutingContext): RoutingExplanation {
  const plan = planDelivery(notification, context);
  const evaluations = CHANNELS.map((channel) => evaluateChannel(channel, notification, context));
  const excluded: RoutingExplanation["excluded"] = {};
  for (const evaluation of evaluations) {
    if (!evaluation.eligible && evaluation.reason) excluded[evaluation.channel] = evaluation.reason;
  }
  return { ...plan, excluded, evaluations };
}

export function routeBatch(
  notifications: readonly Notification[],
  context: RoutingContext,
  suppressionKeys: readonly string[] = [],
): BatchDecision[] {
  const suppressed = new Set(suppressionKeys);
  const seenIds = new Set<string>();
  const seenRecipients = new Set<string>();
  return notifications.map((notification) => {
    assertNotification(notification);
    const recipientKey = \`\${notification.userId}:\${notification.topic}\`;
    if (suppressed.has(notification.id) || suppressed.has(recipientKey)) {
      return { notificationId: notification.id, attempts: [], selected: null, suppressionReason: "suppressed" };
    }
    if (seenIds.has(notification.id) || seenRecipients.has(recipientKey)) {
      return { notificationId: notification.id, attempts: [], selected: null, suppressionReason: "duplicate" };
    }
    seenIds.add(notification.id);
    seenRecipients.add(recipientKey);
    return { notificationId: notification.id, ...planDelivery(notification, context) };
  });
}
`;

const referenceIndex = `export * from "./types.ts";
export * from "./catalog.ts";
export * from "./capabilities.ts";
export * from "./preferences.ts";
export * from "./filters.ts";
export * from "./policy.ts";
export * from "./router.ts";
`;

const referenceSources = {
	"src/types.ts": referenceTypes,
	"src/catalog.ts": referenceCatalog,
	"src/validation.ts": referenceValidation,
	"src/capabilities.ts": referenceCapabilities,
	"src/preferences.ts": referencePreferences,
	"src/filters.ts": referenceFilters,
	"src/policy.ts": referencePolicy,
	"src/router.ts": referenceRouter,
	"src/index.ts": referenceIndex,
};

export const notificationRouting: EvalTarget = {
	id: "notification-routing",
	title: "Notification routing",
	files: projectFiles(seedSources),
	referenceFiles: projectFiles(referenceSources),
	publicVerify: ["npm test"],
	steps: [
		{
			id: "profile-preferences",
			title: "Profile preference ordering",
			prompt:
				"Implement profile preference ordering in rankChannels(notification: Notification, context: RoutingContext): Channel[]. UserRoutingProfile.channelOrder is a partial preferred order; append omitted channels in DEFAULT_CHANNEL_ORDER, remove duplicates, then remove unavailable and profile-disabled channels. routeNotification(notification, context): Channel | null must remain compatible and return rankChannels(...)[0] or null. Keep the existing Notification, RoutingContext, Channel, and UserRoutingProfile exports.",
			publicTest: `test("uses a partial profile order without losing fallbacks", () => {
  const n = { id: "p1", userId: "u1", topic: "news" };
  const c = { availableChannels: ["email", "sms", "push"] as const, profile: { channelOrder: ["sms"] as const } };
  assert.deepEqual(subject.rankChannels(n, c), ["sms", "email", "push"]);
  assert.equal(subject.routeNotification(n, c), "sms");
});`,
			hiddenTest: `test("deduplicates profile preferences and preserves defaults", () => {
  const n = { id: "p2", userId: "u1", topic: "news" };
  const c = { availableChannels: ["inApp", "email", "push"] as const, profile: { channelOrder: ["push", "push"] as const } };
  assert.deepEqual(subject.rankChannels(n, c), ["push", "email", "inApp"]);
});`,
		},
		{
			id: "message-capabilities",
			title: "Message capability filtering",
			prompt:
				"Extend Notification with requiredCapabilities?: readonly Capability[] and RoutingContext with capabilities?: Partial<Record<Channel, readonly Capability[]>>. Export capabilitiesFor(channel: Channel, context?: RoutingContext): readonly Capability[]. rankChannels and routeNotification must exclude channels missing any requirement, using context overrides or catalog defaults. An omitted requiredCapabilities remains compatible and means ['text']; supportsCapabilities(channel, required, available?) keeps its existing signature.",
			publicTest: `test("filters channels that cannot carry attachments", () => {
  const n = { id: "c1", userId: "u1", topic: "report", requiredCapabilities: ["attachment"] as const };
  const c = { availableChannels: ["sms", "push", "email"] as const };
  assert.deepEqual(subject.rankChannels(n, c), ["email"]);
});`,
			hiddenTest: `test("honors per-context capability overrides", () => {
  const n = { id: "c2", userId: "u1", topic: "report", requiredCapabilities: ["attachment", "text"] as const };
  const c = { availableChannels: ["push", "email"] as const, capabilities: { push: ["text", "attachment"] as const } };
  assert.deepEqual(subject.rankChannels(n, c), ["email", "push"]);
});`,
		},
		{
			id: "topic-consent",
			title: "Topic consent filtering",
			prompt:
				"Extend UserRoutingProfile with topicOptIns?: Partial<Record<string, readonly Channel[]>> and export isTopicOptedIn(channel: Channel, notification: Notification, profile?: UserRoutingProfile): boolean. If a notification.topic key exists, only listed channels are eligible; a missing key preserves current behavior. Consent filtering applies to every urgency, including critical, and must compose with capability and preference filtering in rankChannels and routeNotification without changing their signatures.",
			publicTest: `test("restricts a configured topic to opted-in channels", () => {
  const n = { id: "o1", userId: "u1", topic: "marketing" };
  const c = { availableChannels: ["email", "sms", "inApp"] as const, profile: { topicOptIns: { marketing: ["inApp"] as const } } };
  assert.deepEqual(subject.rankChannels(n, c), ["inApp"]);
});`,
			hiddenTest: `test("does not let critical urgency bypass topic consent", () => {
  const n = { id: "o2", userId: "u1", topic: "security", urgency: "critical" as const };
  const c = { availableChannels: ["email", "sms"] as const, profile: { topicOptIns: { security: ["email"] as const } } };
  assert.equal(subject.routeNotification(n, c), "email");
});`,
		},
		{
			id: "quiet-hours",
			title: "Quiet-hours filtering",
			prompt:
				"Extend UserRoutingProfile with quietHours?: { start: number; end: number } and RoutingContext with localHour?: number. Export isHourInWindow(hour: number, start: number, end: number): boolean using start-inclusive/end-exclusive whole hours, including windows crossing midnight; start === end means disabled. During quiet hours exclude disruptive sms and push for low/normal notifications, but not high/critical. rankChannels and routeNotification signatures and all prior preference/capability/consent behavior remain compatible.",
			publicTest: `test("suppresses disruptive channels across midnight", () => {
  assert.equal(subject.isHourInWindow(23, 22, 7), true);
  const n = { id: "q1", userId: "u1", topic: "digest" };
  const c = { availableChannels: ["sms", "push", "email"] as const, profile: { channelOrder: ["sms"] as const, quietHours: { start: 22, end: 7 } }, localHour: 23 };
  assert.deepEqual(subject.rankChannels(n, c), ["email"]);
});`,
			hiddenTest: `test("allows disruptive channels for high urgency during quiet hours", () => {
  const n = { id: "q2", userId: "u1", topic: "incident", urgency: "high" as const };
  const c = { availableChannels: ["sms", "email"] as const, profile: { channelOrder: ["sms"] as const, quietHours: { start: 22, end: 7 } }, localHour: 1 };
  assert.equal(subject.routeNotification(n, c), "sms");
});`,
		},
		{
			id: "tenant-policy",
			title: "Tenant routing policy",
			prompt:
				"Add RoutingPolicy with disabledChannels?: readonly Channel[] and forcedChannelByUrgency?: Partial<Record<Urgency, Channel>>, plus RoutingContext.policy?: RoutingPolicy. Tenant-disabled channels are never eligible. A forced channel is first only when it also passes availability, profile, capability, consent, and quiet-hours filters; otherwise normal preference order applies. Preserve rankChannels(notification, context) and routeNotification(notification, context) signatures and export RoutingPolicy.",
			publicTest: `test("places an eligible tenant-forced channel first", () => {
  const n = { id: "t1", userId: "u1", topic: "incident", urgency: "high" as const };
  const c = { availableChannels: ["email", "sms"] as const, policy: { forcedChannelByUrgency: { high: "sms" as const } } };
  assert.deepEqual(subject.rankChannels(n, c), ["sms", "email"]);
});`,
			hiddenTest: `test("never revives a forced channel disabled by policy", () => {
  const n = { id: "t2", userId: "u1", topic: "incident", urgency: "critical" as const };
  const c = { availableChannels: ["sms", "email"] as const, policy: { disabledChannels: ["sms"] as const, forcedChannelByUrgency: { critical: "sms" as const } } };
  assert.deepEqual(subject.rankChannels(n, c), ["email"]);
});`,
		},
		{
			id: "channel-limits",
			title: "Channel usage limits",
			prompt:
				"Extend RoutingPolicy with channelLimits?: Partial<Record<Channel, number>> and RoutingContext with usage?: Partial<Record<Channel, number>>. Export isWithinLimit(used: number, limit: number, urgency: Urgency): boolean. Exclude a channel when used >= limit; critical may exceed by exactly one attempt, so used === limit is eligible but used > limit is not. Counts and limits are non-negative integers. Apply this after policy/capability/consent/quiet-hours checks while preserving all existing APIs.",
			publicTest: `test("filters channels at their normal limit", () => {
  const n = { id: "l1", userId: "u1", topic: "digest" };
  const c = { availableChannels: ["email", "sms"] as const, policy: { channelLimits: { email: 2, sms: 3 } }, usage: { email: 2, sms: 1 } };
  assert.deepEqual(subject.rankChannels(n, c), ["sms"]);
});`,
			hiddenTest: `test("permits only one critical overflow attempt", () => {
  assert.equal(subject.isWithinLimit(2, 2, "critical"), true);
  assert.equal(subject.isWithinLimit(3, 2, "critical"), false);
  const n = { id: "l2", userId: "u1", topic: "incident", urgency: "critical" as const };
  const c = { availableChannels: ["email"] as const, policy: { channelLimits: { email: 2 } }, usage: { email: 2 } };
  assert.equal(subject.routeNotification(n, c), "email");
});`,
		},
		{
			id: "fallback-plan",
			title: "Fallback delivery plans",
			prompt:
				"Export DeliveryPlan { attempts: Channel[]; selected: Channel | null } and planDelivery(notification: Notification, context: RoutingContext): DeliveryPlan. attempts is the complete rankChannels result in order and selected is its first item or null. routeNotification must delegate to the same routing rules and remain API-compatible, returning only selected. Do not mutate notification, context, profile, policy, or their arrays.",
			publicTest: `test("returns all eligible fallbacks and the selected channel", () => {
  const n = { id: "f1", userId: "u1", topic: "receipt" };
  const c = { availableChannels: ["push", "sms", "email"] as const, profile: { channelOrder: ["push", "sms"] as const } };
  assert.deepEqual(subject.planDelivery(n, c), { attempts: ["push", "sms", "email"], selected: "push" });
});`,
			hiddenTest: `test("returns an empty plan without eligible channels", () => {
  const n = { id: "f2", userId: "u1", topic: "receipt", requiredCapabilities: ["attachment"] as const };
  const c = { availableChannels: ["sms"] as const };
  assert.deepEqual(subject.planDelivery(n, c), { attempts: [], selected: null });
  assert.equal(subject.routeNotification(n, c), null);
});`,
		},
		{
			id: "provider-health",
			title: "Provider health routing",
			prompt:
				"Add Health = 'up' | 'degraded' | 'down' and RoutingContext.health?: Partial<Record<Channel, Health>>; omitted health means up. Down channels are filtered out. After all existing policy/capability/consent/limit filters, place up channels before degraded channels while preserving preference order within each group. An eligible tenant-forced channel remains first even when degraded. Keep rankChannels, planDelivery, and routeNotification signatures compatible.",
			publicTest: `test("moves degraded providers behind healthy fallbacks", () => {
  const n = { id: "h1", userId: "u1", topic: "receipt" };
  const c = { availableChannels: ["email", "push", "sms"] as const, health: { email: "degraded" as const, push: "up" as const } };
  assert.deepEqual(subject.rankChannels(n, c), ["push", "sms", "email"]);
});`,
			hiddenTest: `test("filters down providers but preserves an eligible forced degraded channel", () => {
  const n = { id: "h2", userId: "u1", topic: "incident", urgency: "high" as const };
  const c = { availableChannels: ["email", "sms", "push"] as const, health: { email: "down" as const, sms: "degraded" as const }, policy: { forcedChannelByUrgency: { high: "sms" as const } } };
  assert.deepEqual(subject.planDelivery(n, c).attempts, ["sms", "push"]);
});`,
		},
		{
			id: "routing-explanation",
			title: "Explain routing decisions",
			prompt:
				"Export evaluateChannel(channel: Channel, notification: Notification, context: RoutingContext): ChannelEvaluation and explainRouting(notification: Notification, context: RoutingContext): RoutingExplanation. RoutingExplanation extends DeliveryPlan with excluded: Partial<Record<Channel, ExclusionReason>> and evaluations in CHANNELS order. ExclusionReason is 'unavailable' | 'disabled' | 'incapable' | 'opted-out' | 'quiet-hours' | 'rate-limited' | 'provider-down'. Use that precedence and one shared rule path so explainRouting.attempts exactly equals planDelivery.attempts; preserve all prior signatures.",
			publicTest: `test("explains capability and availability exclusions", () => {
  const n = { id: "e1", userId: "u1", topic: "report", requiredCapabilities: ["attachment"] as const };
  const c = { availableChannels: ["sms", "email"] as const };
  const result = subject.explainRouting(n, c);
  assert.deepEqual(result.attempts, ["email"]);
  assert.equal(result.excluded.sms, "incapable");
  assert.equal(result.excluded.push, "unavailable");
});`,
			hiddenTest: `test("shares policy, health, and plan ordering with the explanation", () => {
  const n = { id: "e2", userId: "u1", topic: "incident" };
  const c = { availableChannels: ["email", "push"] as const, health: { email: "degraded" as const, push: "down" as const } };
  const explained = subject.explainRouting(n, c);
  assert.deepEqual(explained.attempts, subject.planDelivery(n, c).attempts);
  assert.equal(explained.excluded.push, "provider-down");
});`,
		},
		{
			id: "batch-suppression",
			title: "Batch suppression and deduplication",
			prompt:
				"Export BatchDecision and routeBatch(notifications: readonly Notification[], context: RoutingContext, suppressionKeys?: readonly string[]): BatchDecision[]. Return one decision per input in order. A suppression key may equal notification.id or userId + ':' + topic; suppressed decisions have empty attempts, null selected, and suppressionReason 'suppressed'. After suppression, later duplicate ids or user/topic pairs in the same batch use 'duplicate'. Other decisions must equal planDelivery under all existing routing policy, capability, consent, limit, and health rules. Do not mutate inputs; keep every prior API compatible.",
			publicTest: `test("suppresses explicit keys without disturbing other plans", () => {
  const notifications = [
    { id: "b1", userId: "u1", topic: "digest" },
    { id: "b2", userId: "u2", topic: "digest" },
  ];
  const decisions = subject.routeBatch(notifications, { availableChannels: ["email"] }, ["b1"]);
  assert.deepEqual(decisions[0], { notificationId: "b1", attempts: [], selected: null, suppressionReason: "suppressed" });
  assert.equal(decisions[1].selected, "email");
});`,
			hiddenTest: `test("deduplicates recipients while retaining cumulative routing filters", () => {
  const notifications = [
    { id: "b3", userId: "u1", topic: "report", requiredCapabilities: ["attachment"] },
    { id: "b4", userId: "u1", topic: "report", requiredCapabilities: ["attachment"] },
  ];
  const context = { availableChannels: ["sms", "email"], health: { email: "degraded" } };
  const decisions = subject.routeBatch(notifications, context);
  assert.deepEqual(decisions[0].attempts, ["email"]);
  assert.equal(decisions[1].suppressionReason, "duplicate");
  assert.deepEqual(notifications.map((n) => n.id), ["b3", "b4"]);
});`,
		},
	],
};
