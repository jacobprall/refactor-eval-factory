import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { Pool, type PoolClient } from "pg";
import type { ExperimentManifest } from "../../../eval/manifest.js";
import { requireTarget, targetHash } from "../../../eval/targets/index.js";
import type { RunTrajectoryInput } from "../../schemas/tasks.js";
import { requireScenario, scenarioHash } from "../scenarios.js";
import type { IterationResult, TrajectoryResult } from "../trajectory.js";

let sharedPool: Pool | undefined;

function pool(): Pool {
	if (!sharedPool) {
		const connectionString = process.env.DATABASE_URL?.trim();
		if (!connectionString) throw new Error("DATABASE_URL is required for evaluation tasks");
		sharedPool = new Pool({ connectionString, max: 8 });
	}
	return sharedPool;
}

const trajectoryKey = (input: RunTrajectoryInput): [string, string, string, number] => [
	input.experimentId,
	input.targetId,
	input.scenarioId,
	input.replicate,
];
const errorText = (error: unknown) => (error instanceof Error ? (error.stack ?? error.message) : String(error)).slice(0, 20_000);

export interface ScenarioSummary {
	targetId: string;
	scenarioId: string;
	trajectories: number;
	completed: number;
	meanIterations: number;
	totalCostUsd: number;
	totalTokens: number;
	totalDurationMs: number;
	totalFilesTouched: number;
	hiddenFailures: number;
	correctIterations: number;
	productionAdditions: number;
	productionDeletions: number;
	/** Production churn including failed iterations, so a failed arm does not look artificially cheap. */
	attemptedProductionChurn: number;
	productionFilesTouched: number;
	repeatedHotspotEdits: number;
	meanChurnSlope: number;
	meanModuleTouchSlope: number;
	interventionCalls: number;
	interventionsApplied: number;
	/** Refactoring-skill reviews run, including those that declined to act. */
	reviews: number;
	evidenceDirectSelections: number;
	evidenceRefactorSelections: number;
	/** Mean structural health of the last measured checkpoint per trajectory; null before health was recorded. */
	meanFinalHealth: number | null;
	/** Mean health v2 where the work is at the last measured checkpoint; null before signals were recorded. */
	meanFinalHealthWhereWorkIs: number | null;
	replayRejections: number;
}

export interface IterationCostRow {
	experimentId: string;
	targetId: string;
	scenarioId: string;
	replicate: number;
	ordinal: number;
	correct: boolean;
	productionChurn: number;
	health: number | null;
	/** Health v2 where the work is, from recorded signals. */
	healthWhereWorkIs: number | null;
	interventionTriggered: boolean;
	interventionApplied: boolean;
	implementCostUsd: number;
	implementTokens: number;
	interventionCostUsd: number;
	interventionTokens: number;
}

const MIGRATIONS_DIR = fileURLToPath(new URL("./migrations/", import.meta.url));

export function createEvalStore(db: Pick<Pool, "query" | "connect">) {
	return {
		/**
		 * Applies every idempotent migration in one transaction. Render Workflows has no pre-deploy step, so the experiment
		 * task migrates before it writes; the transaction-scoped advisory lock serializes concurrent callers.
		 */
		async migrate(): Promise<void> {
			const names = (await readdir(MIGRATIONS_DIR)).filter((name) => /^\d+_.+\.sql$/.test(name)).sort();
			const client = await db.connect();
			try {
				await client.query("BEGIN");
				await client.query("SELECT pg_advisory_xact_lock(hashtext('refactor-eval-migrations'))");
				for (const name of names) await client.query(await readFile(`${MIGRATIONS_DIR}${name}`, "utf8"));
				await client.query("COMMIT");
			} catch (error) {
				await client.query("ROLLBACK");
				throw error;
			} finally {
				client.release();
			}
		},

		async createExperiment(id: string, manifest: ExperimentManifest, manifestHash: string): Promise<void> {
			await db.query(
				`INSERT INTO eval_experiments (id, manifest, manifest_hash, factory_commit, status)
				 VALUES ($1, $2::jsonb, $3, $4, 'running')
				 ON CONFLICT (id) DO UPDATE SET
				   manifest = EXCLUDED.manifest,
				   manifest_hash = EXCLUDED.manifest_hash,
				   factory_commit = EXCLUDED.factory_commit,
				   status = 'running', error = NULL, finished_at = NULL
				 WHERE eval_experiments.status IN ('running', 'failed') AND eval_experiments.manifest_hash = EXCLUDED.manifest_hash`,
				[id, JSON.stringify(manifest), manifestHash, process.env.RENDER_GIT_COMMIT ?? process.env.GIT_COMMIT ?? "local"],
			);
			const stored = await db.query<{ manifest_hash: string }>(`SELECT manifest_hash FROM eval_experiments WHERE id = $1`, [id]);
			if (stored.rows[0]?.manifest_hash !== manifestHash) {
				throw new Error(`experiment ${id} already exists with a different manifest; resume it with the original targets, scenarios, and replicates`);
			}
		},

		/** Cells that already finished, so a resumed experiment runs only what is missing. */
		async finishedCells(experimentId: string): Promise<Set<string>> {
			const result = await db.query<{ target_id: string; scenario_id: string; replicate: number }>(
				`SELECT target_id, scenario_id, replicate FROM eval_trajectories
				 WHERE experiment_id = $1 AND status IN ('completed', 'stopped')`,
				[experimentId],
			);
			return new Set(result.rows.map((row) => `${row.target_id}:${row.scenario_id}:${row.replicate}`));
		},

		async finishExperiment(id: string, status: "completed" | "failed", error?: unknown): Promise<void> {
			await db.query(`UPDATE eval_experiments SET status = $2, error = $3, finished_at = now() WHERE id = $1`, [
				id,
				status,
				error ? errorText(error) : null,
			]);
		},

		async startTrajectory(input: RunTrajectoryInput): Promise<void> {
			const resolvedTargetHash = targetHash(requireTarget(input.targetId));
			const resolvedScenarioHash = scenarioHash(requireScenario(input.scenarioId));
			// A restarted trajectory begins at feature 1; a failed attempt's later iterations must not mix into its results.
			await db.query(
				`DELETE FROM eval_iterations WHERE experiment_id = $1 AND target_id = $2 AND scenario_id = $3 AND replicate = $4`,
				trajectoryKey(input),
			);
			await db.query(
				`INSERT INTO eval_trajectories (experiment_id, target_id, scenario_id, replicate, target_hash, scenario_hash, status)
				 VALUES ($1, $2, $3, $4, $5, $6, 'running')
				 ON CONFLICT (experiment_id, target_id, scenario_id, replicate)
				 DO UPDATE SET target_hash = EXCLUDED.target_hash, scenario_hash = EXCLUDED.scenario_hash,
				  status = 'running', error = NULL, finished_at = NULL`,
				[...trajectoryKey(input), resolvedTargetHash, resolvedScenarioHash],
			);
		},

		async recordIteration(input: RunTrajectoryInput, iteration: IterationResult): Promise<void> {
			const client = await db.connect();
			try {
				await client.query("BEGIN");
				await upsertIteration(client, input, iteration);
				await client.query(
					`DELETE FROM eval_agent_phases
					 WHERE experiment_id = $1 AND target_id = $2 AND scenario_id = $3 AND replicate = $4 AND ordinal = $5`,
					[...trajectoryKey(input), iteration.ordinal],
				);
				for (const phase of iteration.agentPhases) {
					await client.query(
						`INSERT INTO eval_agent_phases
						 (experiment_id, target_id, scenario_id, replicate, ordinal, phase, agent_id, turns, usage, cost_usd, duration_ms, output)
						 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11,$12::jsonb)`,
						[
							...trajectoryKey(input),
							iteration.ordinal,
							phase.phase,
							phase.agentId,
							phase.turns,
							JSON.stringify(phase.usage),
							phase.costUsd,
							phase.durationMs,
							JSON.stringify(phase.output),
						],
					);
				}
				await client.query("COMMIT");
			} catch (error) {
				await client.query("ROLLBACK");
				throw error;
			} finally {
				client.release();
			}
		},

		async finishTrajectory(input: RunTrajectoryInput, result: TrajectoryResult): Promise<void> {
			await db.query(
				`UPDATE eval_trajectories
				 SET status = $5, final_tree_hash = $6, finished_at = now()
				 WHERE experiment_id = $1 AND target_id = $2 AND scenario_id = $3 AND replicate = $4`,
				[...trajectoryKey(input), result.status, result.finalTreeHash],
			);
		},

		async failTrajectory(input: RunTrajectoryInput, error: unknown): Promise<void> {
			await db.query(
				`UPDATE eval_trajectories SET status = 'failed', error = $5, finished_at = now()
				 WHERE experiment_id = $1 AND target_id = $2 AND scenario_id = $3 AND replicate = $4`,
				[...trajectoryKey(input), errorText(error)],
			);
		},

		async summary(experimentId: string): Promise<ScenarioSummary[]> {
			const result = await db.query<Record<string, string>>(
				`WITH iteration_metrics AS (
				   SELECT i.experiment_id, i.target_id, i.scenario_id, i.replicate, i.ordinal,
				          jsonb_array_length(i.changed_paths) AS files,
				          i.hidden_check IS NOT NULL AND (i.hidden_check->>'exitCode')::int = 0 AS correct,
				          coalesce((SELECT sum((c->>'additions')::int) FROM jsonb_array_elements(i.file_changes) c WHERE c->>'category' = 'production'), 0) AS prod_add,
				          coalesce((SELECT sum((c->>'deletions')::int) FROM jsonb_array_elements(i.file_changes) c WHERE c->>'category' = 'production'), 0) AS prod_del,
				          coalesce((SELECT count(*) FROM jsonb_array_elements(i.file_changes) c WHERE c->>'category' = 'production'), 0) AS prod_files,
				          (i.intervention->>'triggered')::boolean AS intervention_call,
				          (i.intervention->>'applied')::boolean AS intervention_applied,
				          i.intervention ? 'review' AS reviewed,
				          i.evidence->>'selected' = 'direct' AS evidence_direct,
				          i.evidence->>'selected' = 'refactor_first' AS evidence_refactor,
				          coalesce(i.replay->>'status' = 'diverged', false) AS replay_rejected
				   FROM eval_iterations i
				 ), iteration_totals AS (
				   SELECT experiment_id, target_id, scenario_id, replicate,
				          count(*) AS n, sum(files) AS files,
				          count(*) FILTER (WHERE NOT correct) AS hidden_failures,
				          count(*) FILTER (WHERE correct) AS correct_iterations,
				          sum(prod_add) FILTER (WHERE correct) AS prod_add,
				          sum(prod_del) FILTER (WHERE correct) AS prod_del,
				          sum(prod_files) FILTER (WHERE correct) AS prod_files,
				          sum(prod_add + prod_del) AS attempted_churn,
				          count(*) FILTER (WHERE replay_rejected) AS replay_rejections,
				          coalesce(regr_slope((prod_add + prod_del)::double precision, ordinal::double precision) FILTER (WHERE correct), 0) AS churn_slope,
				          coalesce(regr_slope(prod_files::double precision, ordinal::double precision) FILTER (WHERE correct), 0) AS module_slope,
				          count(*) FILTER (WHERE intervention_call) AS intervention_calls,
				          count(*) FILTER (WHERE intervention_applied) AS interventions_applied,
				          count(*) FILTER (WHERE reviewed) AS reviews,
				          count(*) FILTER (WHERE evidence_direct) AS evidence_direct,
				          count(*) FILTER (WHERE evidence_refactor) AS evidence_refactor
				   FROM iteration_metrics GROUP BY 1,2,3,4
				 ), hotspots AS (
				   SELECT experiment_id, target_id, scenario_id, replicate, sum(greatest(n - 1, 0)) AS repeated
				   FROM (
				     SELECT i.experiment_id, i.target_id, i.scenario_id, i.replicate, c->>'path' AS path, count(*) AS n
				     FROM eval_iterations i CROSS JOIN LATERAL jsonb_array_elements(i.file_changes) c
				     WHERE c->>'category' = 'production'
				       AND i.hidden_check IS NOT NULL AND (i.hidden_check->>'exitCode')::int = 0
				     GROUP BY 1,2,3,4,5
				   ) touched GROUP BY 1,2,3,4
				 ), phase_totals AS (
				   SELECT experiment_id, target_id, scenario_id, replicate,
				          sum(cost_usd) AS cost,
				          sum((usage->>'input_tokens')::bigint + (usage->>'output_tokens')::bigint) AS tokens,
				          sum(duration_ms) AS duration
				   FROM eval_agent_phases GROUP BY 1,2,3,4
				 ), final_health AS (
				   SELECT DISTINCT ON (experiment_id, target_id, scenario_id, replicate)
				          experiment_id, target_id, scenario_id, replicate, (health->>'score')::double precision AS score
				   FROM eval_iterations WHERE health IS NOT NULL
				   ORDER BY experiment_id, target_id, scenario_id, replicate, ordinal DESC
				 ), final_signals AS (
				   SELECT DISTINCT ON (experiment_id, target_id, scenario_id, replicate)
				          experiment_id, target_id, scenario_id, replicate, (signals->>'healthWhereWorkIs')::double precision AS where_work_is
				   FROM eval_iterations WHERE signals IS NOT NULL
				   ORDER BY experiment_id, target_id, scenario_id, replicate, ordinal DESC
				 )
				 SELECT t.target_id, t.scenario_id,
				        count(DISTINCT t.replicate)::text AS trajectories,
				        count(DISTINCT t.replicate) FILTER (WHERE t.status = 'completed')::text AS completed,
				        coalesce(avg(it.n), 0)::text AS mean_iterations,
				        coalesce(sum(pt.cost), 0)::text AS total_cost_usd,
				        coalesce(sum(pt.tokens), 0)::text AS total_tokens,
				        coalesce(sum(pt.duration), 0)::text AS total_duration_ms,
				        coalesce(sum(it.files), 0)::text AS total_files_touched,
				        coalesce(sum(it.hidden_failures), 0)::text AS hidden_failures,
				        coalesce(sum(it.correct_iterations), 0)::text AS correct_iterations,
				        coalesce(sum(it.prod_add), 0)::text AS production_additions,
				        coalesce(sum(it.prod_del), 0)::text AS production_deletions,
				        coalesce(sum(it.prod_files), 0)::text AS production_files_touched,
				        coalesce(sum(it.attempted_churn), 0)::text AS attempted_production_churn,
				        coalesce(sum(it.replay_rejections), 0)::text AS replay_rejections,
				        avg(fh.score)::text AS mean_final_health,
				        avg(fs.where_work_is)::text AS mean_final_health_where_work_is,
				        coalesce(sum(h.repeated), 0)::text AS repeated_hotspot_edits,
				        coalesce(avg(it.churn_slope), 0)::text AS mean_churn_slope,
				        coalesce(avg(it.module_slope), 0)::text AS mean_module_touch_slope,
				        coalesce(sum(it.intervention_calls), 0)::text AS intervention_calls,
				        coalesce(sum(it.interventions_applied), 0)::text AS interventions_applied,
				        coalesce(sum(it.reviews), 0)::text AS reviews,
				        coalesce(sum(it.evidence_direct), 0)::text AS evidence_direct,
				        coalesce(sum(it.evidence_refactor), 0)::text AS evidence_refactor
				 FROM eval_trajectories t
				 LEFT JOIN iteration_totals it USING (experiment_id, target_id, scenario_id, replicate)
				 LEFT JOIN hotspots h USING (experiment_id, target_id, scenario_id, replicate)
				 LEFT JOIN phase_totals pt USING (experiment_id, target_id, scenario_id, replicate)
				 LEFT JOIN final_health fh USING (experiment_id, target_id, scenario_id, replicate)
				 LEFT JOIN final_signals fs USING (experiment_id, target_id, scenario_id, replicate)
				 WHERE t.experiment_id = $1
				 GROUP BY t.target_id, t.scenario_id
				 ORDER BY t.target_id, t.scenario_id`,
				[experimentId],
			);
			return result.rows.map((row) => ({
				targetId: row.target_id,
				scenarioId: row.scenario_id,
				trajectories: Number(row.trajectories),
				completed: Number(row.completed),
				meanIterations: Number(row.mean_iterations),
				totalCostUsd: Number(row.total_cost_usd),
				totalTokens: Number(row.total_tokens),
				totalDurationMs: Number(row.total_duration_ms),
				totalFilesTouched: Number(row.total_files_touched),
				hiddenFailures: Number(row.hidden_failures),
				correctIterations: Number(row.correct_iterations),
				productionAdditions: Number(row.production_additions),
				productionDeletions: Number(row.production_deletions),
				productionFilesTouched: Number(row.production_files_touched),
				attemptedProductionChurn: Number(row.attempted_production_churn),
				repeatedHotspotEdits: Number(row.repeated_hotspot_edits),
				meanChurnSlope: Number(row.mean_churn_slope),
				meanModuleTouchSlope: Number(row.mean_module_touch_slope),
				interventionCalls: Number(row.intervention_calls),
				interventionsApplied: Number(row.interventions_applied),
				reviews: Number(row.reviews),
				evidenceDirectSelections: Number(row.evidence_direct),
				evidenceRefactorSelections: Number(row.evidence_refactor),
				meanFinalHealth: row.mean_final_health === null ? null : Number(row.mean_final_health),
				meanFinalHealthWhereWorkIs: row.mean_final_health_where_work_is === null ? null : Number(row.mean_final_health_where_work_is),
				replayRejections: Number(row.replay_rejections),
			}));
		},

		/** One row per iteration with model cost split into feature implementation and intervention phases. */
		async iterationCosts(experimentIds: readonly string[]): Promise<IterationCostRow[]> {
			const result = await db.query<Record<string, string | boolean | null>>(
				`SELECT i.experiment_id, i.target_id, i.scenario_id, i.replicate, i.ordinal,
				        i.hidden_check IS NOT NULL AND (i.hidden_check->>'exitCode')::int = 0 AS correct,
				        coalesce((SELECT sum((c->>'additions')::int + (c->>'deletions')::int) FROM jsonb_array_elements(i.file_changes) c
				                  WHERE c->>'category' = 'production'), 0)::text AS production_churn,
				        (i.health->>'score') AS health,
				        (i.signals->>'healthWhereWorkIs') AS health_where_work_is,
				        coalesce((i.intervention->>'triggered')::boolean, false) AS triggered,
				        coalesce((i.intervention->>'applied')::boolean, false) AS applied,
				        coalesce(sum(p.cost_usd) FILTER (WHERE p.phase = 'implement'), 0)::text AS implement_cost,
				        coalesce(sum((p.usage->>'input_tokens')::bigint + (p.usage->>'output_tokens')::bigint) FILTER (WHERE p.phase = 'implement'), 0)::text AS implement_tokens,
				        coalesce(sum(p.cost_usd) FILTER (WHERE p.phase <> 'implement'), 0)::text AS intervention_cost,
				        coalesce(sum((p.usage->>'input_tokens')::bigint + (p.usage->>'output_tokens')::bigint) FILTER (WHERE p.phase <> 'implement'), 0)::text AS intervention_tokens
				 FROM eval_iterations i
				 LEFT JOIN eval_agent_phases p USING (experiment_id, target_id, scenario_id, replicate, ordinal)
				 WHERE i.experiment_id = ANY($1::uuid[])
				 GROUP BY i.experiment_id, i.target_id, i.scenario_id, i.replicate, i.ordinal
				 ORDER BY i.experiment_id, i.target_id, i.scenario_id, i.replicate, i.ordinal`,
				[experimentIds],
			);
			return result.rows.map((row) => ({
				experimentId: String(row.experiment_id),
				targetId: String(row.target_id),
				scenarioId: String(row.scenario_id),
				replicate: Number(row.replicate),
				ordinal: Number(row.ordinal),
				correct: row.correct === true,
				productionChurn: Number(row.production_churn),
				health: row.health === null ? null : Number(row.health),
				healthWhereWorkIs: row.health_where_work_is === null ? null : Number(row.health_where_work_is),
				interventionTriggered: row.triggered === true,
				interventionApplied: row.applied === true,
				implementCostUsd: Number(row.implement_cost),
				implementTokens: Number(row.implement_tokens),
				interventionCostUsd: Number(row.intervention_cost),
				interventionTokens: Number(row.intervention_tokens),
			}));
		},
	};
}

async function upsertIteration(client: PoolClient, input: RunTrajectoryInput, iteration: IterationResult): Promise<void> {
	await client.query(
		`INSERT INTO eval_iterations
		 (experiment_id,target_id,scenario_id,replicate,ordinal,step_id,status,before_sha,after_sha,prompt_hash,
		  public_checks,hidden_check,changed_paths,additions,deletions,file_changes,intervention,evidence,patch,error,
		  health,refactor_health_before,replay,signals)
		 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12::jsonb,$13::jsonb,$14,$15,$16::jsonb,$17::jsonb,$18::jsonb,$19,$20,
		  $21::jsonb,$22,$23::jsonb,$24::jsonb)
		 ON CONFLICT (experiment_id,target_id,scenario_id,replicate,ordinal)
		 DO UPDATE SET step_id=EXCLUDED.step_id,status=EXCLUDED.status,before_sha=EXCLUDED.before_sha,
		  after_sha=EXCLUDED.after_sha,prompt_hash=EXCLUDED.prompt_hash,public_checks=EXCLUDED.public_checks,
		  hidden_check=EXCLUDED.hidden_check,changed_paths=EXCLUDED.changed_paths,additions=EXCLUDED.additions,
		  deletions=EXCLUDED.deletions,file_changes=EXCLUDED.file_changes,intervention=EXCLUDED.intervention,
		  evidence=EXCLUDED.evidence,patch=EXCLUDED.patch,error=EXCLUDED.error,
		  health=EXCLUDED.health,refactor_health_before=EXCLUDED.refactor_health_before,replay=EXCLUDED.replay,signals=EXCLUDED.signals`,
		[
			...trajectoryKey(input),
			iteration.ordinal,
			iteration.stepId,
			iteration.status,
			iteration.beforeSha,
			iteration.afterSha,
			iteration.promptHash,
			JSON.stringify(iteration.publicChecks),
			iteration.hiddenCheck ? JSON.stringify(iteration.hiddenCheck) : null,
			JSON.stringify(iteration.changedPaths),
			iteration.additions,
			iteration.deletions,
			JSON.stringify(iteration.fileChanges),
			JSON.stringify(iteration.intervention),
			iteration.evidence ? JSON.stringify(iteration.evidence) : null,
			iteration.patch,
			iteration.error ?? null,
			iteration.health ? JSON.stringify(iteration.health) : null,
			iteration.refactorHealthBefore ?? null,
			iteration.replay ? JSON.stringify(iteration.replay) : null,
			iteration.signals ? JSON.stringify(iteration.signals) : null,
		],
	);
}

export const evalStore = createEvalStore({
	query: (...args: Parameters<Pool["query"]>) => pool().query(...args),
	connect: () => pool().connect(),
} as Pick<Pool, "query" | "connect">);
