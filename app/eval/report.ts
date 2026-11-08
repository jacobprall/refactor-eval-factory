import type { IterationCostRow, ScenarioSummary } from "./store/index.js";

export interface ExperimentReport {
	experimentId: string;
	generatedAt: string;
	rows: ScenarioSummary[];
	markdown: string;
}

export function buildExperimentReport(experimentId: string, rows: ScenarioSummary[]): ExperimentReport {
	const lines = [
		`# Refactor evaluation ${experimentId}`,
		"",
		"Correctness gates code-cost comparisons. Attempted churn includes failed iterations. Model cost includes every attempted phase, including failed or incomplete work.",
		"",
		"| Target | Scenario | Completed | Correct steps | Churn/correct step | Churn vs baseline | Attempted churn | Prod module touches | Hotspot re-edits | Churn slope | Interventions | Reviews | Replay rejections | Evidence direct/refactor | Final health | Final health where the work is | Cost/correct step | Cost USD |",
		"|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|",
	];
	for (const row of rows) {
		const productionChurn = row.productionAdditions + row.productionDeletions;
		const churnPerCorrect = row.correctIterations > 0 ? productionChurn / row.correctIterations : 0;
		const baseline = rows.find((candidate) => candidate.targetId === row.targetId && candidate.scenarioId === "baseline");
		const baselineChurn =
			baseline && baseline.correctIterations > 0 ? (baseline.productionAdditions + baseline.productionDeletions) / baseline.correctIterations : 0;
		const churnDelta = baselineChurn > 0 ? ((churnPerCorrect - baselineChurn) / baselineChurn) * 100 : 0;
		const costPerCorrect = row.correctIterations > 0 ? row.totalCostUsd / row.correctIterations : 0;
		const evidenceSelections =
			row.evidenceDirectSelections + row.evidenceRefactorSelections > 0 ? `${row.evidenceDirectSelections}/${row.evidenceRefactorSelections}` : "—";
		lines.push(
			`| ${row.targetId} | ${row.scenarioId} | ${row.completed}/${row.trajectories} | ${row.correctIterations}/${Math.round(row.meanIterations * row.trajectories)} | ${churnPerCorrect.toFixed(1)} | ${signed(churnDelta)}% | ${row.attemptedProductionChurn} | ${row.productionFilesTouched} | ${row.repeatedHotspotEdits} | ${row.meanChurnSlope.toFixed(2)} | ${row.interventionsApplied}/${row.interventionCalls} | ${row.reviews} | ${row.replayRejections} | ${evidenceSelections} | ${row.meanFinalHealth === null ? "—" : row.meanFinalHealth.toFixed(2)} | ${row.meanFinalHealthWhereWorkIs === null ? "—" : row.meanFinalHealthWhereWorkIs.toFixed(2)} | ${costPerCorrect.toFixed(4)} | ${row.totalCostUsd.toFixed(4)} |`,
		);
	}
	return { experimentId, generatedAt: new Date().toISOString(), rows, markdown: `${lines.join("\n")}\n` };
}

export interface BreakEvenRow {
	targetId: string;
	scenarioId: string;
	trajectories: number;
	triggered: number;
	meanTriggerFeature: number;
	meanInterventionCostUsd: number;
	meanDownstreamFeatures: number;
	meanDownstreamCostUsd: number;
	meanBaselineDownstreamCostUsd: number;
	meanSavingsUsd: number;
	meanNetSavingsUsd: number;
	meanTokenSavings: number;
	/** Downstream features needed to repay the intervention at the observed per-feature savings; null when nothing is saved. */
	breakEvenFeatures: number | null;
}

/**
 * Compares implementation cost after each trajectory's first intervention with the per-feature baseline mean for the same
 * features, net of everything the intervention phases cost. Failed iterations count: their cost was spent. The first
 * intervention is the first feature that spent anything on one, so a review that declined to act still counts.
 */
export function computeBreakEven(rows: readonly IterationCostRow[], baselineScenarioId = "baseline"): BreakEvenRow[] {
	const results: BreakEvenRow[] = [];
	for (const targetId of unique(rows.map((row) => row.targetId))) {
		const targetRows = rows.filter((row) => row.targetId === targetId);
		const baselineCost = meanByOrdinal(targetRows.filter((row) => row.scenarioId === baselineScenarioId));
		for (const scenarioId of unique(targetRows.map((row) => row.scenarioId)).filter((id) => id !== baselineScenarioId)) {
			const trajectories = groupTrajectories(targetRows.filter((row) => row.scenarioId === scenarioId)).filter((trajectory) =>
				trajectory.some((row) => row.implementCostUsd > 0),
			);
			const measured = trajectories.flatMap((trajectory) => {
				const trigger = trajectory.find((row) => row.interventionTriggered || row.interventionCostUsd > 0);
				if (!trigger) return [];
				const downstream = trajectory.filter((row) => row.ordinal > trigger.ordinal && baselineCost.has(row.ordinal));
				const baselineDownstream = downstream.reduce((total, row) => total + (baselineCost.get(row.ordinal)?.cost ?? 0), 0);
				const baselineTokens = downstream.reduce((total, row) => total + (baselineCost.get(row.ordinal)?.tokens ?? 0), 0);
				const downstreamCost = sum(downstream.map((row) => row.implementCostUsd));
				const interventionCost = sum(trajectory.map((row) => row.interventionCostUsd));
				return [
					{
						triggerFeature: trigger.ordinal + 1,
						interventionCost,
						features: downstream.length,
						downstreamCost,
						baselineDownstream,
						savings: baselineDownstream - downstreamCost,
						tokenSavings: baselineTokens - sum(downstream.map((row) => row.implementTokens)),
					},
				];
			});
			const mean = (pick: (entry: (typeof measured)[number]) => number) => (measured.length > 0 ? sum(measured.map(pick)) / measured.length : 0);
			const savings = mean((entry) => entry.savings);
			const features = mean((entry) => entry.features);
			const interventionCost = mean((entry) => entry.interventionCost);
			const perFeature = features > 0 ? savings / features : 0;
			results.push({
				targetId,
				scenarioId,
				trajectories: trajectories.length,
				triggered: measured.length,
				meanTriggerFeature: mean((entry) => entry.triggerFeature),
				meanInterventionCostUsd: interventionCost,
				meanDownstreamFeatures: features,
				meanDownstreamCostUsd: mean((entry) => entry.downstreamCost),
				meanBaselineDownstreamCostUsd: mean((entry) => entry.baselineDownstream),
				meanSavingsUsd: savings,
				meanNetSavingsUsd: savings - interventionCost,
				meanTokenSavings: mean((entry) => entry.tokenSavings),
				breakEvenFeatures: perFeature > 0 ? interventionCost / perFeature : null,
			});
		}
	}
	return results;
}

export function breakEvenMarkdown(rows: readonly BreakEvenRow[]): string {
	const lines = [
		"| Target | Scenario | Triggered | Trigger after feature | Intervention cost | Downstream features | Downstream implement cost vs baseline | Savings | Net savings | Token savings | Break-even features |",
		"|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|",
	];
	for (const row of rows) {
		const delta =
			row.meanBaselineDownstreamCostUsd > 0
				? `${signed(((row.meanDownstreamCostUsd - row.meanBaselineDownstreamCostUsd) / row.meanBaselineDownstreamCostUsd) * 100)}%`
				: "—";
		lines.push(
			`| ${row.targetId} | ${row.scenarioId} | ${row.triggered}/${row.trajectories} | ${row.meanTriggerFeature.toFixed(1)} | $${row.meanInterventionCostUsd.toFixed(3)} | ${row.meanDownstreamFeatures.toFixed(1)} | ${delta} | $${row.meanSavingsUsd.toFixed(3)} | $${row.meanNetSavingsUsd.toFixed(3)} | ${Math.round(row.meanTokenSavings)} | ${row.breakEvenFeatures === null ? "never" : row.breakEvenFeatures.toFixed(1)} |`,
		);
	}
	return `${lines.join("\n")}\n`;
}

export interface HealthAssociation {
	targetId: string;
	features: number;
	/** Pearson correlation of inherited health with the next feature's attempted churn, both centered within feature ordinal. */
	churnCorrelation: number | null;
	failures: number;
	meanHealthBeforeFailure: number | null;
	meanHealthBeforeSuccess: number | null;
}

/**
 * Tests whether the health a feature inherits predicts its cost and correctness. Centering within each feature ordinal
 * removes differences between requirements, so the correlation compares the same feature across trajectories.
 */
export function computeHealthAssociation(rows: readonly IterationCostRow[]): HealthAssociation[] {
	return unique(rows.map((row) => row.targetId)).map((targetId) => {
		const pairs = groupTrajectories(rows.filter((row) => row.targetId === targetId)).flatMap((trajectory) =>
			trajectory.slice(1).flatMap((row, index) => {
				const inherited = trajectory[index].health;
				return inherited === null ? [] : [{ ordinal: row.ordinal, health: inherited, churn: row.productionChurn, correct: row.correct }];
			}),
		);
		const centered = unique(pairs.map((pair) => pair.ordinal)).flatMap((ordinal) => {
			const group = pairs.filter((pair) => pair.ordinal === ordinal);
			const healthMean = sum(group.map((pair) => pair.health)) / group.length;
			const churnMean = sum(group.map((pair) => pair.churn)) / group.length;
			return group.map((pair) => ({ health: pair.health - healthMean, churn: pair.churn - churnMean }));
		});
		const failed = pairs.filter((pair) => !pair.correct);
		const passed = pairs.filter((pair) => pair.correct);
		return {
			targetId,
			features: pairs.length,
			churnCorrelation: pearson(
				centered.map((pair) => pair.health),
				centered.map((pair) => pair.churn),
			),
			failures: failed.length,
			meanHealthBeforeFailure: failed.length > 0 ? sum(failed.map((pair) => pair.health)) / failed.length : null,
			meanHealthBeforeSuccess: passed.length > 0 ? sum(passed.map((pair) => pair.health)) / passed.length : null,
		};
	});
}

function groupTrajectories(rows: readonly IterationCostRow[]): IterationCostRow[][] {
	const groups = new Map<string, IterationCostRow[]>();
	for (const row of rows) {
		const key = `${row.experimentId}:${row.scenarioId}:${row.replicate}`;
		groups.set(key, [...(groups.get(key) ?? []), row]);
	}
	return [...groups.values()].map((group) => [...group].sort((a, b) => a.ordinal - b.ordinal));
}

function meanByOrdinal(rows: readonly IterationCostRow[]): Map<number, { cost: number; tokens: number }> {
	const means = new Map<number, { cost: number; tokens: number }>();
	for (const ordinal of unique(rows.map((row) => row.ordinal))) {
		const group = rows.filter((row) => row.ordinal === ordinal);
		means.set(ordinal, {
			cost: sum(group.map((row) => row.implementCostUsd)) / group.length,
			tokens: sum(group.map((row) => row.implementTokens)) / group.length,
		});
	}
	return means;
}

function pearson(xs: readonly number[], ys: readonly number[]): number | null {
	if (xs.length < 3) return null;
	const mx = sum(xs) / xs.length;
	const my = sum(ys) / ys.length;
	let covariance = 0;
	let vx = 0;
	let vy = 0;
	for (let i = 0; i < xs.length; i++) {
		covariance += (xs[i] - mx) * (ys[i] - my);
		vx += (xs[i] - mx) ** 2;
		vy += (ys[i] - my) ** 2;
	}
	return vx === 0 || vy === 0 ? null : covariance / Math.sqrt(vx * vy);
}

const sum = (values: readonly number[]) => values.reduce((total, value) => total + value, 0);
const unique = <T>(values: readonly T[]) => [...new Set(values)];
const signed = (value: number) => `${value >= 0 ? "+" : ""}${value.toFixed(1)}`;
