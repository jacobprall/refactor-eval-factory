import { task } from "@renderinc/sdk/workflows";
import { requireTarget } from "../../../eval/targets/index.js";
import { TASKS } from "../../config/index.js";
import { requireScenario } from "../../eval/scenarios.js";
import { evalStore } from "../../eval/store/index.js";
import { executeTrajectory } from "../../eval/trajectory.js";
import { openEvalSandbox, withSandbox } from "../../sandbox/index.js";
import { RunTrajectoryInput } from "../../schemas/index.js";

export interface TrajectoryTaskResult {
	targetId: string;
	scenarioId: string;
	replicate: number;
	status: "completed" | "stopped";
	iterations: number;
	finalTreeHash: string;
}

export const runTrajectory = task(
	{
		name: TASKS.runTrajectory,
		timeoutSeconds: 8 * 60 * 60,
		// Sandbox service blips have outlasted short waits. A retry restarts the trajectory from feature 1.
		retry: { maxRetries: 3, waitDurationMs: 60_000, backoffScaling: 2 },
	},
	async (_ctx, raw: unknown): Promise<TrajectoryTaskResult> => {
		const input = RunTrajectoryInput.parse(raw);
		const target = requireTarget(input.targetId);
		const scenario = requireScenario(input.scenarioId);
		const traceId = `${input.experimentId}:${target.id}:${scenario.id}:${input.replicate}`;

		await evalStore.startTrajectory(input);
		try {
			const result = await withSandbox(
				() => openEvalSandbox(),
				(sandbox) =>
					executeTrajectory(sandbox, target, scenario, traceId, {
						onIteration: (iteration) => evalStore.recordIteration(input, iteration),
					}),
			);
			await evalStore.finishTrajectory(input, result);
			return {
				targetId: target.id,
				scenarioId: scenario.id,
				replicate: input.replicate,
				status: result.status,
				iterations: result.iterations.length,
				finalTreeHash: result.finalTreeHash,
			};
		} catch (error) {
			await evalStore.failTrajectory(input, error);
			throw error;
		}
	},
);
