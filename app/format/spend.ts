/** What the factory's agents spent on one change, as a PR or issue shows it. */
export interface Spend {
	costUsd: number;
	inputTokens: number;
	outputTokens: number;
	cacheReadTokens: number;
	cacheWriteTokens: number;
}

export function spendLine(spend: Spend): string {
	const read = spend.cacheReadTokens + spend.inputTokens;
	return `Agent spend: $${spend.costUsd.toFixed(2)}, ${compact(read)} tokens read, ${compact(spend.outputTokens)} written.`;
}

const compact = (n: number): string => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}K` : String(n));
