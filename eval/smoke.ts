import type { ExperimentManifest } from "./manifest.js";

/** Small live/manual smoke selection. Unit tests use scripted agents and never call a provider. */
export const SMOKE_MANIFEST: ExperimentManifest = {
	version: 1,
	targetIds: ["inventory-reservations", "notification-routing"],
	scenarioIds: ["evidence-seeking"],
	replicates: 1,
	maxConcurrency: 2,
	orderSeed: "smoke",
};

export const SMOKE_STEPS = 10;
