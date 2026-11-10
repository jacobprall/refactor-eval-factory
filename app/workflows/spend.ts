import type { AgentRun, OutputSchema } from "../agents/index.js";
import type { Spend } from "../format/index.js";
import { renderMarker, type SpendMarker } from "../github/index.js";

export const NO_SPEND: Spend = { costUsd: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };

/** `total` plus one agent run's usage. */
export function addSpend<Output extends OutputSchema>(total: Spend, run: Pick<AgentRun<Output>, "costUsd" | "usage">): Spend {
	return {
		costUsd: total.costUsd + run.costUsd,
		inputTokens: total.inputTokens + run.usage.input_tokens,
		outputTokens: total.outputTokens + run.usage.output_tokens,
		cacheReadTokens: total.cacheReadTokens + run.usage.cache_read_tokens,
		cacheWriteTokens: total.cacheWriteTokens + run.usage.cache_write_tokens,
	};
}

/** The hidden marker a PR carries so `npm run cost-report` can price it. */
export function spendMarker(kind: SpendMarker["kind"], spend: Spend, decisionUsd?: number): string {
	return renderMarker("spend", {
		kind,
		costUsd: round(spend.costUsd),
		tokens: { input: spend.inputTokens, output: spend.outputTokens, cacheRead: spend.cacheReadTokens, cacheWrite: spend.cacheWriteTokens },
		...(decisionUsd === undefined ? {} : { decisionUsd: round(decisionUsd) }),
	});
}

const round = (usd: number): number => Math.round(usd * 10_000) / 10_000;
