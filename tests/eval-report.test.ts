import { describe, expect, it } from "vitest";
import { breakEvenMarkdown, buildExperimentReport, computeBreakEven, computeHealthAssociation } from "../app/eval/report.js";
import type { IterationCostRow } from "../app/eval/store/index.js";

describe("experiment report", () => {
	it("compares each scenario with its target baseline", () => {
		const report = buildExperimentReport("00000000-0000-4000-8000-000000000000", [
			{
				targetId: "billing",
				scenarioId: "baseline",
				trajectories: 1,
				completed: 1,
				meanIterations: 8,
				totalCostUsd: 10,
				totalTokens: 100,
				totalDurationMs: 1000,
				totalFilesTouched: 20,
				hiddenFailures: 1,
				correctIterations: 7,
				productionAdditions: 40,
				productionDeletions: 10,
				productionFilesTouched: 12,
				repeatedHotspotEdits: 4,
				meanChurnSlope: 1.5,
				meanModuleTouchSlope: 0.1,
				interventionCalls: 0,
				interventionsApplied: 0,
				reviews: 0,
				evidenceDirectSelections: 0,
				evidenceRefactorSelections: 0,
				attemptedProductionChurn: 50,
				meanFinalHealth: null,
				meanFinalHealthWhereWorkIs: null,
				replayRejections: 0,
			},
			{
				targetId: "billing",
				scenarioId: "change-locality",
				trajectories: 1,
				completed: 1,
				meanIterations: 8,
				totalCostUsd: 8,
				totalTokens: 90,
				totalDurationMs: 900,
				totalFilesTouched: 12,
				hiddenFailures: 0,
				correctIterations: 8,
				productionAdditions: 30,
				productionDeletions: 10,
				productionFilesTouched: 10,
				repeatedHotspotEdits: 2,
				meanChurnSlope: -1,
				meanModuleTouchSlope: -0.2,
				interventionCalls: 2,
				interventionsApplied: 1,
				reviews: 3,
				evidenceDirectSelections: 0,
				evidenceRefactorSelections: 0,
				attemptedProductionChurn: 50,
				meanFinalHealth: null,
				meanFinalHealthWhereWorkIs: null,
				replayRejections: 0,
			},
		]);
		expect(report.markdown).toContain("| billing | baseline |");
		expect(report.markdown).toContain("| billing | change-locality |");
		expect(report.markdown).toContain("8/8");
		expect(report.markdown).toContain("| 1/2 | 3 |");
	});
});

const costRow = (overrides: Partial<IterationCostRow>): IterationCostRow => ({
	experimentId: "e",
	targetId: "metering",
	scenarioId: "baseline",
	replicate: 0,
	ordinal: 0,
	correct: true,
	productionChurn: 10,
	health: 10,
	healthWhereWorkIs: null,
	interventionTriggered: false,
	interventionApplied: false,
	implementCostUsd: 1,
	implementTokens: 100,
	interventionCostUsd: 0,
	interventionTokens: 0,
	...overrides,
});

describe("break-even analysis", () => {
	it("nets downstream implementation savings against the intervention's cost", () => {
		const baseline = [0, 1, 2, 3].map((ordinal) => costRow({ ordinal, implementCostUsd: 1, implementTokens: 100 }));
		const arm = [0, 1, 2, 3].map((ordinal) =>
			costRow({
				scenarioId: "refactor",
				ordinal,
				implementCostUsd: ordinal > 1 ? 0.5 : 1,
				implementTokens: ordinal > 1 ? 40 : 100,
				interventionTriggered: ordinal === 1,
				interventionCostUsd: ordinal === 1 ? 0.4 : 0,
			}),
		);

		const [row] = computeBreakEven([...baseline, ...arm]);

		expect(row).toMatchObject({ scenarioId: "refactor", triggered: 1, meanTriggerFeature: 2, meanDownstreamFeatures: 2, meanTokenSavings: 120 });
		expect(row.meanSavingsUsd).toBeCloseTo(1);
		expect(row.meanNetSavingsUsd).toBeCloseTo(0.6);
		expect(row.breakEvenFeatures).toBeCloseTo(0.8);
		expect(breakEvenMarkdown([row])).toContain("| metering | refactor | 1/1 |");
	});

	it("counts a review that declined to act as the first intervention, so its cost is not hidden", () => {
		const baseline = [0, 1, 2, 3].map((ordinal) => costRow({ ordinal }));
		const arm = [0, 1, 2, 3].map((ordinal) =>
			costRow({ scenarioId: "gated-review", ordinal, interventionCostUsd: ordinal === 1 ? 0.3 : 0, interventionTriggered: false }),
		);
		expect(computeBreakEven([...baseline, ...arm])[0]).toMatchObject({
			triggered: 1,
			meanTriggerFeature: 2,
			meanNetSavingsUsd: expect.closeTo(-0.3),
			breakEvenFeatures: null,
		});
	});

	it("reports no break-even when the intervention never pays back", () => {
		const baseline = [0, 1, 2].map((ordinal) => costRow({ ordinal }));
		const arm = [0, 1, 2].map((ordinal) =>
			costRow({
				scenarioId: "refactor",
				ordinal,
				implementCostUsd: 1.2,
				interventionTriggered: ordinal === 0,
				interventionCostUsd: ordinal === 0 ? 1 : 0,
			}),
		);
		expect(computeBreakEven([...baseline, ...arm])[0]).toMatchObject({ breakEvenFeatures: null });
	});
});

describe("health association", () => {
	it("correlates the health a feature inherits with that feature's churn within the same ordinal", () => {
		const rows = [0, 1, 2, 3].flatMap((replicate) => {
			const health = 10 - replicate;
			return [
				costRow({ replicate, ordinal: 0, health }),
				costRow({ replicate, ordinal: 1, health, productionChurn: 20 + replicate * 10, correct: replicate < 3 }),
			];
		});
		const [association] = computeHealthAssociation(rows);
		expect(association).toMatchObject({ targetId: "metering", features: 4, failures: 1, meanHealthBeforeFailure: 7 });
		expect(association.churnCorrelation).toBeCloseTo(-1);
	});
});
