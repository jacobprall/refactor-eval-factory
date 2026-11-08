import { accessControl } from "./access-control.js";
import { approvalWorkflows } from "./approval-workflows.js";
import { commerceMonolith, commerceMonolithClean, commerceMonolithElsewhere } from "./commerce.js";
import { eventScheduling } from "./event-scheduling.js";
import { inventoryReservations } from "./inventory-reservations.js";
import { notificationRouting } from "./notification-routing.js";
import { subscriptionBilling } from "./subscription-billing.js";
import { usageMetering } from "./usage-metering.js";
import type { EvalTarget, TargetId } from "./types.js";

export type { EvalStep, EvalTarget, TargetId } from "./types.js";
export { cumulativeHiddenTest, cumulativePublicTest, targetHash } from "./types.js";

export const TARGETS: readonly EvalTarget[] = [
	subscriptionBilling,
	inventoryReservations,
	approvalWorkflows,
	notificationRouting,
	accessControl,
	eventScheduling,
	usageMetering,
	commerceMonolith,
	commerceMonolithElsewhere,
	commerceMonolithClean,
];

export function requireTarget(id: string): EvalTarget {
	const target = TARGETS.find((candidate) => candidate.id === id);
	if (!target) throw new Error(`unknown eval target ${JSON.stringify(id)}`);
	return target;
}

export function isTargetId(id: string): id is TargetId {
	return TARGETS.some((target) => target.id === id);
}
