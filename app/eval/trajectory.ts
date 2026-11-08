import { createHash } from "node:crypto";
import { cumulativeHiddenTest, cumulativePublicTest, type EvalTarget } from "../../eval/targets/index.js";
import type { Agent, OutputSchema } from "../agents/define.js";
import { AgentError, type AgentRun, runAgent } from "../agents/run.js";
import type { Usage } from "../runner/core/protocol.js";
import { EvalReview, type EvalReviewFinding } from "../schemas/eval.js";
import type { Sandbox } from "../sandbox/index.js";
import { AI_FRIENDLY_HEALTH, analyzeHealth, type FileHealth, type HealthFinding, type HealthSnapshot, newFindings } from "./health.js";
import type { EvalScenario } from "./scenarios.js";
import {
	COUPLING_MIN_SHARED,
	couplingCluster,
	decayingHotspots,
	describeSignals,
	type HotspotSignal,
	measureSignals,
	SIGNAL_WINDOW,
	type SignalSnapshot,
} from "./signals.js";
import {
	EVAL_WORKDIR,
	prepareEvalWorkspace,
	readWorkspaceFile,
	readWorkspaceSources,
	removeHiddenTest,
	removePublicFeatureTest,
	runInWorkspace,
	uploadHiddenTest,
	uploadPublicFeatureTest,
	uploadWorkspaceFile,
} from "./workspace.js";

export interface CommandResult {
	command: string;
	exitCode: number;
	durationMs: number;
	stdout: string;
	stderr: string;
}

export interface AgentPhase {
	phase: "implement" | "review" | "post_refactor" | "trace_author" | "direct_probe" | "pre_refactor_probe" | "refactor_first_probe";
	agentId: string;
	turns: number;
	usage: Usage;
	costUsd: number;
	durationMs: number;
	output: unknown;
}

export type ChangeCategory = "production" | "test" | "config";

export interface FileChange {
	path: string;
	additions: number;
	deletions: number;
	category: ChangeCategory;
}

export interface HealthEvidence {
	path: string;
	score: number;
	hotspot: boolean;
	findings: HealthFinding[];
}

export interface InterventionDecision {
	triggered: boolean;
	applied: boolean;
	reason: string;
	productionChurnSinceLast: number;
	hotspotPaths: string[];
	/** The measured evidence given to a briefed refactorer. */
	evidence?: HealthEvidence[];
	/** The refactoring skill's review of this feature and the finding chosen to apply, if any. */
	review?: SkillReview;
	/** Files in more than one directory that the coupling gate saw changing together. */
	couplingCluster?: string[];
	/** Hot files below the health bar that got worse during the window, as the signals gate saw them. */
	decayingHotspots?: HotspotSignal[];
}

export interface SkillReview {
	summary: string;
	staticOnly: boolean;
	findings: EvalReviewFinding[];
	chosen?: string;
	error?: string;
}

export interface ReplayGuardResult {
	status: "passed" | "diverged" | "skipped" | "unavailable";
	reason: string;
	cases: number;
	outputHash?: string;
	divergence?: { line: number; expected: string; actual: string };
}

export interface EvidenceCandidateSummary {
	publicPassed: boolean;
	productionChurn: number;
	productionFiles: number;
}

export interface EvidenceDecision {
	selected: "direct" | "refactor_first";
	reason: string;
	direct: EvidenceCandidateSummary;
	refactorFirst: EvidenceCandidateSummary;
}

export interface IterationResult {
	ordinal: number;
	stepId: string;
	beforeSha: string;
	afterSha: string;
	promptHash: string;
	status: "completed" | "public_verify_failed" | "agent_failed";
	agentPhases: AgentPhase[];
	publicChecks: CommandResult[];
	hiddenCheck?: CommandResult & { passed: number; failed: number };
	changedPaths: string[];
	additions: number;
	deletions: number;
	fileChanges: FileChange[];
	intervention: InterventionDecision;
	evidence?: EvidenceDecision;
	/** Structural health of production code the next feature inherits. */
	health?: HealthSnapshot;
	/** Health at the implementation checkpoint, before a post-implementation refactor. */
	refactorHealthBefore?: number;
	/** Health v2, heat, and coupling of the code the next feature inherits. */
	signals?: SignalSnapshot;
	replay?: ReplayGuardResult;
	patch: string;
	error?: string;
}

export interface TrajectoryResult {
	targetId: string;
	scenarioId: string;
	status: "completed" | "stopped";
	iterations: IterationResult[];
	finalTreeHash: string;
}

export interface TrajectoryDeps {
	runAgent?: typeof runAgent;
	onIteration?: (result: IterationResult) => Promise<void>;
}

interface PhaseContext {
	sandbox: Sandbox;
	invoke: typeof runAgent;
	traceId: string;
	target: EvalTarget;
	ordinal: number;
	phases: AgentPhase[];
}

export const REPLAY_TRACE_PATH = ".eval-trace/replay.ts";

export async function executeTrajectory(
	sandbox: Sandbox,
	target: EvalTarget,
	scenario: EvalScenario,
	traceId: string,
	deps: TrajectoryDeps = {},
): Promise<TrajectoryResult> {
	const invoke = deps.runAgent ?? runAgent;
	await prepareEvalWorkspace(sandbox, target, scenario.skill ?? (scenario.exposesSkill ? "stub" : undefined));
	const seed = await readCheckpoint(sandbox);
	const seedHealth = seed.health;
	const seedSignals = measureSignals(seed.sources, []);
	const iterations: IterationResult[] = [];

	for (let ordinal = 0; ordinal < target.steps.length; ordinal++) {
		const step = target.steps[ordinal];
		const publicFeatureTest = cumulativePublicTest(target, ordinal);
		if (publicFeatureTest) await uploadPublicFeatureTest(sandbox, publicFeatureTest);
		const beforeSha = await gitOutput(sandbox, "rev-parse HEAD");
		const phases: AgentPhase[] = [];
		const ctx: PhaseContext = { sandbox, invoke, traceId, target, ordinal, phases };
		let status: IterationResult["status"] = "completed";
		let error: string | undefined;
		let publicChecks: CommandResult[] = [];
		let evidence: EvidenceDecision | undefined;
		let intervention: InterventionDecision;
		let checkpoint: Checkpoint | undefined;
		let health: HealthSnapshot | undefined;
		let refactorHealthBefore: number | undefined;
		let replay: ReplayGuardResult | undefined;

		if (scenario.intervention === "evidence_seeking") {
			const comparison = await runEvidenceComparison(ctx, scenario, beforeSha, publicFeatureTest);
			publicChecks = comparison.publicChecks;
			evidence = comparison.evidence;
			intervention = {
				triggered: true,
				applied: evidence.selected === "refactor_first" && comparison.refactorApplied,
				reason: evidence.reason,
				productionChurnSinceLast: 0,
				hotspotPaths: [],
			};
			if (!comparison.selectedPassed) {
				status = "public_verify_failed";
				error = comparison.error;
			}
		} else {
			const implemented = await runPhase(ctx, "implement", scenario.implementer, featureMessage(target, ordinal));
			if (!implemented.ok) {
				status = "agent_failed";
				error = implemented.error;
			}

			if (publicFeatureTest) await uploadPublicFeatureTest(sandbox, publicFeatureTest);
			publicChecks = status === "completed" ? await verify(sandbox, target.publicVerify) : [];
			if (publicChecks.some((result) => result.exitCode !== 0)) status = "public_verify_failed";

			const implementationChanges = status === "completed" ? await unstagedFileChanges(sandbox, beforeSha) : [];
			if (status === "completed") {
				checkpoint = await readCheckpoint(sandbox);
				health = checkpoint.health;
			}
			intervention =
				status === "completed"
					? decideIntervention(
							scenario,
							iterations,
							implementationChanges,
							ordinal,
							target.steps.length,
							checkpoint && {
								current: checkpoint.health,
								seed: seedHealth,
								signals: {
									current: measureSignals(checkpoint.sources, [...iterations.map((iteration) => iteration.fileChanges), implementationChanges]),
									seed: seedSignals,
								},
							},
						)
					: {
							triggered: false,
							applied: false,
							reason: "implementation did not pass public verification",
							productionChurnSinceLast: 0,
							hotspotPaths: [],
						};

			// A window-wide signal spans several features, so files the current feature did not touch stay in scope.
			const windowBase =
				intervention.couplingCluster || intervention.decayingHotspots
					? iterations.find((iteration) => iteration.ordinal === ordinal - (SIGNAL_WINDOW - 1))?.beforeSha
					: undefined;

			// A gated review runs only when its gate opens; the skill still decides whether and what to refactor.
			if (status === "completed" && scenario.reviewer && (scenario.intervention === "skill_review" || intervention.triggered)) {
				intervention = await runSkillReview(ctx, scenario, scenario.reviewer, windowBase ?? beforeSha, intervention);
			}

			if (status === "completed" && scenario.postRefactor && intervention.triggered) {
				if (scenario.briefing && health) {
					intervention.evidence = refactorEvidence(scenario, iterations, implementationChanges, intervention.hotspotPaths, health, seedHealth);
				}
				refactorHealthBefore = health?.score;
				const outcome = await runPostRefactor(ctx, scenario, scenario.postRefactor, { beforeSha, windowBase }, intervention, publicFeatureTest);
				publicChecks.push(...outcome.publicChecks);
				replay = outcome.replay;
				if (outcome.status !== "completed") {
					status = outcome.status;
					error = outcome.error;
				}
				checkpoint = status === "completed" ? await readCheckpoint(sandbox) : undefined;
				health = checkpoint?.health;
			}
		}
		if (status === "completed" && !checkpoint) {
			checkpoint = await readCheckpoint(sandbox);
			health = checkpoint.health;
		}

		let hiddenCheck: IterationResult["hiddenCheck"];
		if (status === "completed") {
			await uploadHiddenTest(sandbox, cumulativeHiddenTest(target, ordinal));
			try {
				const result = await runInWorkspace(sandbox, "npm test");
				hiddenCheck = {
					command: "npm test (cumulative hidden)",
					...result,
					passed: testCount(result.stdout, "pass"),
					failed: testCount(result.stdout, "fail"),
				};
			} finally {
				await removeHiddenTest(sandbox);
			}
		}

		await runInWorkspace(sandbox, `git add -A && git commit --quiet --allow-empty -m ${shellQuote(`iteration ${ordinal + 1}: ${step.id}`)}`);
		const afterSha = await gitOutput(sandbox, "rev-parse HEAD");
		const fileChanges = parseNumstat(await gitOutput(sandbox, `diff --numstat ${beforeSha}..${afterSha}`));
		const changedPaths = fileChanges.map((change) => change.path);
		const additions = fileChanges.reduce((total, change) => total + change.additions, 0);
		const deletions = fileChanges.reduce((total, change) => total + change.deletions, 0);
		const patch = (await gitOutput(sandbox, `diff --no-ext-diff --unified=3 ${beforeSha}..${afterSha}`)).slice(0, 200_000);
		const signals = checkpoint && measureSignals(checkpoint.sources, [...iterations.map((iteration) => iteration.fileChanges), fileChanges]);
		const result: IterationResult = {
			ordinal,
			stepId: step.id,
			beforeSha,
			afterSha,
			promptHash: createHash("sha256").update(scenario.implementer.prompt).update(step.prompt).digest("hex"),
			status,
			agentPhases: phases,
			publicChecks,
			...(hiddenCheck ? { hiddenCheck } : {}),
			changedPaths,
			additions,
			deletions,
			fileChanges,
			intervention,
			...(evidence ? { evidence } : {}),
			...(health ? { health } : {}),
			...(refactorHealthBefore !== undefined ? { refactorHealthBefore } : {}),
			...(signals ? { signals } : {}),
			...(replay ? { replay } : {}),
			patch,
			...(error ? { error } : {}),
		};
		iterations.push(result);
		await deps.onIteration?.(result);
		if (status !== "completed") break;
	}

	return {
		targetId: target.id,
		scenarioId: scenario.id,
		status: iterations.length === target.steps.length && iterations.every((iteration) => iteration.status === "completed") ? "completed" : "stopped",
		iterations,
		finalTreeHash: await gitOutput(sandbox, "rev-parse HEAD^{tree}"),
	};
}

function featureMessage(target: EvalTarget, ordinal: number): string {
	const step = target.steps[ordinal];
	return [
		`Target: ${target.title}`,
		`Iteration: ${ordinal + 1} of ${target.steps.length}`,
		`Requirement: ${step.prompt}`,
		"",
		"Implement only this requirement. Future requirements and hidden evaluation tests are intentionally unavailable.",
	].join("\n");
}

const EMPTY_USAGE: Usage = { input_tokens: 0, output_tokens: 0, cache_read_tokens: 0, cache_write_tokens: 0, cost_usd: 0 };

/** Runs one agent phase and records it, including what a failed run spent, so failed arms are not artificially cheap. */
async function runPhase(
	ctx: PhaseContext,
	kind: AgentPhase["phase"],
	agent: Agent,
	message: string,
): Promise<{ ok: true; output: unknown } | { ok: false; error: string }> {
	const started = Date.now();
	try {
		const run = await ctx.invoke(agent, message, {
			sandbox: ctx.sandbox,
			traceId: ctx.traceId,
			runId: `${ctx.traceId}:${ctx.ordinal}:${kind.replaceAll("_", "-")}`,
			repo: ctx.target.id,
			subject: ctx.target.steps[ctx.ordinal].id,
			cwd: EVAL_WORKDIR,
		});
		ctx.phases.push(phase(kind, agent.id, run, Date.now() - started));
		return { ok: true, output: run.output };
	} catch (err) {
		if (isTransientAgentError(err)) throw err;
		const message = err instanceof Error ? err.message : String(err);
		const spent = err instanceof AgentError ? err.spent : undefined;
		ctx.phases.push({
			phase: kind,
			agentId: agent.id,
			turns: spent?.turns ?? 0,
			usage: spent?.usage ?? EMPTY_USAGE,
			costUsd: spent?.costUsd ?? 0,
			durationMs: Date.now() - started,
			output: { error: message.slice(0, 4000) },
		});
		return { ok: false, error: message };
	}
}

function phase<Output extends OutputSchema>(kind: AgentPhase["phase"], agentId: string, run: AgentRun<Output>, durationMs: number): AgentPhase {
	return { phase: kind, agentId, turns: run.turns, usage: run.usage, costUsd: run.costUsd, durationMs, output: run.output };
}

interface Checkpoint {
	sources: Record<string, string>;
	health: HealthSnapshot;
}

async function readCheckpoint(sandbox: Sandbox): Promise<Checkpoint> {
	const sources = await readWorkspaceSources(sandbox);
	return { sources, health: analyzeHealth(sources) };
}

interface PostRefactorOutcome {
	status: IterationResult["status"];
	error?: string;
	publicChecks: CommandResult[];
	replay?: ReplayGuardResult;
}

interface RefactorBases {
	/** The commit before this feature. */
	beforeSha: string;
	/** The commit before the signal window, when a window-wide signal opened the refactor. */
	windowBase?: string;
}

async function runPostRefactor(
	ctx: PhaseContext,
	scenario: EvalScenario,
	refactorer: Agent,
	bases: RefactorBases,
	intervention: InterventionDecision,
	publicFeatureTest: string | undefined,
): Promise<PostRefactorOutcome> {
	const { beforeSha } = bases;
	const { sandbox, target, ordinal } = ctx;
	const step = target.steps[ordinal];
	const publicChecks: CommandResult[] = [];
	let replay: ReplayGuardResult | undefined;
	try {
		const apiBefore = await exportedApiSurface(sandbox);
		await runInWorkspace(
			sandbox,
			`git add -A && git commit --quiet --allow-empty -m ${shellQuote(`implementation checkpoint ${ordinal + 1}: ${step.id}`)}`,
		);
		const implementationSha = await gitOutput(sandbox, "rev-parse HEAD");
		const canonical = scenario.replayCanonical === true;
		const trace = scenario.traceAuthor ? await recordReplayTrace(ctx, scenario.traceAuthor, implementationSha, canonical) : undefined;
		if (trace?.status === "unavailable") replay = { status: "unavailable", reason: trace.reason, cases: 0 };

		const beforeRefactor = await workingTreeFingerprint(sandbox, beforeSha);
		const refactored = await runPhase(ctx, "post_refactor", refactorer, refactorMessage(scenario, target, ordinal, intervention, bases));
		if (!refactored.ok) return { status: "agent_failed", error: refactored.error, publicChecks, ...(replay ? { replay } : {}) };
		intervention.applied = (await workingTreeFingerprint(sandbox, beforeSha)) !== beforeRefactor;

		const apiAfter = await exportedApiSurface(sandbox);
		let rejection: string | undefined;
		if (!isApiCompatible(apiBefore, apiAfter)) {
			await restoreCheckpoint(sandbox, implementationSha);
			intervention.applied = false;
			intervention.reason += "; refactor rejected because exported runtime API changed";
			rejection = "the exported runtime API changed";
			publicChecks.push(guardNote("exported runtime API compatibility"));
		}

		if (trace?.status === "recorded") {
			if (!intervention.applied) {
				replay = { status: "skipped", reason: "no refactor remained to compare", cases: trace.cases, outputHash: trace.outputHash };
			} else {
				replay = await compareReplayTrace(sandbox, trace, canonical);
				if (replay.status === "diverged") {
					await restoreCheckpoint(sandbox, implementationSha);
					intervention.applied = false;
					intervention.reason += "; refactor rejected because replay trace output changed";
					rejection = "the replay trace output changed";
					publicChecks.push(guardNote("replay trace comparison"));
				}
			}
		}
		if (rejection) await recordRejection(sandbox, intervention, rejection);

		if (publicFeatureTest) await uploadPublicFeatureTest(sandbox, publicFeatureTest);
		const postChecks = await verify(sandbox, target.publicVerify);
		publicChecks.push(...postChecks);
		return {
			status: postChecks.some((result) => result.exitCode !== 0) ? "public_verify_failed" : "completed",
			publicChecks,
			...(replay ? { replay } : {}),
		};
	} catch (err) {
		if (isTransientAgentError(err)) throw err;
		return { status: "agent_failed", error: err instanceof Error ? err.message : String(err), publicChecks, ...(replay ? { replay } : {}) };
	}
}

const guardNote = (command: string): CommandResult => ({
	command,
	exitCode: 0,
	durationMs: 0,
	stdout: "Refactor rejected and implementation checkpoint restored.",
	stderr: "",
});

/** Discards everything after the checkpoint, including files the refactor created. */
async function restoreCheckpoint(sandbox: Sandbox, sha: string): Promise<void> {
	await runInWorkspace(sandbox, `git reset --hard --quiet ${shellQuote(sha)} && git clean -fdq`);
}

function refactorMessage(
	scenario: EvalScenario,
	target: EvalTarget,
	ordinal: number,
	intervention: InterventionDecision,
	bases: RefactorBases,
): string {
	const step = target.steps[ordinal];
	const chosen = intervention.review?.findings.find((finding) => finding.id === intervention.review?.chosen);
	if (chosen) {
		return [
			`Feature ${ordinal + 1} (${step.id}) has been implemented and committed. A refactoring review of it recommends acting on this finding:`,
			"",
			JSON.stringify(chosen, null, 2),
			"",
			"The full review is in `.refactor/report.md` and `.refactor/findings.json`.",
		].join("\n");
	}
	if (scenario.intervention === "signals_triggered") {
		// The harness commits the implementation checkpoint before the refactor runs, so the feature is HEAD, not an uncommitted diff.
		return [
			`Feature ${ordinal + 1} (${step.id}) is implemented and committed as HEAD. Its change is \`git diff ${bases.beforeSha} HEAD\`${
				bases.windowBase ? `; the last ${SIGNAL_WINDOW} features are \`git diff ${bases.windowBase} HEAD\`` : ""
			}.`,
			"",
			"Change-history signals opened this refactor. They say where to look, not what to change:",
			...describeSignals(intervention.decayingHotspots, intervention.couplingCluster),
		].join("\n");
	}
	// Stored series 1 arms used this wording; it stays unchanged so they remain comparable.
	const task = `Feature ${ordinal + 1} (${step.id}) has been implemented. Inspect the current uncommitted diff and apply the bounded post-implementation procedure.`;
	if (!scenario.briefing) return task;
	const evidence = intervention.evidence ?? [];
	const heading =
		scenario.intervention === "health_safeguard"
			? "Structural findings this feature added (health 10 is best; 9.5 is the bar):"
			: `Measured structural evidence (health 10 is best; 9.5 is the bar). Trigger: ${intervention.reason}.`;
	const lines = evidence.flatMap((file) => [
		`- ${file.path}: health ${file.score}${file.hotspot ? "; changed in at least three of the last four features" : ""}`,
		...file.findings.map((finding) => `  - ${describeFinding(finding)}`),
	]);
	return [task, "", heading, ...(lines.length > 0 ? lines : ["- No production file has a structural finding."])].join("\n");
}

function describeFinding(finding: HealthFinding): string {
	const where =
		finding.kind === "duplicated_block"
			? `lines ${finding.symbol.slice(finding.symbol.lastIndexOf(":") + 1)}`
			: `${finding.symbol} at line ${finding.line}`;
	const detail: Record<HealthFinding["kind"], string> = {
		complex_method: `cyclomatic complexity ${finding.value}`,
		deep_nesting: `nesting depth ${finding.value}`,
		bumpy_road: `${finding.value} separately nested chunks`,
		large_method: `${finding.value} lines`,
		excess_arguments: `${finding.value} parameters`,
		complex_conditional: `${finding.value} logical operators in one condition`,
		duplicated_block: `${finding.value} lines duplicated elsewhere`,
		large_file: `${finding.value} lines`,
	};
	return `${finding.kind.replaceAll("_", " ")}, ${where}: ${detail[finding.kind]}`;
}

const MAX_EVIDENCE_FILES = 8;
const MAX_EVIDENCE_FINDINGS = 10;

export function refactorEvidence(
	scenario: EvalScenario,
	history: readonly IterationResult[],
	currentChanges: readonly FileChange[],
	hotspotPaths: readonly string[],
	health: HealthSnapshot,
	seedHealth: HealthSnapshot,
): HealthEvidence[] {
	const touched = [...new Set(currentChanges.filter((change) => change.category === "production").map((change) => change.path))];
	const hotspots = new Set(hotspotPaths);
	if (scenario.intervention === "health_safeguard") {
		const previous = latestHealth(history) ?? seedHealth;
		return touched
			.flatMap((path) => {
				const file = fileIn(health, path);
				const added = file ? newFindings(fileIn(previous, path), file) : [];
				return file && added.length > 0 ? [{ path, score: file.score, hotspot: hotspots.has(path), findings: added }] : [];
			})
			.slice(0, MAX_EVIDENCE_FILES)
			.map((file) => ({ ...file, findings: file.findings.slice(0, MAX_EVIDENCE_FINDINGS) }));
	}
	return [...new Set([...hotspotPaths, ...touched])]
		.flatMap((path) => {
			const file = fileIn(health, path);
			return file && (file.findings.length > 0 || file.score < AI_FRIENDLY_HEALTH)
				? [{ path, score: file.score, hotspot: hotspots.has(path), findings: file.findings.slice(0, MAX_EVIDENCE_FINDINGS) }]
				: [];
		})
		.sort((a, b) => a.score - b.score || Number(b.hotspot) - Number(a.hotspot))
		.slice(0, MAX_EVIDENCE_FILES);
}

const ACTIONABLE_WHEN = new Set<EvalReviewFinding["when"]>(["now", "next-change"]);
/** The harness restores these after every change, so a finding in them cannot be applied. */
const HARNESS_OWNED_TESTS = new Set(["tests/public.test.ts", "tests/feature.test.ts"]);

/**
 * The preregistered decision rule: apply the skill's highest-ranked finding that it says to act on now or at this change,
 * that it is confident in, that is not high risk, whose every plan step preserves behavior, and that does not sit in a
 * harness-owned acceptance test. Everything else waits.
 */
export function chooseReviewFinding(findings: readonly EvalReviewFinding[]): EvalReviewFinding | undefined {
	return findings.find(
		(finding) =>
			ACTIONABLE_WHEN.has(finding.when) &&
			finding.confidence !== "low" &&
			finding.risk !== "high" &&
			finding.plan.length > 0 &&
			finding.plan.every((step) => step.behavior === "preserving") &&
			!finding.sites.some((site) => HARNESS_OWNED_TESTS.has(site.path)),
	);
}

/** The reviewer may write the skill's `.refactor/` files; anything else it changes is discarded before a decision. */
async function runSkillReview(
	ctx: PhaseContext,
	scenario: EvalScenario,
	reviewer: Agent,
	reviewBase: string,
	base: InterventionDecision,
): Promise<InterventionDecision> {
	const { sandbox, target, ordinal } = ctx;
	const step = target.steps[ordinal];
	await runInWorkspace(sandbox, `git add -A && git commit --quiet --allow-empty -m ${shellQuote(`review checkpoint ${ordinal + 1}: ${step.id}`)}`);
	const message =
		scenario.intervention === "signals_triggered"
			? signalsReviewMessage(target, ordinal, reviewBase, base)
			: reviewMessage(target, ordinal, reviewBase, base.couplingCluster);
	const reviewed = await runPhase(ctx, "review", reviewer, message);
	await runInWorkspace(sandbox, "git checkout --quiet HEAD -- . ':(exclude).refactor' && git clean -fdq -- . ':(exclude).refactor'");
	if (!reviewed.ok) {
		return {
			...base,
			triggered: false,
			reason: "skill review failed",
			review: { summary: "", staticOnly: true, findings: [], error: reviewed.error.slice(0, 2000) },
		};
	}
	const review = EvalReview.parse(reviewed.output);
	const chosen = chooseReviewFinding(review.findings);
	const gate = base.triggered ? `${base.reason}; ` : "";
	return {
		...base,
		triggered: chosen !== undefined,
		reason: chosen
			? `${gate}skill review: act ${chosen.when} on ${chosen.fingerprint} (severity ${chosen.severity}, risk ${chosen.risk}, effort ${chosen.effort})`
			: `${gate}skill review found nothing to act on now (${review.findings.length} finding${review.findings.length === 1 ? "" : "s"})`,
		review: { summary: review.summary, staticOnly: review.static_only, findings: review.findings, ...(chosen ? { chosen: chosen.id } : {}) },
	};
}

function reviewMessage(target: EvalTarget, ordinal: number, reviewBase: string, cluster?: readonly string[]): string {
	const step = target.steps[ordinal];
	const header = [`Target: ${target.title}`, `Feature ${ordinal + 1} (${step.id}) is committed as HEAD. Its requirement was: ${step.prompt}`, ""];
	if (!cluster) return [...header, `Review the change since ${reviewBase} as a pull request, in diff scope (--diff ${reviewBase}).`].join("\n");
	return [
		...header,
		`In ${COUPLING_MIN_SHARED} of the last ${SIGNAL_WINDOW} features, these files all changed together: ${cluster.join(", ")}.`,
		`Review the last ${SIGNAL_WINDOW} features as one pull request, in diff scope (--diff ${reviewBase}), starting from those files.`,
	].join("\n");
}

function signalsReviewMessage(target: EvalTarget, ordinal: number, reviewBase: string, base: InterventionDecision): string {
	const step = target.steps[ordinal];
	return [
		`Target: ${target.title}`,
		`Feature ${ordinal + 1} (${step.id}) is committed as HEAD. Its requirement was: ${step.prompt}`,
		"",
		"Change-history signals opened this review. They say where to look, not what to change:",
		...describeSignals(base.decayingHotspots, base.couplingCluster),
		"",
		`Review the last ${SIGNAL_WINDOW} features as one pull request, in diff scope (--diff ${reviewBase}), starting from those files.`,
	].join("\n");
}

/** A guard rollback is a rejection the skill should remember, so its next review does not recommend the same change again. */
async function recordRejection(sandbox: Sandbox, intervention: InterventionDecision, reason: string): Promise<void> {
	const chosen = intervention.review?.findings.find((finding) => finding.id === intervention.review?.chosen);
	if (!chosen) return;
	const entry = {
		fingerprint: chosen.fingerprint,
		decision: "rejected",
		at: new Date().toISOString().slice(0, 10),
		by: "ci",
		reason: `rolled back: ${reason}`,
	};
	await runInWorkspace(sandbox, `mkdir -p .refactor && printf '%s\\n' ${shellQuote(JSON.stringify(entry))} >> .refactor/ledger.jsonl`);
}

type RecordedTrace =
	| { status: "recorded"; script: string; output: string; cases: number; outputHash: string }
	| { status: "unavailable"; reason: string };

/**
 * A separate agent writes the replay from public requirements only, so hidden tests stay hidden. The refactorer never
 * sees the script, and anything else the author touched is discarded with it.
 */
async function recordReplayTrace(ctx: PhaseContext, author: Agent, implementationSha: string, canonical: boolean): Promise<RecordedTrace> {
	const authored = await runPhase(ctx, "trace_author", author, traceAuthorMessage(ctx.target, ctx.ordinal));
	const script = authored.ok ? await readWorkspaceFile(ctx.sandbox, REPLAY_TRACE_PATH) : undefined;
	await restoreCheckpoint(ctx.sandbox, implementationSha);
	if (!authored.ok) return { status: "unavailable", reason: `trace author failed: ${authored.error.slice(0, 500)}` };
	if (!script?.trim()) return { status: "unavailable", reason: `trace author did not write ${REPLAY_TRACE_PATH}` };

	const first = await runReplay(ctx.sandbox, script);
	if (first.exitCode !== 0) return { status: "unavailable", reason: `replay exited ${first.exitCode} on the implementation: ${tail(first.stderr)}` };
	const second = await runReplay(ctx.sandbox, script);
	const output = replayOutput(first.stdout, canonical);
	if (replayOutput(second.stdout, canonical) !== output)
		return { status: "unavailable", reason: "replay output was nondeterministic on the implementation" };
	const cases = output.split("\n").filter((line) => line.trim() !== "").length;
	if (cases === 0) return { status: "unavailable", reason: "replay printed no cases" };
	return { status: "recorded", script, output, cases, outputHash: createHash("sha256").update(output).digest("hex") };
}

/** With `canonical`, each JSON line is re-serialized with sorted keys, so reordering an object's fields is not a behavior change. */
export function replayOutput(stdout: string, canonical: boolean): string {
	if (!canonical) return stdout;
	return stdout
		.split("\n")
		.map((line) => {
			try {
				return JSON.stringify(sortKeys(JSON.parse(line)));
			} catch {
				return line;
			}
		})
		.join("\n");
}

function sortKeys(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(sortKeys);
	if (value === null || typeof value !== "object") return value;
	return Object.fromEntries(
		Object.keys(value)
			.sort()
			.map((key) => [key, sortKeys((value as Record<string, unknown>)[key])]),
	);
}

async function compareReplayTrace(
	sandbox: Sandbox,
	trace: Extract<RecordedTrace, { status: "recorded" }>,
	canonical: boolean,
): Promise<ReplayGuardResult> {
	const result = await runReplay(sandbox, trace.script);
	const output = replayOutput(result.stdout, canonical);
	if (result.exitCode === 0 && output === trace.output) {
		return { status: "passed", reason: "replay output matched the implementation", cases: trace.cases, outputHash: trace.outputHash };
	}
	const expected = trace.output.split("\n");
	const actual = output.split("\n");
	let line = 0;
	while (line < Math.max(expected.length, actual.length) && expected[line] === actual[line]) line++;
	return {
		status: "diverged",
		reason: result.exitCode === 0 ? "replay output changed" : `replay exited ${result.exitCode} after the refactor: ${tail(result.stderr)}`,
		cases: trace.cases,
		outputHash: trace.outputHash,
		divergence: { line: line + 1, expected: (expected[line] ?? "").slice(0, 500), actual: (actual[line] ?? "").slice(0, 500) },
	};
}

async function runReplay(sandbox: Sandbox, script: string): Promise<{ exitCode: number; stdout: string; stderr: string }> {
	await uploadWorkspaceFile(sandbox, REPLAY_TRACE_PATH, script);
	try {
		return await runInWorkspace(sandbox, `node --experimental-strip-types ${shellQuote(REPLAY_TRACE_PATH)}`, 2 * 60 * 1000);
	} finally {
		await runInWorkspace(sandbox, "rm -rf .eval-trace");
	}
}

function traceAuthorMessage(target: EvalTarget, ordinal: number): string {
	return [
		`Target: ${target.title}`,
		`Completed requirements (1 to ${ordinal + 1}):`,
		...target.steps.slice(0, ordinal + 1).map((step, index) => `${index + 1}. ${step.prompt}`),
		"",
		`Write ${REPLAY_TRACE_PATH} for the current implementation of these requirements.`,
	].join("\n");
}

const tail = (text: string, max = 500) => (text.length > max ? `…${text.slice(-max)}` : text).trim();

interface RuntimeApiEntry {
	type: string;
	statics?: string[];
	prototype?: string[];
}

type RuntimeApiSurface = Record<string, RuntimeApiEntry>;

async function exportedApiSurface(sandbox: Sandbox): Promise<RuntimeApiSurface> {
	const script = `
const module = await import("./src/index.ts");
const ignoredFunctionKeys = new Set(["length", "name", "prototype"]);
const surface = Object.fromEntries(Object.keys(module).sort().map((name) => {
  const value = module[name];
  if (typeof value !== "function") return [name, { type: typeof value }];
  const statics = Object.getOwnPropertyNames(value).filter((key) => !ignoredFunctionKeys.has(key)).sort();
  const prototype = value.prototype
    ? Object.getOwnPropertyNames(value.prototype).filter((key) => key !== "constructor").sort()
    : [];
  return [name, { type: "function", statics, prototype }];
}));
console.log(JSON.stringify(surface));
`.trim();
	const result = await runInWorkspace(sandbox, `node --experimental-strip-types --input-type=module -e ${shellQuote(script)}`);
	if (result.exitCode !== 0) throw new Error(`failed to inspect exported runtime API: ${result.stderr || result.stdout}`);
	return JSON.parse(result.stdout) as RuntimeApiSurface;
}

function isApiCompatible(before: RuntimeApiSurface, after: RuntimeApiSurface): boolean {
	return Object.entries(before).every(([name, expected]) => {
		const actual = after[name];
		if (!actual || actual.type !== expected.type) return false;
		if (expected.type !== "function") return true;
		return (
			(expected.statics ?? []).every((key) => (actual.statics ?? []).includes(key)) &&
			(expected.prototype ?? []).every((key) => (actual.prototype ?? []).includes(key))
		);
	});
}

async function unstagedFileChanges(sandbox: Sandbox, beforeSha: string): Promise<FileChange[]> {
	await runInWorkspace(sandbox, "git add -A");
	try {
		return parseNumstat(await gitOutput(sandbox, `diff --cached --numstat ${beforeSha}`));
	} finally {
		await runInWorkspace(sandbox, "git reset --quiet");
	}
}

async function workingTreeFingerprint(sandbox: Sandbox, beforeSha: string): Promise<string> {
	await runInWorkspace(sandbox, "git add -A");
	try {
		return createHash("sha256")
			.update(await gitOutput(sandbox, `diff --cached --binary ${beforeSha}`))
			.digest("hex");
	} finally {
		await runInWorkspace(sandbox, "git reset --quiet");
	}
}

export interface EvidenceCandidate {
	kind: "direct" | "refactor_first";
	sha: string;
	publicChecks: CommandResult[];
	publicPassed: boolean;
	fileChanges: FileChange[];
	error?: string;
}

interface EvidenceComparison {
	publicChecks: CommandResult[];
	evidence: EvidenceDecision;
	selectedPassed: boolean;
	refactorApplied: boolean;
	error?: string;
}

async function runEvidenceComparison(
	ctx: PhaseContext,
	scenario: EvalScenario,
	beforeSha: string,
	publicFeatureTest: string | undefined,
): Promise<EvidenceComparison> {
	const { sandbox, target, ordinal } = ctx;
	if (!scenario.preRefactor) throw new Error(`scenario ${scenario.id} requires a pre-refactor agent`);

	const directRun = await runPhase(ctx, "direct_probe", scenario.implementer, featureMessage(target, ordinal));
	if (publicFeatureTest) await uploadPublicFeatureTest(sandbox, publicFeatureTest);
	const directChecks = await verify(sandbox, target.publicVerify);
	const direct = await commitEvidenceCandidate(sandbox, beforeSha, "direct", ordinal, directChecks, directRun.ok ? undefined : directRun.error);

	await runInWorkspace(sandbox, `git reset --hard ${shellQuote(beforeSha)}`);
	const priorPublicTest = cumulativePublicTest(target, ordinal - 1);
	if (priorPublicTest) await uploadPublicFeatureTest(sandbox, priorPublicTest);
	else await removePublicFeatureTest(sandbox);

	const beforeRefactor = await workingTreeFingerprint(sandbox, beforeSha);
	const prepared = await runPhase(ctx, "pre_refactor_probe", scenario.preRefactor, preRefactorMessage(target, ordinal));
	const refactorApplied = (await workingTreeFingerprint(sandbox, beforeSha)) !== beforeRefactor;
	if (publicFeatureTest) await uploadPublicFeatureTest(sandbox, publicFeatureTest);

	const refactorFirstRun = await runPhase(ctx, "refactor_first_probe", scenario.implementer, featureMessage(target, ordinal));
	const refactorError = [prepared.ok ? undefined : prepared.error, refactorFirstRun.ok ? undefined : refactorFirstRun.error]
		.filter(Boolean)
		.join("; ");
	if (publicFeatureTest) await uploadPublicFeatureTest(sandbox, publicFeatureTest);
	const refactorChecks = await verify(sandbox, target.publicVerify);
	const refactorFirst = await commitEvidenceCandidate(sandbox, beforeSha, "refactor_first", ordinal, refactorChecks, refactorError || undefined);

	const evidence = chooseEvidenceCandidate(direct, refactorFirst);
	const selected = evidence.selected === "direct" ? direct : refactorFirst;
	await runInWorkspace(sandbox, `git reset --hard ${shellQuote(selected.sha)}`);
	if (publicFeatureTest) await uploadPublicFeatureTest(sandbox, publicFeatureTest);
	return {
		publicChecks: selected.publicChecks,
		evidence,
		selectedPassed: selected.publicPassed,
		refactorApplied,
		...(selected.error ? { error: selected.error } : {}),
	};
}

async function commitEvidenceCandidate(
	sandbox: Sandbox,
	beforeSha: string,
	kind: EvidenceCandidate["kind"],
	ordinal: number,
	publicChecks: CommandResult[],
	error?: string,
): Promise<EvidenceCandidate> {
	await runInWorkspace(
		sandbox,
		`git add -A && git reset --quiet -- tests/feature.test.ts && git commit --quiet --allow-empty -m ${shellQuote(
			`evidence ${ordinal + 1}: ${kind}`,
		)}`,
	);
	const sha = await gitOutput(sandbox, "rev-parse HEAD");
	const fileChanges = parseNumstat(await gitOutput(sandbox, `diff --numstat ${beforeSha}..${sha}`));
	return {
		kind,
		sha,
		publicChecks,
		publicPassed: !error && publicChecks.every((check) => check.exitCode === 0),
		fileChanges,
		...(error ? { error } : {}),
	};
}

export function chooseEvidenceCandidate(direct: EvidenceCandidate, refactorFirst: EvidenceCandidate): EvidenceDecision {
	const directSummary = evidenceSummary(direct);
	const refactorSummary = evidenceSummary(refactorFirst);
	if (direct.publicPassed !== refactorFirst.publicPassed) {
		const selected = direct.publicPassed ? "direct" : "refactor_first";
		return {
			selected,
			reason: `${selected} was the only candidate to pass public verification`,
			direct: directSummary,
			refactorFirst: refactorSummary,
		};
	}
	if (refactorSummary.productionChurn < directSummary.productionChurn) {
		return {
			selected: "refactor_first",
			reason: "both candidates had equal correctness; refactor-first had lower production churn",
			direct: directSummary,
			refactorFirst: refactorSummary,
		};
	}
	if (refactorSummary.productionChurn === directSummary.productionChurn && refactorSummary.productionFiles < directSummary.productionFiles) {
		return {
			selected: "refactor_first",
			reason: "both candidates had equal correctness and churn; refactor-first touched fewer production files",
			direct: directSummary,
			refactorFirst: refactorSummary,
		};
	}
	return {
		selected: "direct",
		reason: "direct won or tied the correctness-gated change-cost comparison",
		direct: directSummary,
		refactorFirst: refactorSummary,
	};
}

function evidenceSummary(candidate: EvidenceCandidate): EvidenceCandidateSummary {
	const production = candidate.fileChanges.filter((change) => change.category === "production");
	return {
		publicPassed: candidate.publicPassed,
		productionChurn: production.reduce((total, change) => total + change.additions + change.deletions, 0),
		productionFiles: production.length,
	};
}

function preRefactorMessage(target: EvalTarget, ordinal: number): string {
	const step = target.steps[ordinal];
	return [
		`Target: ${target.title}`,
		`Upcoming requirement: ${step.prompt}`,
		"",
		"Do not implement the requirement. Apply at most one behavior-preserving preparatory refactor only if it reduces this requirement's concrete change set.",
	].join("\n");
}

function isTransientAgentError(error: unknown): boolean {
	return error instanceof AgentError && error.code === "runner_lost";
}

export interface HealthContext {
	current: HealthSnapshot;
	seed: HealthSnapshot;
	/** Health v2, heat, and coupling, now (including the current feature) and at the seed. */
	signals?: { current: SignalSnapshot; seed: SignalSnapshot };
}

const HEALTH_WINDOW = 4;

export function decideIntervention(
	scenario: EvalScenario,
	history: readonly IterationResult[],
	currentChanges: readonly FileChange[],
	ordinal: number,
	totalSteps: number,
	health?: HealthContext,
): InterventionDecision {
	// In a gated review arm the gate is spent once it has opened a review, even if the skill declined to act.
	const reviewSpendsGate = scenario.reviewer !== undefined && scenario.intervention !== "skill_review";
	let lastTriggered = -1;
	for (let index = history.length - 1; index >= 0; index--) {
		if (history[index].intervention.triggered || (reviewSpendsGate && history[index].intervention.review)) {
			lastTriggered = index;
			break;
		}
	}
	const sinceLast = [...history.slice(lastTriggered + 1).flatMap((iteration) => iteration.fileChanges), ...currentChanges];
	const productionChurnSinceLast = productionChurn(sinceLast);
	// A completed intervention resets the evidence window; otherwise one hot file would retrigger forever.
	const recent = [
		...history
			.slice(lastTriggered + 1)
			.slice(-(HEALTH_WINDOW - 1))
			.map((iteration) => iteration.fileChanges),
		currentChanges,
	];
	const touches = new Map<string, number>();
	for (const changes of recent) {
		for (const path of new Set(changes.filter((change) => change.category === "production").map((change) => change.path))) {
			touches.set(path, (touches.get(path) ?? 0) + 1);
		}
	}
	const hotspotPaths = [...touches.entries()]
		.filter(([, count]) => count >= 3)
		.map(([path]) => path)
		.sort();
	const base = { applied: false, productionChurnSinceLast, hotspotPaths };

	if (scenario.intervention === "never") return { ...base, triggered: false, reason: "scenario has no intervention" };
	if (scenario.intervention === "evidence_seeking") return { ...base, triggered: true, reason: "evidence-seeking comparison" };
	if (scenario.intervention === "periodic_after") {
		const triggered = [2, 5, 8].includes(ordinal);
		return { ...base, triggered, reason: triggered ? `periodic checkpoint after feature ${ordinal + 1}` : "not a periodic checkpoint" };
	}
	if (scenario.intervention.startsWith("refactor_after_")) {
		const checkpoint = Number(scenario.intervention.slice("refactor_after_".length)) - 1;
		const triggered = ordinal === checkpoint && ordinal < totalSteps - 1;
		return {
			...base,
			triggered,
			reason: triggered ? `one-shot checkpoint after feature ${ordinal + 1}` : "not the one-shot checkpoint",
		};
	}
	if (scenario.intervention === "skill_review") return { ...base, triggered: false, reason: "awaiting the skill review" };
	if (scenario.intervention === "health_safeguard") {
		if (!health) return { ...base, triggered: false, reason: "structural health was not measured" };
		const previous = latestHealth(history) ?? health.seed;
		const regressed = [...new Set(currentChanges.filter((change) => change.category === "production").map((change) => change.path))]
			.filter((path) => {
				const file = fileIn(health.current, path);
				return file !== undefined && newFindings(fileIn(previous, path), file).length > 0;
			})
			.sort();
		return regressed.length > 0
			? { ...base, triggered: true, reason: `safeguard: feature ${ordinal + 1} added structural findings in ${regressed.join(", ")}` }
			: { ...base, triggered: false, reason: "feature added no structural findings" };
	}

	if (lastTriggered >= 0) return { ...base, triggered: false, reason: "one-shot adaptive intervention already spent" };
	const remainingSteps = totalSteps - ordinal - 1;
	if (remainingSteps < 4) return { ...base, triggered: false, reason: "fewer than four future features can benefit" };

	if (scenario.intervention === "coupling_triggered") {
		if (ordinal < SIGNAL_WINDOW - 1) return { ...base, triggered: false, reason: "fewer than four features of change history" };
		const cluster = couplingCluster([...history.slice(lastTriggered + 1).map((iteration) => iteration.fileChanges), currentChanges]);
		if (!cluster) return { ...base, triggered: false, reason: "no files in different directories keep changing together" };
		return {
			...base,
			triggered: true,
			couplingCluster: cluster,
			reason: `coupling gate: ${cluster.join(", ")} changed together in ${COUPLING_MIN_SHARED} of the last ${SIGNAL_WINDOW} features`,
		};
	}

	if (scenario.intervention === "signals_triggered") {
		if (ordinal < SIGNAL_WINDOW - 1) return { ...base, triggered: false, reason: "fewer than four features of change history" };
		if (!health?.signals) return { ...base, triggered: false, reason: "signals were not measured" };
		const window = [...history.slice(lastTriggered + 1).map((iteration) => iteration.fileChanges), currentChanges];
		const windowStart = history.find((iteration) => iteration.ordinal === ordinal - SIGNAL_WINDOW)?.signals ?? health.signals.seed;
		const hot = decayingHotspots(window, health.signals.current, windowStart);
		const cluster = couplingCluster(window);
		if (hot.length === 0 && !cluster) {
			return {
				...base,
				triggered: false,
				reason: `no hot file is below ${AI_FRIENDLY_HEALTH} and got worse, and no files in different directories keep changing together`,
			};
		}
		const seen = [
			...hot.map(
				(file) => `${file.path} at health ${file.health} (from ${file.healthAtWindowStart}), changed in ${file.changedIn} of ${SIGNAL_WINDOW}`,
			),
			...(cluster ? [`${cluster.join(", ")} changed together in ${COUPLING_MIN_SHARED} of ${SIGNAL_WINDOW}`] : []),
		];
		return {
			...base,
			triggered: true,
			...(hot.length > 0 ? { decayingHotspots: hot } : {}),
			...(cluster ? { couplingCluster: cluster } : {}),
			reason: `signals gate: ${seen.join("; ")}`,
		};
	}

	if (scenario.intervention === "health_triggered") {
		if (ordinal < HEALTH_WINDOW - 1) return { ...base, triggered: false, reason: "fewer than four features of change history" };
		if (hotspotPaths.length === 0) return { ...base, triggered: false, reason: "no sustained production hotspot" };
		if (!health) return { ...base, triggered: false, reason: "structural health was not measured" };
		const windowStart = history.find((iteration) => iteration.ordinal === ordinal - HEALTH_WINDOW)?.health ?? health.seed;
		const decaying = hotspotPaths.flatMap((path) => {
			const file = fileIn(health.current, path);
			if (!file || file.score >= AI_FRIENDLY_HEALTH) return [];
			const gained = newFindings(fileIn(windowStart, path), file).length;
			return gained > 0 ? [`${path} at ${file.score} gained ${gained} finding${gained === 1 ? "" : "s"}`] : [];
		});
		if (decaying.length === 0) {
			return {
				...base,
				triggered: false,
				reason: `no hotspot is below ${AI_FRIENDLY_HEALTH} and gained a structural finding in the last four features`,
			};
		}
		return { ...base, triggered: true, reason: `health gate: ${decaying.join("; ")}` };
	}

	if (ordinal < 5) return { ...base, triggered: false, reason: "fewer than six features of change history" };
	if (hotspotPaths.length === 0) return { ...base, triggered: false, reason: "no sustained production hotspot" };
	if (productionChurnSinceLast < 200) {
		return { ...base, triggered: false, reason: `production churn is ${productionChurnSinceLast} lines; maturity requires 200` };
	}
	return {
		...base,
		triggered: true,
		reason: `one-shot maturity gate: ${productionChurnSinceLast} lines and repeated hotspot ${hotspotPaths.join(", ")}`,
	};
}

function latestHealth(history: readonly IterationResult[]): HealthSnapshot | undefined {
	for (let index = history.length - 1; index >= 0; index--) {
		const health = history[index].health;
		if (health) return health;
	}
	return undefined;
}

const fileIn = (health: HealthSnapshot, path: string): FileHealth | undefined => health.files.find((file) => file.path === path);

function productionChurn(changes: readonly FileChange[]): number {
	return changes.filter((change) => change.category === "production").reduce((total, change) => total + change.additions + change.deletions, 0);
}

async function verify(sandbox: Sandbox, commands: readonly string[]): Promise<CommandResult[]> {
	const results: CommandResult[] = [];
	for (const command of commands) {
		const result = await runInWorkspace(sandbox, command);
		results.push({ command, ...result });
		if (result.exitCode !== 0) break;
	}
	return results;
}

async function gitOutput(sandbox: Sandbox, args: string): Promise<string> {
	const result = await runInWorkspace(sandbox, `git ${args}`);
	if (result.exitCode !== 0) throw new Error(`git ${args} failed: ${(result.stderr || result.stdout).slice(-2000)}`);
	return result.stdout.trim();
}

export function parseNumstat(text: string): FileChange[] {
	const changes: FileChange[] = [];
	for (const line of text.split("\n")) {
		const [added, deleted, ...pathParts] = line.split("\t");
		if (!/^\d+$/.test(added) || !/^\d+$/.test(deleted) || pathParts.length === 0) continue;
		const path = pathParts.join("\t");
		changes.push({ path, additions: Number(added), deletions: Number(deleted), category: categorizePath(path) });
	}
	return changes;
}

function categorizePath(path: string): ChangeCategory {
	if (/^(?:tests?|__tests__)\//.test(path) || /\.(?:test|spec)\.[cm]?[jt]sx?$/.test(path)) return "test";
	if (/^(?:src|app|lib)\//.test(path)) return "production";
	return "config";
}

function testCount(stdout: string, name: "pass" | "fail"): number {
	const match = stdout.match(new RegExp(`(?:# |ℹ )${name} (\\d+)`));
	return match ? Number(match[1]) : 0;
}

function shellQuote(value: string): string {
	return `'${value.replaceAll("'", `'\\''`)}'`;
}
