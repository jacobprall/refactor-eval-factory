import { describe, expect, it, vi } from "vitest";
import type { OutputSchema } from "../app/agents/define.js";
import { AgentError, type AgentRun, type runAgent } from "../app/agents/run.js";
import { analyzeHealth } from "../app/eval/health.js";
import { requireScenario } from "../app/eval/scenarios.js";
import {
	chooseEvidenceCandidate,
	chooseReviewFinding,
	decideIntervention,
	type EvidenceCandidate,
	executeTrajectory,
	type FileChange,
	type IterationResult,
	parseNumstat,
	replayOutput,
} from "../app/eval/trajectory.js";
import { couplingCluster, measureSignals } from "../app/eval/signals.js";
import type { EvalReviewFinding } from "../app/schemas/eval.js";
import { EVAL_WORKDIR } from "../app/eval/workspace.js";
import type { Sandbox } from "../app/sandbox/types.js";
import type { EvalTarget } from "../eval/targets/index.js";

const SHA1 = "1".repeat(40);
const SHA2 = "2".repeat(40);
const TREE = "3".repeat(40);

class TrajectorySandbox implements Sandbox {
	readonly id = "eval-sandbox";
	readonly uploads = new Map<string, string>();
	readonly commands: string[] = [];
	numstat = "4\t1\tsrc/index.ts\n";
	apiSurfaces = ["{}"];
	binaryDiffs = ["diff"];
	sources: Record<string, string> = { "src/index.ts": "export const value = 1;\n" };
	traceScript: string | undefined;
	replayOutputs: string[] = [];
	private revs = 0;

	async exec(command: string): Promise<{ exitCode: number; stdout: string; stderr: string }> {
		this.commands.push(command);
		if (command.includes("test -f")) {
			return this.traceScript === undefined ? { exitCode: 1, stdout: "", stderr: "" } : { exitCode: 0, stdout: this.traceScript, stderr: "" };
		}
		if (command.includes("node --experimental-strip-types '.eval-trace/replay.ts'")) {
			return { exitCode: 0, stdout: this.replayOutputs.shift() ?? "", stderr: "" };
		}
		if (command.includes("ls-files")) return { exitCode: 0, stdout: `${JSON.stringify(this.sources)}\n`, stderr: "" };
		if (command.includes("rev-parse HEAD^{tree}")) return { exitCode: 0, stdout: `${TREE}\n`, stderr: "" };
		if (command.includes("rev-parse HEAD")) return { exitCode: 0, stdout: `${this.revs++ === 0 ? SHA1 : SHA2}\n`, stderr: "" };
		if (command.includes("diff --name-only")) return { exitCode: 0, stdout: "src/index.ts\n", stderr: "" };
		if (command.includes("diff --cached --binary")) {
			const stdout = this.binaryDiffs.length > 1 ? this.binaryDiffs.shift() : this.binaryDiffs[0];
			return { exitCode: 0, stdout: stdout ?? "", stderr: "" };
		}
		if (command.includes("--numstat")) return { exitCode: 0, stdout: this.numstat, stderr: "" };
		if (command.includes("diff --no-ext-diff")) return { exitCode: 0, stdout: "diff --git a/src/index.ts b/src/index.ts\n", stderr: "" };
		if (command.includes("npm test")) return { exitCode: 0, stdout: "# pass 2\n# fail 0\n", stderr: "" };
		if (command.includes("--input-type=module")) {
			return { exitCode: 0, stdout: `${this.apiSurfaces.shift() ?? this.apiSurfaces.at(-1) ?? "{}"}\n`, stderr: "" };
		}
		return { exitCode: 0, stdout: "", stderr: "" };
	}
	async upload(path: string, data: string | Buffer): Promise<void> {
		this.uploads.set(path, data.toString());
	}
	async download(): Promise<Buffer> {
		throw new Error("unused");
	}
	async close(): Promise<void> {}
}

const target: EvalTarget = {
	id: "subscription-billing",
	title: "Tiny target",
	files: {
		"package.json": '{"type":"module","scripts":{"test":"node --test"}}\n',
		"src/index.ts": "export const value = 1;\n",
		"tests/public.test.ts": "\n",
	},
	publicVerify: ["npm test"],
	steps: [
		{
			id: "one",
			title: "One",
			prompt: "Change it.",
			publicTest: 'test("visible",()=>assert.ok(subject));',
			hiddenTest: 'test("hidden",()=>assert.ok(subject));',
		},
	],
};

const cannedRun: AgentRun<OutputSchema> = {
	output: { summary: "done", changedPaths: ["src/index.ts"], testsRun: ["npm test"] },
	usage: { input_tokens: 10, output_tokens: 5, cache_read_tokens: 0, cache_write_tokens: 0, cost_usd: 0.01 },
	costUsd: 0.01,
	turns: 1,
};

describe("trajectory execution", () => {
	it("runs one implementation phase and keeps hidden tests out of the next workspace", async () => {
		const sandbox = new TrajectorySandbox();
		const invoke = vi.fn(async () => cannedRun) as unknown as typeof runAgent;
		const result = await executeTrajectory(sandbox, target, requireScenario("baseline"), "trace", { runAgent: invoke });
		expect(invoke).toHaveBeenCalledTimes(1);
		expect(result.status).toBe("completed");
		expect(result.iterations[0]).toMatchObject({ additions: 4, deletions: 1, changedPaths: ["src/index.ts"] });
		expect(result.iterations[0].fileChanges).toEqual([{ path: "src/index.ts", additions: 4, deletions: 1, category: "production" }]);
		expect(sandbox.uploads.get(`${EVAL_WORKDIR}/tests/feature.test.ts`)).toContain('test("visible"');
		expect(sandbox.commands.some((command) => command.includes("rm -f") && command.includes("hidden.test.ts"))).toBe(true);
	});

	it("selects evidence candidates by correctness, churn, files, then a direct tie-break", () => {
		const candidate = (kind: EvidenceCandidate["kind"], publicPassed: boolean, churn: number, files = 1): EvidenceCandidate => ({
			kind,
			sha: kind,
			publicChecks: [],
			publicPassed,
			fileChanges: Array.from({ length: files }, (_, index) => ({
				path: `src/${index}.ts`,
				additions: index === 0 ? churn : 0,
				deletions: 0,
				category: "production",
			})),
		});
		expect(chooseEvidenceCandidate(candidate("direct", true, 10), candidate("refactor_first", false, 1)).selected).toBe("direct");
		expect(chooseEvidenceCandidate(candidate("direct", true, 10), candidate("refactor_first", true, 8)).selected).toBe("refactor_first");
		expect(chooseEvidenceCandidate(candidate("direct", true, 10, 2), candidate("refactor_first", true, 10, 1)).selected).toBe("refactor_first");
		expect(chooseEvidenceCandidate(candidate("direct", true, 10), candidate("refactor_first", true, 10)).selected).toBe("direct");
	});

	it("runs both evidence paths and counts every model phase", async () => {
		const sandbox = new TrajectorySandbox();
		const invoke = vi.fn(async () => cannedRun) as unknown as typeof runAgent;
		const result = await executeTrajectory(sandbox, target, requireScenario("evidence-seeking"), "trace", { runAgent: invoke });
		expect(invoke).toHaveBeenCalledTimes(3);
		expect(result.iterations[0].agentPhases.map((candidatePhase) => candidatePhase.phase)).toEqual([
			"direct_probe",
			"pre_refactor_probe",
			"refactor_first_probe",
		]);
		expect(result.iterations[0].evidence).toMatchObject({ selected: "direct" });
	});

	it("classifies per-file numstat and does not treat an early hotspot as mature", () => {
		expect(parseNumstat("4\t1\tsrc/a.ts\n2\t0\ttests/a.test.ts\n1\t1\tpackage.json")).toEqual([
			{ path: "src/a.ts", additions: 4, deletions: 1, category: "production" },
			{ path: "tests/a.test.ts", additions: 2, deletions: 0, category: "test" },
			{ path: "package.json", additions: 1, deletions: 1, category: "config" },
		]);
		const change: FileChange = { path: "src/a.ts", additions: 5, deletions: 0, category: "production" };
		const history = [0, 1].map(
			(ordinal) =>
				({
					ordinal,
					fileChanges: [change],
					intervention: { triggered: false, applied: false, reason: "", productionChurnSinceLast: 0, hotspotPaths: [] },
				}) as unknown as IterationResult,
		);
		const decision = decideIntervention(requireScenario("triggered-after"), history, [change], 2, 10);
		expect(decision).toMatchObject({ triggered: false, hotspotPaths: ["src/a.ts"], reason: "fewer than six features of change history" });

		history[1].intervention.triggered = true;
		expect(decideIntervention(requireScenario("triggered-after"), history, [change], 2, 10)).toMatchObject({
			triggered: false,
			reason: "one-shot adaptive intervention already spent",
		});
	});

	it("uses declared cadence and a one-shot maturity gate with a remaining payoff horizon", () => {
		const periodic = requireScenario("periodic-after");
		expect(decideIntervention(periodic, [], [], 1, 10).triggered).toBe(false);
		expect(decideIntervention(periodic, [], [], 2, 10).triggered).toBe(true);
		expect(decideIntervention(periodic, [], [], 5, 10).triggered).toBe(true);
		expect(decideIntervention(periodic, [], [], 8, 10).triggered).toBe(true);

		const matureChange: FileChange = { path: "src/policy.ts", additions: 40, deletions: 0, category: "production" };
		const triggered = requireScenario("triggered-after");
		const matureHistory = Array.from({ length: 5 }, (__, ordinal) => ({
			ordinal,
			fileChanges: [matureChange],
			intervention: { triggered: false, applied: false, reason: "", productionChurnSinceLast: 0, hotspotPaths: [] },
		})) as unknown as IterationResult[];
		expect(decideIntervention(triggered, matureHistory, [matureChange], 5, 12)).toMatchObject({
			triggered: true,
			productionChurnSinceLast: 240,
			hotspotPaths: ["src/policy.ts"],
		});
		matureHistory[4].intervention.triggered = true;
		expect(decideIntervention(triggered, matureHistory, [matureChange], 6, 12)).toMatchObject({
			triggered: false,
			reason: "one-shot adaptive intervention already spent",
		});
	});

	it("triggers each one-shot scenario only at its non-final checkpoint", () => {
		for (const [scenarioId, checkpoint] of [
			["refactor-after-3", 2],
			["refactor-after-6", 5],
			["refactor-after-9", 8],
		] as const) {
			const scenario = requireScenario(scenarioId);
			const triggered = Array.from({ length: 10 }, (_, ordinal) =>
				decideIntervention(scenario, [], [], ordinal, 10).triggered ? ordinal : null,
			).filter((ordinal) => ordinal !== null);
			expect(triggered).toEqual([checkpoint]);
			expect(decideIntervention(scenario, [], [], checkpoint, checkpoint + 1)).toMatchObject({
				triggered: false,
				reason: "not the one-shot checkpoint",
			});
		}
	});

	it("persists post-refactor cost and counts its production lines in the iteration diff", async () => {
		const sandbox = new TrajectorySandbox();
		const fourStepTarget: EvalTarget = {
			...target,
			steps: Array.from({ length: 4 }, (_, index) => ({
				...target.steps[0],
				id: `step-${index + 1}`,
				title: `Step ${index + 1}`,
			})),
		};
		const invoke = vi.fn(
			async (_agent: Parameters<typeof runAgent>[0], _message: Parameters<typeof runAgent>[1], options: Parameters<typeof runAgent>[2]) => {
				sandbox.numstat = options.runId?.endsWith(":post-refactor") ? "7\t2\tsrc/index.ts\n" : "4\t1\tsrc/index.ts\n";
				return cannedRun;
			},
		) as unknown as typeof runAgent;

		const result = await executeTrajectory(sandbox, fourStepTarget, requireScenario("refactor-after-3"), "trace", { runAgent: invoke });

		expect(invoke).toHaveBeenCalledTimes(5);
		expect(result.iterations[2]).toMatchObject({
			additions: 7,
			deletions: 2,
			fileChanges: [{ path: "src/index.ts", additions: 7, deletions: 2, category: "production" }],
		});
		expect(result.iterations[2].agentPhases.map(({ phase, costUsd }) => ({ phase, costUsd }))).toEqual([
			{ phase: "implement", costUsd: 0.01 },
			{ phase: "post_refactor", costUsd: 0.01 },
		]);
	});

	it("rejects a refactor that changes the exported runtime API", async () => {
		const sandbox = new TrajectorySandbox();
		sandbox.apiSurfaces = [
			'{"UsageMeter":{"type":"function","statics":[],"prototype":["record"]}}',
			'{"UsageMeter":{"type":"function","statics":[],"prototype":[]}}',
		];
		const fourStepTarget: EvalTarget = {
			...target,
			steps: Array.from({ length: 4 }, (_, index) => ({
				...target.steps[0],
				id: `step-${index + 1}`,
				title: `Step ${index + 1}`,
			})),
		};
		const invoke = vi.fn(async () => cannedRun) as unknown as typeof runAgent;

		const result = await executeTrajectory(sandbox, fourStepTarget, requireScenario("refactor-after-3"), "trace", { runAgent: invoke });

		expect(result.status).toBe("completed");
		expect(result.iterations[2].intervention).toMatchObject({
			triggered: true,
			applied: false,
			reason: expect.stringContaining("refactor rejected because exported runtime API changed"),
		});
		expect(result.iterations[2].publicChecks).toContainEqual(expect.objectContaining({ command: "exported runtime API compatibility", exitCode: 0 }));
		expect(sandbox.commands.some((command) => command.includes("git reset --hard"))).toBe(true);
	});

	it("allows a refactor to add an internal prototype helper", async () => {
		const sandbox = new TrajectorySandbox();
		sandbox.apiSurfaces = [
			'{"UsageMeter":{"type":"function","statics":[],"prototype":["record"]}}',
			'{"UsageMeter":{"type":"function","statics":[],"prototype":["evaluate","record"]}}',
		];
		sandbox.binaryDiffs = ["implementation", "refactored"];
		const fourStepTarget: EvalTarget = {
			...target,
			steps: Array.from({ length: 4 }, (_, index) => ({
				...target.steps[0],
				id: `step-${index + 1}`,
				title: `Step ${index + 1}`,
			})),
		};
		const invoke = vi.fn(async () => cannedRun) as unknown as typeof runAgent;

		const result = await executeTrajectory(sandbox, fourStepTarget, requireScenario("refactor-after-3"), "trace", { runAgent: invoke });

		expect(result.iterations[2].intervention).toMatchObject({ triggered: true, applied: true });
		expect(result.iterations[2].intervention.reason).not.toContain("refactor rejected");
	});
});

const withSteps = (count: number): EvalTarget => ({
	...target,
	steps: Array.from({ length: count }, (_, index) => ({
		...target.steps[0],
		id: `step-${index + 1}`,
		title: `Step ${index + 1}`,
		prompt: `Requirement ${index + 1}.`,
	})),
});

const twoCopies = `export function record(input: { units: number; limit: number }) {
  const units = Math.max(0, input.units);
  const limit = Math.max(0, input.limit);
  const projected = units + 1;
  const allowed = projected <= limit;
  const remaining = limit - projected;
  return { allowed, remaining, projected };
}

export function preview(input: { units: number; limit: number }) {
  const units = Math.max(0, input.units);
  const limit = Math.max(0, input.limit);
  const projected = units + 1;
  const allowed = projected <= limit;
  const remaining = limit - projected;
  return { allowed, remaining, projected };
}
`;

function recordingInvoke(sandbox: TrajectorySandbox) {
	const messages = new Map<string, string>();
	let traceCommandDuringRefactor: string | undefined;
	const invoke = vi.fn(
		async (_agent: Parameters<typeof runAgent>[0], message: Parameters<typeof runAgent>[1], options: Parameters<typeof runAgent>[2]) => {
			const kind = options.runId?.split(":").at(-1) ?? "";
			messages.set(kind, message);
			if (kind === "post-refactor") traceCommandDuringRefactor = [...sandbox.commands].reverse().find((command) => command.includes(".eval-trace"));
			return cannedRun;
		},
	) as unknown as typeof runAgent;
	return { invoke, messages, traceCommandDuringRefactor: () => traceCommandDuringRefactor };
}

describe("refactor guards and evidence", () => {
	it("rolls back a refactor whose replay output changes, and keeps the replay and hidden tests from the agents", async () => {
		const sandbox = new TrajectorySandbox();
		sandbox.binaryDiffs = ["implementation", "refactored"];
		sandbox.traceScript = 'console.log(JSON.stringify({ case: "a", result: 1 }));';
		sandbox.replayOutputs = ['{"case":"a","result":1}\n', '{"case":"a","result":1}\n', '{"case":"a","result":2}\n'];
		const { invoke, messages, traceCommandDuringRefactor } = recordingInvoke(sandbox);

		const result = await executeTrajectory(sandbox, withSteps(7), requireScenario("refactor-after-6-guarded"), "trace", { runAgent: invoke });

		const iteration = result.iterations[5];
		expect(iteration.agentPhases.map(({ phase }) => phase)).toEqual(["implement", "trace_author", "post_refactor"]);
		expect(iteration.replay).toMatchObject({ status: "diverged", cases: 1, divergence: { line: 1 } });
		expect(iteration.intervention).toMatchObject({ applied: false, reason: expect.stringContaining("replay trace output changed") });
		expect(sandbox.commands.some((command) => command.includes("git reset --hard") && command.includes("git clean"))).toBe(true);
		expect(traceCommandDuringRefactor()).toContain("rm -rf .eval-trace");
		expect(messages.get("trace-author")).toContain("Requirement 6.");
		expect(messages.get("trace-author")).not.toContain("Requirement 7.");
		expect(messages.get("trace-author")).not.toContain('test("hidden"');
		expect(messages.get("post-refactor")).not.toContain("console.log");
	});

	it("keeps a refactor whose replay output is unchanged", async () => {
		const sandbox = new TrajectorySandbox();
		sandbox.binaryDiffs = ["implementation", "refactored"];
		sandbox.traceScript = "console.log(1);";
		sandbox.replayOutputs = ["1\n", "1\n", "1\n"];
		const { invoke } = recordingInvoke(sandbox);

		const result = await executeTrajectory(sandbox, withSteps(7), requireScenario("refactor-after-6-guarded"), "trace", { runAgent: invoke });

		expect(result.iterations[5].replay).toMatchObject({ status: "passed", cases: 1 });
		expect(result.iterations[5].intervention.applied).toBe(true);
	});

	it("falls back to API protection when the replay is nondeterministic on the implementation", async () => {
		const sandbox = new TrajectorySandbox();
		sandbox.binaryDiffs = ["implementation", "refactored"];
		sandbox.traceScript = "console.log(Math.random());";
		sandbox.replayOutputs = ["0.1\n", "0.2\n"];
		const { invoke } = recordingInvoke(sandbox);

		const result = await executeTrajectory(sandbox, withSteps(7), requireScenario("refactor-after-6-guarded"), "trace", { runAgent: invoke });

		expect(result.iterations[5].replay).toMatchObject({ status: "unavailable", reason: expect.stringContaining("nondeterministic") });
		expect(result.iterations[5].intervention.applied).toBe(true);
	});

	it("briefs only the briefed refactorer with measured findings for the files the feature touched", async () => {
		for (const [scenarioId, briefed] of [
			["refactor-after-6", false],
			["refactor-after-6-briefed", true],
		] as const) {
			const sandbox = new TrajectorySandbox();
			sandbox.sources = { "src/meter.ts": twoCopies };
			sandbox.numstat = "4\t1\tsrc/meter.ts\n";
			const { invoke, messages } = recordingInvoke(sandbox);

			const result = await executeTrajectory(sandbox, withSteps(7), requireScenario(scenarioId), "trace", { runAgent: invoke });

			const message = messages.get("post-refactor") ?? "";
			if (briefed) {
				expect(message).toContain("src/meter.ts: health 9; changed in at least three of the last four features");
				expect(message).toContain("duplicated block");
				expect(result.iterations[5].intervention.evidence).toEqual([expect.objectContaining({ path: "src/meter.ts", hotspot: true })]);
			} else {
				expect(message).toBe(
					"Feature 6 (step-6) has been implemented. Inspect the current uncommitted diff and apply the bounded post-implementation procedure.",
				);
			}
			expect(result.iterations[5].health).toMatchObject({ score: 9 });
		}
	});

	it("records what a failed agent phase spent", async () => {
		const sandbox = new TrajectorySandbox();
		const failure = new AgentError("eval-baseline", "max_turns", "ran out of turns");
		failure.spent = {
			usage: { input_tokens: 100, output_tokens: 20, cache_read_tokens: 0, cache_write_tokens: 0, cost_usd: 0.5 },
			costUsd: 0.5,
			turns: 40,
		};
		const invoke = vi.fn(async () => {
			throw failure;
		}) as unknown as typeof runAgent;

		const result = await executeTrajectory(sandbox, target, requireScenario("baseline"), "trace", { runAgent: invoke });

		expect(result.status).toBe("stopped");
		expect(result.iterations[0].agentPhases).toEqual([
			expect.objectContaining({ phase: "implement", costUsd: 0.5, turns: 40, output: { error: "ran out of turns" } }),
		]);
	});
});

describe("health-based triggers", () => {
	const healthy = analyzeHealth({ "src/policy.ts": "export const limit = (value: number) => value;\n" });
	const decayed = analyzeHealth({ "src/policy.ts": twoCopies });
	const change: FileChange = { path: "src/policy.ts", additions: 5, deletions: 0, category: "production" };
	const history = (health: typeof healthy, count = 3) =>
		Array.from({ length: count }, (_, ordinal) => ({
			ordinal,
			fileChanges: [change],
			health,
			intervention: { triggered: false, applied: false, reason: "", productionChurnSinceLast: 0, hotspotPaths: [] },
		})) as unknown as IterationResult[];

	it("fires once when a repeated hotspot falls below 9.5 and gained a finding during the window", () => {
		const gate = requireScenario("health-triggered");
		expect(decideIntervention(gate, history(healthy), [change], 3, 12, { current: decayed, seed: healthy })).toMatchObject({
			triggered: true,
			reason: expect.stringContaining("src/policy.ts at 9 gained 2 findings"),
		});
		expect(decideIntervention(gate, history(healthy), [change], 3, 12, { current: healthy, seed: healthy })).toMatchObject({ triggered: false });
		expect(decideIntervention(gate, history(decayed), [change], 3, 12, { current: decayed, seed: decayed })).toMatchObject({
			triggered: false,
			reason: expect.stringContaining("gained a structural finding"),
		});
		expect(decideIntervention(gate, history(healthy, 2), [change], 2, 12, { current: decayed, seed: healthy })).toMatchObject({
			triggered: false,
			reason: "fewer than four features of change history",
		});
		expect(decideIntervention(gate, history(healthy), [change], 8, 12, { current: decayed, seed: healthy })).toMatchObject({
			triggered: false,
			reason: "fewer than four future features can benefit",
		});
		const spent = history(healthy);
		spent[2].intervention.triggered = true;
		expect(decideIntervention(gate, spent, [change], 3, 12, { current: decayed, seed: healthy })).toMatchObject({
			triggered: false,
			reason: "one-shot adaptive intervention already spent",
		});
	});

	it("safeguards any feature that added a finding to a file it touched, including late features", () => {
		const safeguard = requireScenario("health-safeguard");
		expect(decideIntervention(safeguard, history(healthy, 1), [change], 11, 12, { current: decayed, seed: healthy })).toMatchObject({
			triggered: true,
			reason: expect.stringContaining("src/policy.ts"),
		});
		expect(decideIntervention(safeguard, history(decayed, 1), [change], 1, 12, { current: decayed, seed: healthy })).toMatchObject({
			triggered: false,
		});
		expect(decideIntervention(safeguard, history(healthy, 1), [], 1, 12, { current: decayed, seed: healthy })).toMatchObject({ triggered: false });
	});
});

const reviewFinding = (overrides: Partial<EvalReviewFinding> = {}): EvalReviewFinding => ({
	id: "F1",
	fingerprint: "scattered-knowledge:src/meter.ts#UsageMeter",
	title: "Record and preview duplicate the usage decision",
	primary: "scattered-knowledge",
	sites: [{ path: "src/meter.ts", symbol: "UsageMeter" }],
	symptom: "change amplification",
	case_for: "",
	case_against: "",
	severity: "medium",
	confidence: "high",
	effort: "S",
	when: "next-change",
	risk: "low",
	plan: [{ refactor: "combine-functions", direction: "reshape", behavior: "preserving", note: "" }],
	...overrides,
});

function reviewingInvoke(findingsFor: (ordinal: number) => EvalReviewFinding[] | Error) {
	const calls: { kind: string; ordinal: number; message: string }[] = [];
	const invoke = vi.fn(
		async (_agent: Parameters<typeof runAgent>[0], message: Parameters<typeof runAgent>[1], options: Parameters<typeof runAgent>[2]) => {
			const [ordinal, kind] = (options.runId ?? "").split(":").slice(-2);
			calls.push({ kind, ordinal: Number(ordinal), message });
			if (kind !== "review") return cannedRun;
			const findings = findingsFor(Number(ordinal));
			if (findings instanceof Error) throw findings;
			return { ...cannedRun, output: { summary: "review", static_only: false, findings } };
		},
	) as unknown as typeof runAgent;
	return { invoke, calls };
}

describe("skill review arm", () => {
	it("applies the skill's first finding it says to act on, if it is confident, not high risk, and behavior-preserving", () => {
		const later = reviewFinding({ id: "F0", when: "later" });
		expect(chooseReviewFinding([later, reviewFinding()])?.id).toBe("F1");
		expect(chooseReviewFinding([reviewFinding({ when: "now" })])?.id).toBe("F1");
		for (const excluded of [
			reviewFinding({ when: "later" }),
			reviewFinding({ when: "never" }),
			reviewFinding({ confidence: "low" }),
			reviewFinding({ risk: "high" }),
			reviewFinding({ plan: [] }),
			reviewFinding({ plan: [{ refactor: "narrow-error-handling", direction: "reshape", behavior: "changes-failure-paths", note: "" }] }),
			reviewFinding({ sites: [{ path: "tests/feature.test.ts", symbol: "records accepted units" }] }),
		]) {
			expect(chooseReviewFinding([excluded])).toBeUndefined();
		}
	});

	it("reviews every feature, applies only an act-now finding, and discards any code change the reviewer makes", async () => {
		const sandbox = new TrajectorySandbox();
		const { invoke, calls } = reviewingInvoke((ordinal) => (ordinal === 2 ? [reviewFinding()] : [reviewFinding({ when: "later" })]));

		const result = await executeTrajectory(sandbox, withSteps(3), requireScenario("skill-review"), "trace", { runAgent: invoke });

		expect(calls.filter((call) => call.kind === "review").map((call) => call.ordinal)).toEqual([0, 1, 2]);
		expect(calls.filter((call) => call.kind === "post-refactor").map((call) => call.ordinal)).toEqual([2]);
		expect(calls.find((call) => call.kind === "review")?.message).toContain(`--diff ${SHA1}`);
		expect(calls.find((call) => call.kind === "post-refactor")?.message).toContain("scattered-knowledge:src/meter.ts#UsageMeter");
		expect(result.iterations[0].intervention).toMatchObject({ triggered: false, review: { findings: [expect.objectContaining({ when: "later" })] } });
		expect(result.iterations[0].intervention.review?.chosen).toBeUndefined();
		expect(result.iterations[2].intervention).toMatchObject({ triggered: true, review: { chosen: "F1" } });
		expect(sandbox.commands.filter((command) => command.includes("git checkout --quiet HEAD -- . ':(exclude).refactor'"))).toHaveLength(3);
	});

	it("keeps going when a review fails, and records what it spent", async () => {
		const sandbox = new TrajectorySandbox();
		const failure = new AgentError("eval-skill-reviewer", "max_turns", "turn limit (80) reached without a submission");
		failure.spent = {
			usage: { input_tokens: 5, output_tokens: 5, cache_read_tokens: 0, cache_write_tokens: 0, cost_usd: 0.2 },
			costUsd: 0.2,
			turns: 80,
		};
		const { invoke } = reviewingInvoke(() => failure);

		const result = await executeTrajectory(sandbox, withSteps(2), requireScenario("skill-review"), "trace", { runAgent: invoke });

		expect(result.status).toBe("completed");
		expect(result.iterations[0].intervention).toMatchObject({ triggered: false, reason: "skill review failed" });
		expect(result.iterations[0].agentPhases).toContainEqual(expect.objectContaining({ phase: "review", costUsd: 0.2 }));
	});

	it("records a guard rollback as a rejection in the skill's ledger", async () => {
		const sandbox = new TrajectorySandbox();
		sandbox.binaryDiffs = ["implementation", "refactored"];
		sandbox.traceScript = "console.log(1);";
		sandbox.replayOutputs = ['{"allowed":true}\n', '{"allowed":true}\n', '{"allowed":false}\n'];
		const { invoke } = reviewingInvoke(() => [reviewFinding()]);

		const result = await executeTrajectory(sandbox, withSteps(1), requireScenario("skill-review"), "trace", { runAgent: invoke });

		expect(result.iterations[0].replay).toMatchObject({ status: "diverged" });
		const ledger = sandbox.commands.find((command) => command.includes(".refactor/ledger.jsonl")) ?? "";
		expect(ledger).toContain("scattered-knowledge:src/meter.ts#UsageMeter");
		expect(ledger).toContain('"decision":"rejected"');
	});

	it("in a gated arm, reviews only when the gate opens, lets the skill decline, and never reopens", async () => {
		for (const [findings, applied] of [
			[[reviewFinding({ when: "later" })], []],
			[[reviewFinding()], [5]],
		] as const) {
			const sandbox = new TrajectorySandbox();
			sandbox.numstat = "100\t0\tsrc/index.ts\n";
			const { invoke, calls } = reviewingInvoke(() => [...findings]);

			const result = await executeTrajectory(sandbox, withSteps(12), requireScenario("skill-review-maturity-gated"), "trace", { runAgent: invoke });

			expect(calls.filter((call) => call.kind === "review").map((call) => call.ordinal)).toEqual([5]);
			expect(calls.filter((call) => call.kind === "post-refactor").map((call) => call.ordinal)).toEqual(applied);
			expect(result.iterations[5].intervention.reason).toContain("one-shot maturity gate");
			expect(result.iterations.slice(6).every((iteration) => !iteration.intervention.triggered)).toBe(true);
		}
	});

	it("finds the largest group of files across directories that changed together in three of the last four features", () => {
		const change = (...paths: string[]): FileChange[] => paths.map((path) => ({ path, additions: 1, deletions: 0, category: "production" as const }));
		const pricing = ["src/orders/pricing.ts", "src/billing/rules.ts"];
		expect(
			couplingCluster([
				change(...pricing),
				change("src/catalog/x.ts"),
				change(...pricing, "src/index.ts"),
				change(...pricing, "src/orders/types.ts"),
			]),
		).toEqual(["src/billing/rules.ts", "src/orders/pricing.ts"]);
		expect(couplingCluster([change(...pricing), change(...pricing), change("src/catalog/x.ts")])).toBeUndefined();
		expect(
			couplingCluster([
				change("src/orders/a.ts", "src/orders/b.ts"),
				change("src/orders/a.ts", "src/orders/b.ts"),
				change("src/orders/a.ts", "src/orders/b.ts"),
				change(),
			]),
		).toBeUndefined();
		expect(
			couplingCluster([
				change("src/index.ts", "src/orders/types.ts"),
				change("src/index.ts", "src/orders/types.ts"),
				change("src/index.ts", "src/orders/types.ts"),
				change(),
			]),
		).toBeUndefined();
		expect(
			couplingCluster([
				change("src/a/x.ts", "src/b/hub.ts"),
				change("src/a/x.ts", "src/b/hub.ts", "src/c/y.ts"),
				change("src/a/x.ts", "src/b/hub.ts", "src/c/y.ts"),
				change("src/b/hub.ts", "src/c/y.ts"),
			]),
		).toHaveLength(2);
	});

	it("reviews the whole window once when the coupling gate fires, starting from the coupled files", async () => {
		const sandbox = new TrajectorySandbox();
		sandbox.numstat = "4\t1\tsrc/orders/pricing.ts\n4\t1\tsrc/billing/rules.ts\n";
		const { invoke, calls } = reviewingInvoke(() => [reviewFinding({ when: "later" })]);

		const result = await executeTrajectory(sandbox, withSteps(12), requireScenario("skill-review-coupling-gated"), "trace", { runAgent: invoke });

		const reviews = calls.filter((call) => call.kind === "review");
		expect(reviews.map((call) => call.ordinal)).toEqual([3]);
		expect(reviews[0].message).toContain("these files all changed together: src/billing/rules.ts, src/orders/pricing.ts");
		expect(reviews[0].message).toContain(`--diff ${SHA1}`);
		expect(result.iterations[3].intervention.couplingCluster).toEqual(["src/billing/rules.ts", "src/orders/pricing.ts"]);
	});

	it("treats reordered object fields as the same replay output only in canonical comparison", () => {
		const before = '{"case":"a","result":{"allowed":true,"units":10}}\nplain line';
		const reordered = '{"result":{"units":10,"allowed":true},"case":"a"}\nplain line';
		const changed = '{"case":"a","result":{"allowed":false,"units":10}}\nplain line';
		expect(replayOutput(reordered, true)).toBe(replayOutput(before, true));
		expect(replayOutput(changed, true)).not.toBe(replayOutput(before, true));
		expect(replayOutput(reordered, false)).not.toBe(replayOutput(before, false));
	});
});

describe("signals gate", () => {
	const healthySource = "export const limit = (value: number) => value;\n";
	const meter = (additions = 5): FileChange => ({ path: "src/meter.ts", additions, deletions: 0, category: "production" });
	const pricing: FileChange[] = [
		{ path: "src/orders/pricing.ts", additions: 3, deletions: 0, category: "production" },
		{ path: "src/billing/rules.ts", additions: 3, deletions: 0, category: "production" },
	];
	const seed = measureSignals({ "src/meter.ts": healthySource }, []);
	const historyOf = (changes: FileChange[], count = 3) =>
		Array.from({ length: count }, (_, ordinal) => ({
			ordinal,
			fileChanges: changes,
			intervention: { triggered: false, applied: false, reason: "", productionChurnSinceLast: 0, hotspotPaths: [] },
		})) as unknown as IterationResult[];
	const context = (sources: Record<string, string>, features: FileChange[][]) => {
		const health = analyzeHealth(sources);
		return { current: health, seed: health, signals: { current: measureSignals(sources, features), seed } };
	};
	const gate = requireScenario("signals-only");

	it("fires when a hot file is below 9.5 and got worse, and names its copied lines", () => {
		const features = Array.from({ length: 4 }, () => [meter()]);
		const decision = decideIntervention(gate, historyOf([meter()]), [meter()], 3, 12, context({ "src/meter.ts": twoCopies }, features));
		expect(decision).toMatchObject({ triggered: true, reason: expect.stringContaining("signals gate: src/meter.ts") });
		expect(decision.decayingHotspots).toEqual([
			expect.objectContaining({
				path: "src/meter.ts",
				healthAtWindowStart: 10,
				changedIn: 4,
				copiedRanges: expect.arrayContaining([expect.anything()]),
			}),
		]);
		expect(decision.couplingCluster).toBeUndefined();
	});

	it("leaves code alone when it is hard to change but no feature keeps touching it, or when it did not get worse", () => {
		const cold = Array.from({ length: 4 }, () => [{ ...meter(), path: "src/other.ts" }]);
		const coldContext = context({ "src/meter.ts": twoCopies, "src/other.ts": healthySource }, cold);
		expect(decideIntervention(gate, historyOf(cold[0]), cold[0], 3, 12, coldContext)).toMatchObject({ triggered: false });

		const alreadyBad = context(
			{ "src/meter.ts": twoCopies },
			Array.from({ length: 4 }, () => [meter()]),
		);
		const history = historyOf([meter()], 4).map((iteration) => ({ ...iteration, ordinal: iteration.ordinal, signals: alreadyBad.signals.current }));
		expect(decideIntervention(gate, history, [meter()], 4, 12, alreadyBad)).toMatchObject({
			triggered: false,
			reason: expect.stringContaining("no hot file is below 9.5 and got worse"),
		});
	});

	it("fires on files in different directories that keep changing together, even when every file is healthy", () => {
		const sources = { "src/orders/pricing.ts": healthySource, "src/billing/rules.ts": healthySource };
		const features = Array.from({ length: 4 }, () => pricing);
		const decision = decideIntervention(gate, historyOf(pricing), pricing, 3, 12, context(sources, features));
		expect(decision).toMatchObject({ triggered: true, couplingCluster: ["src/billing/rules.ts", "src/orders/pricing.ts"] });
		expect(decision.decayingHotspots).toBeUndefined();
	});

	it("waits for four features of history, needs four features left to repay it, and fires once", () => {
		const features = Array.from({ length: 4 }, () => [meter()]);
		const decayed = context({ "src/meter.ts": twoCopies }, features);
		expect(decideIntervention(gate, historyOf([meter()], 2), [meter()], 2, 12, decayed)).toMatchObject({
			triggered: false,
			reason: "fewer than four features of change history",
		});
		expect(decideIntervention(gate, historyOf([meter()], 8), [meter()], 8, 12, decayed)).toMatchObject({
			triggered: false,
			reason: "fewer than four future features can benefit",
		});
		const spent = historyOf([meter()], 4);
		spent[3].intervention.triggered = true;
		expect(decideIntervention(gate, spent, [meter()], 4, 12, decayed)).toMatchObject({
			triggered: false,
			reason: "one-shot adaptive intervention already spent",
		});
	});

	it("records health v2, heat, and coupling at every checkpoint", async () => {
		const sandbox = new TrajectorySandbox();
		const invoke = vi.fn(async () => cannedRun) as unknown as typeof runAgent;
		const result = await executeTrajectory(sandbox, withSteps(2), requireScenario("baseline"), "trace", { runAgent: invoke });
		expect(result.iterations.map((iteration) => iteration.signals?.files.find((file) => file.path === "src/index.ts")?.heat)).toEqual([1, 2]);
		expect(result.iterations[1].signals).toMatchObject({ health: 10, healthWhereWorkIs: 10 });
	});

	/** Feature 1 copies the meter's logic, so by feature 4 a hot file has decayed since the seed. */
	function decayingSandbox() {
		const sandbox = new TrajectorySandbox();
		sandbox.sources = { "src/meter.ts": healthySource };
		sandbox.numstat = "4\t1\tsrc/meter.ts\n";
		return sandbox;
	}

	it("briefs the signals-only refactorer with what the gate saw and that the feature is committed", async () => {
		const sandbox = decayingSandbox();
		const calls: { kind: string; ordinal: number; message: string }[] = [];
		const invoke = vi.fn(
			async (_agent: Parameters<typeof runAgent>[0], message: Parameters<typeof runAgent>[1], options: Parameters<typeof runAgent>[2]) => {
				const [ordinal, kind] = (options.runId ?? "").split(":").slice(-2);
				calls.push({ kind, ordinal: Number(ordinal), message });
				if (kind === "implement" && ordinal === "0") sandbox.sources = { "src/meter.ts": twoCopies };
				return cannedRun;
			},
		) as unknown as typeof runAgent;

		const result = await executeTrajectory(sandbox, withSteps(12), requireScenario("signals-only"), "trace", { runAgent: invoke });

		const refactors = calls.filter((call) => call.kind === "post-refactor");
		expect(refactors.map((call) => call.ordinal)).toEqual([3]);
		expect(refactors[0].message).toContain("is implemented and committed as HEAD");
		expect(refactors[0].message).toContain(`the last 4 features are \`git diff ${SHA1} HEAD\``);
		expect(refactors[0].message).toContain("src/meter.ts is hard to change and often changed");
		expect(refactors[0].message).toContain("repeat code found elsewhere");
		expect(refactors[0].message).not.toContain("uncommitted");
		expect(result.iterations[3].agentPhases.map(({ phase }) => phase)).toEqual(["implement", "trace_author", "post_refactor"]);
	});

	it("opens one skill review of the whole window, which may decline, and never reopens", async () => {
		const sandbox = decayingSandbox();
		const reviewing = reviewingInvoke(() => [reviewFinding({ when: "later" })]);
		const calls = reviewing.calls;
		const invoke = vi.fn(async (...args: Parameters<typeof runAgent>) => {
			if (args[2].runId?.endsWith(":0:implement")) sandbox.sources = { "src/meter.ts": twoCopies };
			return reviewing.invoke(...args);
		}) as unknown as typeof runAgent;

		const result = await executeTrajectory(sandbox, withSteps(12), requireScenario("signals-skill"), "trace", { runAgent: invoke });

		const reviews = calls.filter((call) => call.kind === "review");
		expect(reviews.map((call) => call.ordinal)).toEqual([3]);
		expect(reviews[0].message).toContain("src/meter.ts is hard to change and often changed");
		expect(reviews[0].message).toContain(`Review the last 4 features as one pull request, in diff scope (--diff ${SHA1})`);
		expect(calls.some((call) => call.kind === "post-refactor")).toBe(false);
		expect(result.iterations[3].intervention).toMatchObject({ triggered: false, review: { findings: [expect.objectContaining({ when: "later" })] } });
	});

	it("never reviews healthy code that no cluster drags along", async () => {
		const sandbox = new TrajectorySandbox();
		const { invoke, calls } = reviewingInvoke(() => [reviewFinding()]);
		await executeTrajectory(sandbox, withSteps(12), requireScenario("signals-skill"), "trace", { runAgent: invoke });
		expect(calls.filter((call) => call.kind !== "implement")).toEqual([]);
	});
});
