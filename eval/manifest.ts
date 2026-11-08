import { createHash } from "node:crypto";
import { requireScenario, SCENARIO_IDS, type ScenarioId, scenarioHash } from "../app/eval/scenarios.js";
import { requireTarget, type TargetId, targetHash } from "./targets/index.js";

export const MANIFEST_VERSION = 1;

export interface ExperimentCell {
	targetId: TargetId;
	scenarioId: ScenarioId;
	replicate: number;
}

export interface ExperimentManifest {
	version: number;
	targetIds: readonly TargetId[];
	scenarioIds: readonly ScenarioId[];
	replicates: number;
	maxConcurrency: number;
	orderSeed: string;
}

export const DEFAULT_MANIFEST: ExperimentManifest = {
	version: MANIFEST_VERSION,
	targetIds: ["inventory-reservations", "notification-routing"],
	scenarioIds: SCENARIO_IDS,
	replicates: 1,
	maxConcurrency: 8,
	orderSeed: "default",
};

export const POSITIVE_CONTROL_MANIFEST: ExperimentManifest = {
	version: MANIFEST_VERSION,
	targetIds: ["usage-metering"],
	scenarioIds: ["baseline", "refactor-after-3", "refactor-after-6", "refactor-after-9"],
	replicates: 5,
	maxConcurrency: 8,
	orderSeed: "usage-metering-timing-v1",
};

/** Each arm adds one factor to the previous one: replay guard, then measured evidence, then a playbook. */
export const POSITIVE_CONTROL_LADDER_MANIFEST: ExperimentManifest = {
	version: MANIFEST_VERSION,
	targetIds: ["usage-metering"],
	scenarioIds: ["baseline", "refactor-after-6", "refactor-after-6-guarded", "refactor-after-6-briefed", "refactor-after-6-playbook"],
	replicates: 10,
	maxConcurrency: 10,
	orderSeed: "usage-metering-ladder-v1",
};

/** Adaptive policies against fresh concurrent baselines, including two targets the policies were not designed on. */
export const HEALTH_POLICY_MANIFEST: ExperimentManifest = {
	version: MANIFEST_VERSION,
	targetIds: ["usage-metering", "inventory-reservations", "notification-routing"],
	scenarioIds: ["baseline", "triggered-after", "health-triggered", "health-safeguard"],
	replicates: 10,
	maxConcurrency: 12,
	orderSeed: "health-policy-v1",
};

/** The talk's skill as the decision-maker, against the sensor-only gate, the best fixed timing, and fresh baselines. */
export const SKILL_REVIEW_MANIFEST: ExperimentManifest = {
	version: MANIFEST_VERSION,
	targetIds: ["usage-metering", "inventory-reservations", "notification-routing"],
	scenarioIds: ["baseline", "refactor-after-6-briefed", "health-triggered", "skill-review"],
	replicates: 10,
	maxConcurrency: 12,
	orderSeed: "skill-review-v1",
};

/**
 * A modular monolith in three variants: planted cross-module debt with a backlog that keeps touching it, the same debt
 * with a backlog that never needs it, and a clean seed with the first backlog.
 */
export const MONOLITH_MANIFEST: ExperimentManifest = {
	version: MANIFEST_VERSION,
	targetIds: ["commerce-monolith", "commerce-monolith-elsewhere", "commerce-monolith-clean"],
	scenarioIds: ["baseline", "triggered-after", "health-triggered", "skill-review", "skill-review-maturity-gated", "skill-review-health-gated"],
	replicates: 10,
	maxConcurrency: 12,
	orderSeed: "commerce-monolith-v1",
};

/** Sensors for timing, judgment for targets: each gate opens one skill review, which may decline. */
export const COMBINED_MANIFEST: ExperimentManifest = {
	version: MANIFEST_VERSION,
	targetIds: ["usage-metering", "inventory-reservations", "notification-routing"],
	scenarioIds: ["baseline", "skill-review-maturity-gated", "skill-review-health-gated"],
	replicates: 10,
	maxConcurrency: 12,
	orderSeed: "combined-v1",
};

/** Change history as the trigger: the gate names files that keep changing together and the skill reviews them once. */
export const COUPLING_MANIFEST: ExperimentManifest = {
	version: MANIFEST_VERSION,
	targetIds: ["commerce-monolith", "commerce-monolith-elsewhere", "commerce-monolith-clean"],
	scenarioIds: ["baseline", "skill-review-coupling-gated"],
	replicates: 10,
	maxConcurrency: 12,
	orderSeed: "coupling-v1",
};

/**
 * Series 2: does "signals decide when and where, the skill decides what" beat no refactoring, the skill on every pull
 * request, and the signals acting alone? Each target makes one point: copies inside a file (usage metering), one rule
 * written in two modules (the monolith), the same debt with no future work on it, a clean seed, and a small healthy one.
 */
export const SERIES_2_MANIFEST: ExperimentManifest = {
	version: MANIFEST_VERSION,
	targetIds: ["usage-metering", "commerce-monolith", "commerce-monolith-elsewhere", "commerce-monolith-clean", "inventory-reservations"],
	scenarioIds: ["baseline", "skill-review", "signals-only", "signals-skill"],
	replicates: 10,
	maxConcurrency: 12,
	orderSeed: "series-2-v1",
};

/** One trajectory of each gated arm on the two targets where the gate should fire, before paying for the full series. */
export const SERIES_2_SMOKE_MANIFEST: ExperimentManifest = {
	version: MANIFEST_VERSION,
	targetIds: ["usage-metering", "commerce-monolith"],
	scenarioIds: ["signals-only", "signals-skill"],
	replicates: 1,
	maxConcurrency: 4,
	orderSeed: "series-2-smoke-v1",
};

export const NAMED_MANIFESTS = {
	"positive-control": POSITIVE_CONTROL_MANIFEST,
	"positive-control-ladder": POSITIVE_CONTROL_LADDER_MANIFEST,
	"health-policy": HEALTH_POLICY_MANIFEST,
	"skill-review": SKILL_REVIEW_MANIFEST,
	monolith: MONOLITH_MANIFEST,
	combined: COMBINED_MANIFEST,
	coupling: COUPLING_MANIFEST,
	"series-2": SERIES_2_MANIFEST,
	"series-2-smoke": SERIES_2_SMOKE_MANIFEST,
} as const satisfies Record<string, ExperimentManifest>;

export function expandManifest(manifest: ExperimentManifest = DEFAULT_MANIFEST): ExperimentCell[] {
	if (!Number.isInteger(manifest.replicates) || manifest.replicates < 1 || manifest.replicates > 20) {
		throw new Error("replicates must be an integer from 1 to 20");
	}
	if (!Number.isInteger(manifest.maxConcurrency) || manifest.maxConcurrency < 1 || manifest.maxConcurrency > 100) {
		throw new Error("maxConcurrency must be an integer from 1 to 100");
	}
	const cells = manifest.targetIds.flatMap((targetId) =>
		manifest.scenarioIds.flatMap((scenarioId) => {
			const scenario = requireScenario(scenarioId);
			if (scenario.targetIds && !scenario.targetIds.includes(targetId)) return [];
			return Array.from({ length: manifest.replicates }, (_, replicate) => ({ targetId, scenarioId, replicate }));
		}),
	);
	return cells.sort((a, b) => orderKey(manifest.orderSeed, a).localeCompare(orderKey(manifest.orderSeed, b)));
}

function orderKey(seed: string, cell: ExperimentCell): string {
	return createHash("sha256").update(`${seed}:${cell.targetId}:${cell.scenarioId}:${cell.replicate}`).digest("hex");
}

export function manifestHash(manifest: ExperimentManifest = DEFAULT_MANIFEST): string {
	return createHash("sha256")
		.update(
			JSON.stringify({
				manifest,
				targets: manifest.targetIds.map((id) => ({ id, hash: targetHash(requireTarget(id)) })),
				scenarios: manifest.scenarioIds.map((id) => ({ id, hash: scenarioHash(requireScenario(id)) })),
			}),
		)
		.digest("hex");
}
