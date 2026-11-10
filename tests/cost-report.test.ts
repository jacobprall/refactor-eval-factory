import { describe, expect, it } from "vitest";
import { renderMarker } from "../app/github/index.js";
import { loadPricedChanges, refactorPayback, renderReport } from "../scripts/lib/cost-report.js";

const BOT = "software-factory[bot]";
const tokens = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };

const pull = (number: number, mergedAt: string | null, spend: { kind: "feature" | "refactor"; costUsd: number; decisionUsd?: number }, login = BOT) => ({
	number,
	title: `PR ${number}`,
	body: `Body\n\n${renderMarker("spend", { ...spend, tokens })}`,
	user: { login },
	merged_at: mergedAt,
	html_url: `https://github.com/acme/widget/pull/${number}`,
});

function source(pulls: unknown[], files: Record<number, string[]>) {
	return {
		closedPulls: async () => pulls,
		pullFiles: async (number: number) => (files[number] ?? []).map((filename) => ({ filename })),
	};
}

describe("cost report", () => {
	const pulls = [
		pull(1, "2026-11-01T00:00:00Z", { kind: "feature", costUsd: 3 }),
		pull(2, "2026-11-02T00:00:00Z", { kind: "feature", costUsd: 5 }),
		pull(3, "2026-11-03T00:00:00Z", { kind: "refactor", costUsd: 2, decisionUsd: 1 }),
		pull(4, "2026-11-04T00:00:00Z", { kind: "feature", costUsd: 2 }),
		pull(5, "2026-11-05T00:00:00Z", { kind: "feature", costUsd: 3 }),
		pull(6, "2026-11-06T00:00:00Z", { kind: "feature", costUsd: 9 }),
		pull(7, null, { kind: "feature", costUsd: 100 }),
		pull(8, "2026-11-07T00:00:00Z", { kind: "feature", costUsd: 100 }, "mallory"),
	];
	const files = {
		1: ["src/meter.ts"],
		2: ["src/meter.ts", "tests/meter.test.ts"],
		3: ["src/meter.ts", "tests/meter.test.ts"],
		4: ["src/meter.ts"],
		5: ["src/meter.ts"],
		6: ["src/unrelated.ts", "tests/meter.test.ts"],
		8: ["src/meter.ts"],
	};

	it("prices changes to refactored code before and after the refactor, counting the decision in the investment", async () => {
		const changes = await loadPricedChanges(source(pulls, files), BOT);
		expect(changes.map((change) => change.number)).toEqual([1, 2, 3, 4, 5, 6]);
		const [payback] = refactorPayback(changes);
		expect(payback).toMatchObject({
			investmentUsd: 3,
			before: { changes: 2, meanUsd: 4 },
			after: { changes: 2, meanUsd: 2.5 },
			breakEvenChanges: 2,
			netUsd: 0,
		});
		expect(renderReport("acme/widget", changes, refactorPayback(changes))).toContain("| [#3](https://github.com/acme/widget/pull/3) | $3.00 | 2 | $4.00 | 2 | $2.50 | 2.0 | $0.00 |");
	});

	it("reports no break-even when changes didn't get cheaper", async () => {
		const pricier = pulls.map((p) => (p.number === 5 ? pull(5, "2026-11-05T00:00:00Z", { kind: "feature", costUsd: 9 }) : p));
		const [payback] = refactorPayback(await loadPricedChanges(source(pricier, files), BOT));
		expect(payback?.breakEvenChanges).toBeNull();
		expect(payback?.netUsd).toBeLessThan(0);
	});
});
