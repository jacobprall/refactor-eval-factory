import { task } from "@renderinc/sdk/workflows";
import { TASKS } from "../../config/index.js";
import { buildExperimentReport, type ExperimentReport } from "../../eval/report.js";
import { evalStore } from "../../eval/store/index.js";
import { SummarizeExperimentInput } from "../../schemas/index.js";

export const summarizeExperiment = task(
	{
		name: TASKS.summarizeExperiment,
		timeoutSeconds: 10 * 60,
		retry: { maxRetries: 1, waitDurationMs: 5_000, backoffScaling: 1 },
	},
	async (_ctx, raw: unknown): Promise<ExperimentReport> => {
		const input = SummarizeExperimentInput.parse(raw);
		return buildExperimentReport(input.experimentId, await evalStore.summary(input.experimentId));
	},
);
