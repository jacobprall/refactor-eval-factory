import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FactoryEvent } from "../app/events/index.js";
import { BUILD_COMMAND, REPO, TEST_COMMAND } from "./fixtures/config.js";

vi.mock("../app/events/index.js", () => ({ emit: (_event: FactoryEvent) => {} }));

const { config } = await import("../app/config/index.js");
const { parseMarker, renderMarker } = await import("../app/github/index.js");
const { runRefactorApply } = await import("../app/workflows/refactor-apply/index.js");
type GitHubClient = import("../app/github/index.js").GitHubClient;
type GitDataClient = import("../app/github/index.js").GitDataClient;
type Issue = import("../app/github/index.js").Issue;
type IssueComment = import("../app/github/index.js").IssueComment;
type ExecOptions = import("../app/sandbox/index.js").ExecOptions;
type ExecResult = import("../app/sandbox/index.js").ExecResult;
type RefactorFinding = import("../app/schemas/index.js").RefactorFinding;
type RefactorApplyDeps = import("../app/workflows/refactor-apply/index.js").RefactorApplyDeps;
type PublishResult = import("../app/changeset/index.js").PublishResult;

const BOT = "software-factory[bot]";
const BASE = "b".repeat(40);
const ISSUE = 21;
const ctx = { metadata: { taskRunId: "trn-apply" } };
const input = { repo: REPO, installationId: 5, issue: ISSUE, actor: "alice" };
const REPLAY_COMMAND = "npx tsx .refactor-trace/replay.ts";
const BEFORE = '{"result":1,"case":"a"}\n{"case":"b","result":2}\n';

const FINDING: RefactorFinding = {
	id: "F1",
	fingerprint: "reinvented-logic:src/meter.ts#preview",
	title: "preview re-implements record's limit decision",
	primary: "reinvented-logic",
	sites: [{ path: "src/meter.ts", symbol: "preview" }],
	symptom: "change amplification",
	case_for: "Every limit change edits two places.",
	case_against: "",
	severity: "medium",
	confidence: "high",
	effort: "S",
	when: "now",
	risk: "low",
	plan: [{ refactor: "replace-with-existing-function", direction: "remove", behavior: "preserving", note: "" }],
};

function proposal(overrides: Partial<Issue> = {}): Issue {
	const marker = renderMarker("proposal", { sha: BASE, fingerprint: FINDING.fingerprint, finding: FINDING, brief: [], reviewUsd: 1.5 });
	return {
		number: ISSUE,
		title: "Refactor: preview",
		body: `Proposal\n\n${marker}`,
		state: "open",
		labels: [config.labels.refactorProposal, config.labels.refactorApproved],
		author: { login: BOT, type: "Bot" },
		isPull: false,
		htmlUrl: "",
		...overrides,
	};
}

interface Options {
	issue?: Issue;
	/** Replay stdout before the refactor (twice) and after it. */
	replay?: { before?: string[]; after?: string };
	applied?: boolean;
	verifyFails?: boolean;
}

function setup(opts: Options = {}) {
	const comments: IssueComment[] = [];
	const gh = {
		botLogin: async () => BOT,
		getPermission: async () => "write" as const,
		getIssue: async () => opts.issue ?? proposal(),
		listIssueComments: async () => comments.map((c) => ({ ...c })),
		createComment: async (_n: number, body: string) => {
			const comment = { id: comments.length + 1, body, author: { login: BOT, type: "Bot" }, createdAt: "", updatedAt: "", htmlUrl: "" };
			comments.push(comment);
			return comment;
		},
		updateComment: async (id: number, body: string) => {
			const comment = comments.find((c) => c.id === id) as IssueComment;
			comment.body = body;
			return comment;
		},
		ensureLabel: async () => {},
		addLabels: async () => {},
		removeLabel: async () => {},
		http: { json: vi.fn(async () => ({ id: 4242 })) },
		ensurePull: vi.fn(async (_args: { head: string; base: string; title: string; body: string; draft?: boolean }) => ({
			pull: { number: 40, headSha: "c".repeat(40), htmlUrl: `https://github.com/${REPO}/pull/40` },
			created: true,
		})),
	};

	/** Sandbox commands and agent runs, in order. */
	const log: string[] = [];
	const replayOutputs = [...(opts.replay?.before ?? [BEFORE, BEFORE]), opts.replay?.after ?? BEFORE];
	let pendingReplay: string | undefined;
	const sandbox = {
		id: "sbx-apply",
		headSha: BASE,
		manifest: { repo: REPO, baseBranch: "main", sha: BASE, lockfileHash: "", install: null, createdAt: "" },
		exec: vi.fn(async (command: string, _opts?: ExecOptions): Promise<ExecResult> => {
			log.push(command);
			if (command.startsWith("git status")) return { exitCode: 0, stdout: opts.applied === false ? "" : " M src/meter.ts\n", stderr: "" };
			if (command.startsWith(`( ${REPLAY_COMMAND} )`)) pendingReplay = replayOutputs.shift();
			if (command === TEST_COMMAND && opts.verifyFails) return { exitCode: 1, stdout: "FAIL", stderr: "" };
			return { exitCode: 0, stdout: "", stderr: "" };
		}),
		upload: vi.fn(async () => {}),
		download: vi.fn(async (path: string) => {
			if (path.includes("/replay-") && pendingReplay !== undefined) return Buffer.from(pendingReplay);
			throw new Error(`unexpected download ${path}`);
		}),
		close: vi.fn(async () => {}),
	};
	const messages: Record<string, string> = {};
	const runAgent = vi.fn(async (agent: { id: string }, message: string) => {
		log.push(`agent:${agent.id}`);
		messages[agent.id] = message;
		const usage = { input_tokens: 1_000, output_tokens: 2_000, cache_read_tokens: 100_000, cache_write_tokens: 0 };
		if (agent.id === "replay-author") return { output: { summary: "40 cases.", command: REPLAY_COMMAND }, costUsd: 0.3, usage, turns: 3 };
		return {
			output: { applied: opts.applied ?? true, summary: "preview now calls record's decision.", changedPaths: ["src/meter.ts"], testsRun: [], expectedBenefit: "" },
			costUsd: 0.7,
			usage,
			turns: 9,
		};
	});
	const publish = vi.fn(async (): Promise<PublishResult> => ({ commitSha: "d".repeat(40), treeSha: "e".repeat(40), changedFiles: [] }));
	const git = { getRef: vi.fn(async () => null), getCommit: vi.fn() };
	const deps: RefactorApplyDeps = {
		gh: gh as unknown as GitHubClient,
		runs: { getTaskRun: async () => ({ status: "succeeded" }), cancelTaskRun: async () => {}, terminateSandbox: async () => {} },
		gitData: git as unknown as GitDataClient,
		openSandbox: vi.fn(async () => sandbox),
		runAgent: runAgent as unknown as RefactorApplyDeps["runAgent"],
		publish: publish as unknown as RefactorApplyDeps["publish"],
		now: () => new Date("2026-11-09T12:00:00Z"),
	};
	const status = () => comments.find((c) => parseMarker(c.body, "status"))?.body ?? "";
	return { gh, sandbox, log, messages, runAgent, publish, deps, status, run: () => runRefactorApply(ctx, input, deps) };
}

beforeEach(() => vi.clearAllMocks());

describe("refactor apply", () => {
	it("opens a draft PR when the replay matches and verify passes, pricing the decision and the refactor", async () => {
		const t = setup();
		expect(await t.run()).toMatchObject({ state: "done", outcome: "pr_opened" });

		expect(t.publish).toHaveBeenCalledWith(expect.objectContaining({ baseSha: BASE, branch: `factory/refactor-${ISSUE}` }));
		const pr = t.gh.ensurePull.mock.calls[0]?.[0];
		expect(pr).toMatchObject({ head: `factory/refactor-${ISSUE}`, base: "main", draft: true, title: `Refactor: ${FINDING.title}` });
		expect(pr?.body).toContain(`Closes #${ISSUE}.`);
		expect(pr?.body).toContain("A replay of 2 cases");
		expect(parseMarker(pr?.body ?? "", "spend")).toMatchObject({ kind: "refactor", costUsd: 1, decisionUsd: 1.5 });
		expect(t.log).toContain(BUILD_COMMAND);
		expect(t.log).toContain(TEST_COMMAND);
	});

	it("locks the replay away from the applier: recorded and moved root-only before it runs, restored only after", async () => {
		const t = setup();
		await t.run();
		const authored = t.log.indexOf("agent:replay-author");
		const stashed = t.log.findIndex((entry) => /^mkdir -m 700 \/tmp\/factory-replay-.* && mv .*\.refactor-trace/.test(entry));
		const applied = t.log.indexOf("agent:refactor-applier");
		const restored = t.log.findIndex((entry) => entry.includes("cp -R /tmp/factory-replay-"));
		expect(authored).toBeGreaterThan(-1);
		expect(stashed).toBeGreaterThan(authored);
		expect(applied).toBeGreaterThan(stashed);
		expect(restored).toBeGreaterThan(applied);
		expect(t.messages["refactor-applier"]).not.toContain(REPLAY_COMMAND);
		expect(t.messages["refactor-applier"]).not.toContain(".refactor-trace");
	});

	it("publishes nothing when the refactor changes what the code does", async () => {
		const t = setup({ replay: { after: '{"case":"a","result":1}\n{"case":"b","result":3}\n' } });
		expect(await t.run()).toMatchObject({ state: "failed", outcome: "behavior_changed" });
		expect(t.publish).not.toHaveBeenCalled();
		expect(t.status()).toContain("changed at case 2 of 2");
		expect(t.status()).toContain(config.labels.refactorRejected);
	});

	it("treats reordered JSON fields as the same behavior", async () => {
		const t = setup({ replay: { after: '{"case":"a","result":1}\n{"result":2,"case":"b"}\n' } });
		expect(await t.run()).toMatchObject({ state: "done", outcome: "pr_opened" });
	});

	it("changes nothing when no deterministic replay could be recorded", async () => {
		const t = setup({ replay: { before: [BEFORE, '{"case":"a","result":"different"}\n'] } });
		expect(await t.run()).toMatchObject({ state: "failed", outcome: "replay_unavailable" });
		expect(t.log).not.toContain("agent:refactor-applier");
		expect(t.publish).not.toHaveBeenCalled();
	});

	it("publishes nothing when verify fails after the refactor", async () => {
		const t = setup({ verifyFails: true });
		expect(await t.run()).toMatchObject({ state: "failed", outcome: "verification_failed" });
		expect(t.publish).not.toHaveBeenCalled();
	});

	it("reports when the finding no longer holds", async () => {
		const t = setup({ applied: false });
		expect(await t.run()).toMatchObject({ state: "done", outcome: "no_changes" });
		expect(t.publish).not.toHaveBeenCalled();
	});

	it("applies only proposals the App's bot opened, and never a rejected one", async () => {
		const forged = setup({ issue: proposal({ author: { login: "mallory", type: "User" } }) });
		expect(await forged.run()).toMatchObject({ state: "failed", outcome: "not_a_proposal" });
		expect(forged.deps.openSandbox).not.toHaveBeenCalled();

		const rejected = setup({ issue: proposal({ labels: [config.labels.refactorProposal, config.labels.refactorRejected] }) });
		expect(await rejected.run()).toMatchObject({ state: "failed", outcome: "proposal_rejected" });
		expect(rejected.deps.openSandbox).not.toHaveBeenCalled();
	});

	it("keeps the skill's working files out of the published change", async () => {
		const t = setup();
		await t.run();
		const afterApplier = t.log.slice(t.log.indexOf("agent:refactor-applier"));
		const reset = afterApplier.findIndex((entry) => entry.startsWith("rm -rf .refactor &&"));
		expect(reset).toBeGreaterThan(-1);
		expect(reset).toBeLessThan(afterApplier.findIndex((entry) => entry.startsWith("git status")));
	});
});
