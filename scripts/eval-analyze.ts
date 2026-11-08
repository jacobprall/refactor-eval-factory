import { writeFileSync } from "node:fs";
import { Pool } from "pg";
import { rebuildCheckpoints } from "../app/eval/checkpoints.js";
import { analyzeHealth, type HealthSnapshot } from "../app/eval/health.js";
import { breakEvenMarkdown, computeBreakEven, computeHealthAssociation } from "../app/eval/report.js";
import { requireScenario } from "../app/eval/scenarios.js";
import { measureSignals, type SignalSnapshot } from "../app/eval/signals.js";
import { createEvalStore, type IterationCostRow } from "../app/eval/store/index.js";
import { decideIntervention, type FileChange, type InterventionDecision, type IterationResult } from "../app/eval/trajectory.js";
import { requireTarget } from "../eval/targets/index.js";

/**
 * Read-only analysis across stored experiments. Checkpoints recorded before health or signals measurement existed are
 * rebuilt by replaying each iteration's stored patch onto the target seed, then measured with the same sensors the harness uses.
 */

const args = new Map<string, string>();
for (let i = 2; i < process.argv.length; i += 2) {
	const key = process.argv[i];
	const value = process.argv[i + 1];
	if (!key?.startsWith("--") || value === undefined) throw new Error("arguments must be --name value pairs");
	args.set(key.slice(2), value);
}
const experimentIds = args.get("experiments")?.split(",").filter(Boolean) ?? [];
if (experimentIds.length === 0) throw new Error("--experiments <id,id,...> is required");
const targetFilter = args.get("target");

const connectionString = process.env.DATABASE_URL?.trim();
if (!connectionString) throw new Error("DATABASE_URL is required");
const pool = new Pool({ connectionString, max: 2 });

interface StoredIteration {
	experiment_id: string;
	target_id: string;
	scenario_id: string;
	replicate: number;
	ordinal: number;
	patch: string;
	file_changes: FileChange[];
	health: HealthSnapshot | null;
	signals: SignalSnapshot | null;
	intervention: InterventionDecision;
	correct: boolean;
	replay_rejected: boolean;
}

const healthByIteration = new Map<string, HealthSnapshot>();
const signalsByIteration = new Map<string, SignalSnapshot>();

try {
	const store = createEvalStore(pool);
	const costs = (await store.iterationCosts(experimentIds)).filter((row) => !targetFilter || row.targetId === targetFilter);
	const stored = (
		await pool.query<StoredIteration>(
			`SELECT experiment_id, target_id, scenario_id, replicate, ordinal, patch, file_changes, health, signals, intervention,
			        hidden_check IS NOT NULL AND (hidden_check->>'exitCode')::int = 0 AS correct,
			        coalesce(replay->>'status' = 'diverged', false) AS replay_rejected
			 FROM eval_iterations WHERE experiment_id = ANY($1::uuid[])
			 ORDER BY experiment_id, target_id, scenario_id, replicate, ordinal`,
			[experimentIds],
		)
	).rows.filter((row) => !targetFilter || row.target_id === targetFilter);

	const trajectories = new Map<string, StoredIteration[]>();
	for (const row of stored) {
		const key = trajectoryKey(row.experiment_id, row.scenario_id, row.replicate, row.target_id);
		trajectories.set(key, [...(trajectories.get(key) ?? []), row]);
	}

	const seedHealth = new Map<string, HealthSnapshot>();
	const seedSignals = new Map<string, SignalSnapshot>();
	let replayFailures = 0;
	for (const [key, iterations] of trajectories) {
		const target = requireTarget(iterations[0].target_id);
		if (!seedHealth.has(target.id)) {
			seedHealth.set(target.id, analyzeHealth(target.files));
			seedSignals.set(target.id, measureSignals(target.files, []));
		}
		const rebuilt = iterations.every((iteration) => iteration.health && iteration.signals)
			? undefined
			: rebuildCheckpoints(
					target.files,
					iterations.map((iteration) => iteration.patch),
				);
		if (rebuilt && rebuilt.length < iterations.length) replayFailures++;
		for (const [index, iteration] of iterations.entries()) {
			const sources = rebuilt?.[index];
			const health = iteration.health ?? (sources && analyzeHealth(sources));
			const features = iterations.slice(0, index + 1).map((row) => row.file_changes);
			const signals = iteration.signals ?? (sources && measureSignals(sources, features));
			if (health) healthByIteration.set(`${key}:${iteration.ordinal}`, health);
			if (signals) signalsByIteration.set(`${key}:${iteration.ordinal}`, signals);
		}
	}

	const withHealth: IterationCostRow[] = costs.map((row) => {
		const key = `${trajectoryKey(row.experimentId, row.scenarioId, row.replicate, row.targetId)}:${row.ordinal}`;
		return {
			...row,
			health: row.health ?? healthByIteration.get(key)?.score ?? null,
			healthWhereWorkIs: row.healthWhereWorkIs ?? signalsByIteration.get(key)?.healthWhereWorkIs ?? null,
		};
	});

	const out: string[] = [`# Evaluation analysis`, "", `Experiments: ${experimentIds.join(", ")}`, ""];
	if (replayFailures > 0)
		out.push(`${replayFailures} trajectories could not be fully rebuilt from stored patches; their later checkpoints are unmeasured.`, "");

	out.push(
		"## Interventions and correctness",
		"",
		"Per trajectory means. A review counts whether or not the skill acted; a refactor counts only when it survived the guards. Hidden correctness gates every other claim.",
		"",
		"| Target | Scenario | Trajectories | Hidden checks passed | Gate opened after feature | Reviews | Refactors applied | Replay rejections | Cost per trajectory |",
		"|---|---|---:|---:|---:|---:|---:|---:|---:|",
	);
	for (const [targetId, scenarioId] of uniquePairs(withHealth)) {
		const groups = [...trajectories.values()].filter((rows) => rows[0].target_id === targetId && rows[0].scenario_id === scenarioId);
		const opened = groups.flatMap((rows) => {
			const first = rows.find((row) => row.intervention.triggered || row.intervention.review);
			return first ? [first.ordinal + 1] : [];
		});
		const perTrajectory = (count: (row: StoredIteration) => boolean) => mean(groups.map((rows) => rows.filter(count).length));
		const cost = withHealth
			.filter((row) => row.targetId === targetId && row.scenarioId === scenarioId)
			.reduce((total, row) => total + row.implementCostUsd + row.interventionCostUsd, 0);
		const iterations = groups.flat();
		out.push(
			`| ${targetId} | ${scenarioId} | ${groups.length} | ${iterations.filter((row) => row.correct).length}/${iterations.length} | ${opened.length > 0 ? `${fmt(mean(opened))} (${opened.length}/${groups.length})` : "never"} | ${fmt(perTrajectory((row) => row.intervention.review !== undefined))} | ${fmt(perTrajectory((row) => row.intervention.applied))} | ${fmt(perTrajectory((row) => row.replay_rejected))} | $${(groups.length > 0 ? cost / groups.length : 0).toFixed(2)} |`,
		);
	}
	out.push("");

	out.push(
		"## Break-even",
		"",
		"Implementation cost after each trajectory's first intervention spend, against the per-feature baseline mean, net of intervention cost.",
		"",
	);
	out.push(breakEvenMarkdown(computeBreakEven(withHealth)));

	const CHECKPOINTS = [3, 6, 9, 12];
	out.push(
		"## Health where the work is over time",
		"",
		"Health v2 weighted by size times heat, after each feature (10 is best; 9.5 is the bar).",
		"",
		`| Target | Scenario | Trajectories | Seed | ${CHECKPOINTS.map((feature) => `After ${feature}`).join(" | ")} |`,
		`|---|---|---:|---:|${CHECKPOINTS.map(() => "---:").join("|")}|`,
	);
	for (const [targetId, scenarioId] of uniquePairs(withHealth)) {
		const rows = withHealth.filter((row) => row.targetId === targetId && row.scenarioId === scenarioId);
		const at = (feature: number) =>
			fmt(mean(rows.filter((row) => row.ordinal === feature - 1 && row.healthWhereWorkIs !== null).map((row) => row.healthWhereWorkIs as number)));
		out.push(
			`| ${targetId} | ${scenarioId} | ${groupBy(rows, (row) => `${row.experimentId}:${row.replicate}`).length} | ${fmt(seedSignals.get(targetId)?.healthWhereWorkIs ?? null)} | ${CHECKPOINTS.map(at).join(" | ")} |`,
		);
	}
	out.push("");

	const COUPLING_CHECKPOINTS = [4, 6, 8, 10, 12];
	out.push(
		"## Coupling over time",
		"",
		"Share of trajectories where files in two or more directories all changed in three of the last four features, after each feature.",
		"",
		`| Target | Scenario | ${COUPLING_CHECKPOINTS.map((feature) => `After ${feature}`).join(" | ")} | Most common cluster |`,
		`|---|---|${COUPLING_CHECKPOINTS.map(() => "---:").join("|")}|---|`,
	);
	for (const [targetId, scenarioId] of uniquePairs(withHealth)) {
		const keys = [...trajectories.entries()]
			.filter(([, rows]) => rows[0].target_id === targetId && rows[0].scenario_id === scenarioId)
			.map(([key]) => key);
		const share = (feature: number) => {
			const measured = keys.map((key) => signalsByIteration.get(`${key}:${feature - 1}`)).filter((value) => value !== undefined);
			return measured.length > 0 ? `${Math.round((measured.filter((value) => value.coupling).length / measured.length) * 100)}%` : "—";
		};
		const clusters = keys.flatMap((key) =>
			[...signalsByIteration.entries()]
				.filter(([id, value]) => id.startsWith(`${key}:`) && value.coupling)
				.map(([, value]) => value.coupling?.join(", ")),
		);
		out.push(`| ${targetId} | ${scenarioId} | ${COUPLING_CHECKPOINTS.map(share).join(" | ")} | ${mostCommon(clusters) ?? "—"} |`);
	}
	out.push("");

	out.push(
		"## Structural health by scenario",
		"",
		"| Target | Scenario | Trajectories | Seed health | Mean health after feature 6 | Mean final health |",
		"|---|---|---:|---:|---:|---:|",
	);
	for (const [targetId, scenarioId] of uniquePairs(withHealth)) {
		const rows = withHealth.filter((row) => row.targetId === targetId && row.scenarioId === scenarioId);
		const groups = groupBy(rows, (row) => `${row.experimentId}:${row.replicate}`);
		const finals = groups.map((group) => group.at(-1)?.health).filter((value): value is number => value !== null && value !== undefined);
		const atSix = rows.filter((row) => row.ordinal === 5 && row.health !== null).map((row) => row.health as number);
		out.push(
			`| ${targetId} | ${scenarioId} | ${groups.length} | ${seedHealth.get(targetId)?.score.toFixed(2) ?? "—"} | ${fmt(mean(atSix))} | ${fmt(mean(finals))} |`,
		);
	}
	out.push("");

	const structured = uniquePairs(withHealth).filter(([targetId, scenarioId]) =>
		stored.some((row) => row.target_id === targetId && row.scenario_id === scenarioId && healthOf(row)?.boundaries),
	);
	if (structured.length > 0) {
		out.push(
			"## Module structure by scenario",
			"",
			"Boundary violations are imports that bypass another module's index.ts. Modules touched counts production modules changed per attempted feature.",
			"",
			"| Target | Scenario | Seed violations | Final violations | Final cross-module imports | Modules touched per feature |",
			"|---|---|---:|---:|---:|---:|",
		);
		for (const [targetId, scenarioId] of structured) {
			const rows = stored.filter((row) => row.target_id === targetId && row.scenario_id === scenarioId);
			const byTrajectory = groupBy(rows, (row) => `${row.experiment_id}:${row.replicate}`);
			const finals = byTrajectory.map((group) => healthOf(group.at(-1) as StoredIteration)?.boundaries).filter((value) => value !== undefined);
			const touched = rows.map(
				(row) => new Set(row.file_changes.filter((change) => change.category === "production").map((change) => change.path.split("/")[1])).size,
			);
			out.push(
				`| ${targetId} | ${scenarioId} | ${seedHealth.get(targetId)?.boundaries?.violations.length ?? "—"} | ${fmt(mean(finals.map((value) => value.violations.length)))} | ${fmt(mean(finals.map((value) => value.crossModuleImports)))} | ${fmt(mean(touched))} |`,
			);
		}
		out.push("");
	}

	out.push(
		"## Does inherited health predict the next feature?",
		"",
		"Correlation of the health a feature inherits with that feature's attempted production churn, centered within feature ordinal (negative means less healthy code costs more).",
		"",
		"| Target | Measure | Features | Health–churn correlation | Hidden failures | Mean inherited health before failure | Before success |",
		"|---|---|---:|---:|---:|---:|---:|",
	);
	// Refactor arms raise health and lower churn by design, so the baseline-only rows are the cleaner observational test.
	for (const [label, rows] of [
		["all arms", withHealth],
		["baseline only", withHealth.filter((row) => row.scenarioId === "baseline")],
	] as const) {
		for (const [measure, measured] of [
			["first score", rows],
			["health where the work is", rows.map((row) => ({ ...row, health: row.healthWhereWorkIs }))],
		] as const) {
			for (const row of computeHealthAssociation(measured)) {
				out.push(
					`| ${row.targetId} (${label}) | ${measure} | ${row.features} | ${fmt(row.churnCorrelation)} | ${row.failures} | ${fmt(row.meanHealthBeforeFailure)} | ${fmt(row.meanHealthBeforeSuccess)} |`,
				);
			}
		}
	}
	out.push("");

	out.push(
		"## Trigger dry run on baseline trajectories",
		"",
		"Where each adaptive trigger would have fired on trajectories that never refactored. The safeguard column counts features that would have triggered it.",
		"",
		"| Target | Trajectory | Maturity gate fires after | Health gate fires after | Coupling gate fires after | Signals gate fires after | Safeguard triggers | Signals gate reason |",
		"|---|---|---:|---:|---:|---:|---:|---|",
	);
	for (const [key, iterations] of trajectories) {
		if (iterations[0].scenario_id !== "baseline") continue;
		const target = requireTarget(iterations[0].target_id);
		const seeds = { health: seedHealth.get(target.id) as HealthSnapshot, signals: seedSignals.get(target.id) as SignalSnapshot };
		const run = (scenarioId: string) => dryRun(scenarioId, iterations, key, seeds, target.steps.length);
		const signals = run("signals-only");
		out.push(
			`| ${target.id} | ${iterations[0].experiment_id.slice(0, 8)}#${iterations[0].replicate} | ${run("triggered-after").first ?? "never"} | ${run("health-triggered").first ?? "never"} | ${run("skill-review-coupling-gated").first ?? "never"} | ${signals.first ?? "never"} | ${run("health-safeguard").count} | ${signals.reason} |`,
		);
	}
	out.push("");

	const markdown = out.join("\n");
	const outPath = args.get("out");
	if (outPath) writeFileSync(outPath, markdown);
	console.log(markdown);
} finally {
	await pool.end();
}

function healthOf(row: StoredIteration): HealthSnapshot | undefined {
	return healthByIteration.get(`${trajectoryKey(row.experiment_id, row.scenario_id, row.replicate, row.target_id)}:${row.ordinal}`);
}

function trajectoryKey(experimentId: string, scenarioId: string, replicate: number, targetId: string): string {
	return `${experimentId}:${targetId}:${scenarioId}:${replicate}`;
}

/** Replays a gate over a baseline trajectory using the checkpoints it actually reached. */
function dryRun(
	scenarioId: string,
	iterations: readonly StoredIteration[],
	key: string,
	seeds: { health: HealthSnapshot; signals: SignalSnapshot },
	totalSteps: number,
): { first: number | null; count: number; reason: string } {
	const scenario = requireScenario(scenarioId);
	const history: IterationResult[] = [];
	let first: number | null = null;
	let count = 0;
	let reason = "";
	for (const iteration of iterations) {
		const current = healthByIteration.get(`${key}:${iteration.ordinal}`);
		const signals = signalsByIteration.get(`${key}:${iteration.ordinal}`);
		if (!current || !signals) break;
		const decision = decideIntervention(scenario, history, iteration.file_changes, iteration.ordinal, totalSteps, {
			current,
			seed: seeds.health,
			signals: { current: signals, seed: seeds.signals },
		});
		if (decision.triggered) {
			count++;
			if (first === null) {
				first = iteration.ordinal + 1;
				reason = decision.reason;
			}
		} else if (first === null && !decision.reason.startsWith("fewer than four future")) {
			reason = decision.reason;
		}
		history.push({
			ordinal: iteration.ordinal,
			fileChanges: iteration.file_changes,
			health: current,
			signals,
			intervention: decision,
		} as IterationResult);
	}
	return { first, count, reason };
}

function uniquePairs(rows: readonly IterationCostRow[]): [string, string][] {
	return [...new Set(rows.map((row) => `${row.targetId}\t${row.scenarioId}`))].sort().map((pair) => pair.split("\t") as [string, string]);
}

function groupBy<T>(rows: readonly T[], key: (row: T) => string): T[][] {
	const groups = new Map<string, T[]>();
	for (const row of rows) groups.set(key(row), [...(groups.get(key(row)) ?? []), row]);
	return [...groups.values()];
}

function mostCommon(values: readonly (string | undefined)[]): string | undefined {
	const counts = new Map<string, number>();
	for (const value of values) if (value) counts.set(value, (counts.get(value) ?? 0) + 1);
	return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
}

function mean(values: readonly number[]): number | null {
	return values.length > 0 ? values.reduce((total, value) => total + value, 0) / values.length : null;
}

function fmt(value: number | null): string {
	return value === null ? "—" : value.toFixed(2);
}
