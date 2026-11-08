import { writeFileSync } from "node:fs";
import { Pool } from "pg";
import { rebuildCheckpoints } from "../app/eval/checkpoints.js";
import { analyzeHealth } from "../app/eval/health.js";
import { analyzeHealthV2 } from "../app/eval/health-v2.js";
import { computeHealthAssociation } from "../app/eval/report.js";
import { createEvalStore, type IterationCostRow } from "../app/eval/store/index.js";
import type { FileChange } from "../app/eval/trajectory.js";
import { requireTarget, TARGETS } from "../eval/targets/index.js";

/**
 * Compares health measures on stored runs, read-only. Every checkpoint is rebuilt from its stored patches and scored by
 * each measure; a measure is better when it separates planted debt from clean code and when the score a feature inherits
 * predicts that feature's attempted churn and hidden failures more strongly.
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

const connectionString = process.env.DATABASE_URL?.trim();
if (!connectionString) throw new Error("DATABASE_URL is required");
const pool = new Pool({ connectionString, max: 2 });

const MEASURES = ["v1 score", "v2 health", "v2 health where the work is"] as const;
type Measure = (typeof MEASURES)[number];

interface StoredIteration {
	experiment_id: string;
	target_id: string;
	scenario_id: string;
	replicate: number;
	ordinal: number;
	patch: string;
	file_changes: FileChange[];
}

try {
	const out: string[] = ["# Health measure comparison", "", `Experiments: ${experimentIds.length}`, ""];

	out.push("## Does it see planted debt?", "", "| Code | v1 score | v2 health |", "|---|---:|---:|");
	const known: [string, Readonly<Record<string, string>>][] = [
		["usage-metering seed (record and preview copied)", requireTarget("usage-metering").files],
		["usage-metering reference (consolidated)", { ...requireTarget("usage-metering").files, ...requireTarget("usage-metering").referenceFiles }],
		["commerce debt seed (pricing written twice)", requireTarget("commerce-monolith").files],
		["commerce clean seed", requireTarget("commerce-monolith-clean").files],
	];
	for (const [label, files] of known) out.push(`| ${label} | ${analyzeHealth(files).score} | ${analyzeHealthV2(files).health} |`);
	out.push("");

	const store = createEvalStore(pool);
	const costs = await store.iterationCosts(experimentIds);
	const stored = (
		await pool.query<StoredIteration>(
			`SELECT experiment_id, target_id, scenario_id, replicate, ordinal, patch, file_changes
			 FROM eval_iterations WHERE experiment_id = ANY($1::uuid[])
			 ORDER BY experiment_id, target_id, scenario_id, replicate, ordinal`,
			[experimentIds],
		)
	).rows;
	const trajectories = new Map<string, StoredIteration[]>();
	for (const row of stored) {
		const key = `${row.experiment_id}:${row.target_id}:${row.scenario_id}:${row.replicate}`;
		trajectories.set(key, [...(trajectories.get(key) ?? []), row]);
	}

	const scores = new Map<string, Record<Measure, number>>();
	let rebuilt = 0;
	for (const [key, iterations] of trajectories) {
		const target = TARGETS.find((candidate) => candidate.id === iterations[0].target_id);
		if (!target) continue;
		const checkpoints = rebuildCheckpoints(
			target.files,
			iterations.map((iteration) => iteration.patch),
		);
		rebuilt += checkpoints.length;
		const history: string[][] = [];
		for (const [index, sources] of checkpoints.entries()) {
			history.push(iterations[index].file_changes.filter((change) => change.category === "production").map((change) => change.path));
			const v2 = analyzeHealthV2(sources, history);
			scores.set(`${key}:${iterations[index].ordinal}`, {
				"v1 score": analyzeHealth(sources).score,
				"v2 health": v2.health,
				"v2 health where the work is": v2.healthWhereWorkIs,
			});
		}
	}
	out.push(`Rebuilt ${rebuilt} of ${stored.length} stored checkpoints.`, "");

	const rowsFor = (measure: Measure): IterationCostRow[] =>
		costs.flatMap((row) => {
			const score = scores.get(`${row.experimentId}:${row.targetId}:${row.scenarioId}:${row.replicate}:${row.ordinal}`)?.[measure];
			return score === undefined ? [] : [{ ...row, health: score }];
		});

	out.push(
		"## Does the score a feature inherits predict that feature?",
		"",
		"Correlation with the next feature's attempted production churn, both centered within feature ordinal; negative means lower scores precede costlier features. Spread is the standard deviation of inherited scores within ordinal: a measure that never varies cannot predict anything.",
		"",
		"| Target | Runs | Measure | Features | Spread | Score–churn correlation | Hidden failures | Mean score before a failure | Before a pass |",
		"|---|---|---|---:|---:|---:|---:|---:|---:|",
	);
	for (const scope of ["baseline only", "all arms"] as const) {
		for (const measure of MEASURES) {
			const rows = rowsFor(measure).filter((row) => scope === "all arms" || row.scenarioId === "baseline");
			for (const association of computeHealthAssociation(rows)) {
				out.push(
					`| ${association.targetId} | ${scope} | ${measure} | ${association.features} | ${fmt(spread(rows.filter((row) => row.targetId === association.targetId)))} | ${fmt(association.churnCorrelation)} | ${association.failures} | ${fmt(association.meanHealthBeforeFailure)} | ${fmt(association.meanHealthBeforeSuccess)} |`,
				);
			}
		}
	}
	out.push("");

	const markdown = out.join("\n");
	const outPath = args.get("out");
	if (outPath) writeFileSync(outPath, markdown);
	console.log(markdown);
} finally {
	await pool.end();
}

/** Pooled standard deviation of scores within feature ordinal. */
function spread(rows: readonly IterationCostRow[]): number | null {
	const byOrdinal = new Map<number, number[]>();
	for (const row of rows) if (row.health !== null) byOrdinal.set(row.ordinal, [...(byOrdinal.get(row.ordinal) ?? []), row.health]);
	let squares = 0;
	let count = 0;
	for (const values of byOrdinal.values()) {
		const mean = values.reduce((total, value) => total + value, 0) / values.length;
		for (const value of values) squares += (value - mean) ** 2;
		count += values.length;
	}
	return count < 2 ? null : Math.sqrt(squares / count);
}

function fmt(value: number | null): string {
	return value === null ? "—" : value.toFixed(2);
}
