import { randomUUID } from "node:crypto";
import { task } from "@renderinc/sdk/workflows";
import { DEFAULT_MANIFEST, type ExperimentManifest, expandManifest, manifestHash } from "../../../eval/manifest.js";
import type { TargetId } from "../../../eval/targets/index.js";
import { TASKS } from "../../config/index.js";
import { requireScenario, type ScenarioId } from "../../eval/scenarios.js";
import { evalStore } from "../../eval/store/index.js";
import { openEvalSandbox, withSandbox } from "../../sandbox/index.js";
import { RunExperimentInput } from "../../schemas/index.js";
import { runTrajectory, type TrajectoryTaskResult } from "./run-trajectory.js";

export interface ExperimentTaskResult {
	experimentId: string;
	manifestHash: string;
	trajectories: number;
	completed: number;
	stopped: number;
}

export const runExperiment = task(
	{
		name: TASKS.runExperiment,
		timeoutSeconds: 24 * 60 * 60,
		retry: { maxRetries: 0, waitDurationMs: 0, backoffScaling: 1 },
	},
	async (ctx, raw: unknown): Promise<ExperimentTaskResult> => {
		const input = RunExperimentInput.parse(raw);
		const experimentId = input.experimentId ?? randomUUID();
		const manifest: ExperimentManifest = {
			...DEFAULT_MANIFEST,
			targetIds: (input.targetIds ?? DEFAULT_MANIFEST.targetIds) as readonly TargetId[],
			scenarioIds: (input.scenarioIds ?? DEFAULT_MANIFEST.scenarioIds) as readonly ScenarioId[],
			replicates: input.replicates,
			maxConcurrency: input.maxConcurrency,
			orderSeed: experimentId,
		};
		const hash = manifestHash(manifest);
		await evalStore.migrate();
		await evalStore.createExperiment(experimentId, manifest, hash);
		const finished = await evalStore.finishedCells(experimentId);
		const pending = expandManifest(manifest).filter((cell) => !finished.has(`${cell.targetId}:${cell.scenarioId}:${cell.replicate}`));
		// Reviewing every feature takes several times longer than any other arm. Starting those cells first keeps one from
		// starting last and setting the finish time; order within each group stays randomized.
		const reviewsEveryFeature = (cell: (typeof pending)[number]) => requireScenario(cell.scenarioId).intervention === "skill_review";
		const cells = [...pending.filter(reviewsEveryFeature), ...pending.filter((cell) => !reviewsEveryFeature(cell))];

		const results: TrajectoryTaskResult[] = [];
		const failures: unknown[] = [];
		try {
			// Build the generic runner snapshot once before parallel cells race to restore it.
			await withSandbox(
				() => openEvalSandbox(),
				async () => undefined,
			);
			// A pool rather than fixed batches: one slow trajectory must not idle every other slot, or a full series outlasts the
			// root run's 24-hour limit. A cell exhausting its retries must not end the root run and strand the others.
			let next = 0;
			const worker = async () => {
				while (next < cells.length) {
					const cell = cells[next++];
					try {
						results.push(await ctx.run(runTrajectory, { experimentId, ...cell }));
					} catch (error) {
						failures.push(error);
					}
				}
			};
			await Promise.all(Array.from({ length: Math.min(manifest.maxConcurrency, cells.length) }, worker));
		} catch (error) {
			await evalStore.finishExperiment(experimentId, "failed", error);
			throw error;
		}
		if (failures.length > 0) {
			const first = failures[0] instanceof Error ? failures[0].message : String(failures[0]);
			const error = new Error(
				`${failures.length} of ${cells.length} trajectories failed (first: ${first}); relaunch with experimentId ${experimentId} to resume`,
				{ cause: failures[0] },
			);
			await evalStore.finishExperiment(experimentId, "failed", error);
			throw error;
		}
		await evalStore.finishExperiment(experimentId, "completed");

		return {
			experimentId,
			manifestHash: hash,
			trajectories: finished.size + results.length,
			completed: results.filter((result) => result.status === "completed").length,
			stopped: results.filter((result) => result.status === "stopped").length,
		};
	},
);
