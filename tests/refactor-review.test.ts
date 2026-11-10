import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FactoryEvent } from "../app/events/index.js";
import { REPO } from "./fixtures/config.js";

vi.mock("../app/events/index.js", () => ({ emit: (_event: FactoryEvent) => {} }));

const { parseMarker, renderMarker } = await import("../app/github/index.js");
const { runRefactorReview } = await import("../app/workflows/refactor-review/index.js");
type GitHubClient = import("../app/github/index.js").GitHubClient;
type IssueComment = import("../app/github/index.js").IssueComment;
type OpenedSandbox = import("../app/sandbox/index.js").OpenedSandbox;
type RefactorFinding = import("../app/schemas/index.js").RefactorFinding;
type RefactorReviewDeps = import("../app/workflows/refactor-review/index.js").RefactorReviewDeps;

const BOT = "software-factory[bot]";
const HEAD = "a".repeat(40);
const MERGE_BASE = "b".repeat(40);
const ctx = { metadata: { taskRunId: "trn-rr" } };
const input = { repo: REPO, installationId: 5, pr: 34, headSha: HEAD, actor: "alice" };

const finding = (overrides: Partial<RefactorFinding> = {}): RefactorFinding => ({
	id: "F1",
	fingerprint: "dead-code:src/a.ts#old",
	title: "old is unused; ping @everyone",
	primary: "dead-code",
	sites: [{ path: "src/a.ts", symbol: "old" }],
	symptom: "cognitive load",
	case_for: "Nothing calls it. <!-- software-factory:review x -->",
	case_against: "",
	severity: "low",
	confidence: "high",
	effort: "S",
	when: "now",
	risk: "low",
	plan: [{ refactor: "remove-dead-code", direction: "remove", behavior: "preserving", note: "" }],
	...overrides,
});

function setup(opts: { headSha?: string; existing?: boolean } = {}) {
	const comments: IssueComment[] = [];
	const add = (login: string, body: string) => {
		const comment = { id: comments.length + 1, body, author: { login, type: "Bot" }, createdAt: "", updatedAt: "", htmlUrl: `https://x/${comments.length + 1}` };
		comments.push(comment);
		return comment;
	};
	if (opts.existing) add(BOT, `Earlier review\n\n${renderMarker("refactor-review", { headSha: HEAD, runId: "trn-old" })}`);
	const gh = {
		botLogin: async () => BOT,
		getPermission: async () => "write" as const,
		getPull: async () => ({ number: 34, state: "open", merged: false, title: "t", body: "", headSha: opts.headSha ?? HEAD, headRef: "f", baseRef: "main", htmlUrl: "" }),
		listIssueComments: async () => comments.map((c) => ({ ...c })),
		listIssuesWithLabel: async () => [],
		createComment: vi.fn(async (_n: number, body: string) => add(BOT, body)),
		updateComment: async (id: number, body: string) => {
			const comment = comments.find((c) => c.id === id) as IssueComment;
			comment.body = body;
			return comment;
		},
		ensureLabel: async () => {},
		addLabels: async () => {},
		removeLabel: async () => {},
	};
	const sandbox: OpenedSandbox = {
		id: "sbx-rr",
		headSha: HEAD,
		manifest: { repo: REPO, baseBranch: "main", sha: HEAD, lockfileHash: "", install: null, createdAt: "" },
		exec: vi.fn(async (command: string) => ({ exitCode: 0, stdout: command.startsWith("git merge-base") ? `${MERGE_BASE}\n` : "", stderr: "" })),
		upload: vi.fn(async () => {}),
		download: vi.fn(async () => Buffer.alloc(0)),
		close: vi.fn(async () => {}),
	};
	const runAgent = vi.fn(async (_agent: { id: string }, _message: string) => ({
		output: { summary: "One dead function.", static_only: true, findings: [finding(), finding({ id: "F2", title: "Later thing", when: "later" })] },
		costUsd: 0.9,
		usage: { input_tokens: 0, output_tokens: 0, cache_read_tokens: 0, cache_write_tokens: 0 },
		turns: 4,
	}));
	const deps: RefactorReviewDeps = {
		gh: gh as unknown as GitHubClient,
		runs: { getTaskRun: async () => ({ status: "succeeded" }), cancelTaskRun: async () => {}, terminateSandbox: async () => {} },
		openSandbox: vi.fn(async () => sandbox),
		runAgent: runAgent as unknown as RefactorReviewDeps["runAgent"],
	};
	const reviews = () => comments.filter((c) => parseMarker(c.body, "refactor-review"));
	return { gh, runAgent, deps, reviews, run: () => runRefactorReview(ctx, input, deps) };
}

beforeEach(() => vi.clearAllMocks());

describe("refactor review", () => {
	it("posts one comment for the head commit, separating what to change now from what can wait", async () => {
		const t = setup();
		expect(await t.run()).toMatchObject({ state: "done", outcome: "reviewed" });
		expect(t.runAgent.mock.calls[0]?.[1]).toContain(`--diff ${MERGE_BASE}`);
		const [review] = t.reviews();
		expect(t.reviews()).toHaveLength(1);
		expect(parseMarker(review?.body ?? "", "refactor-review")).toMatchObject({ headSha: HEAD });
		expect(review?.body).toContain("## Not now");
		expect(review?.body).toContain("without running the project's tests");
	});

	it("neutralizes mentions and marker look-alikes in the skill's text", async () => {
		const t = setup();
		await t.run();
		const body = t.reviews()[0]?.body ?? "";
		expect(body).not.toContain("@everyone");
		expect(parseMarker(body, "review")).toBeNull();
	});

	it("doesn't review a commit it already reviewed", async () => {
		const t = setup({ existing: true });
		expect(await t.run()).toMatchObject({ outcome: "already_reviewed" });
		expect(t.runAgent).not.toHaveBeenCalled();
	});

	it("refuses when the PR moved after it was labeled", async () => {
		const t = setup({ headSha: "c".repeat(40) });
		expect(await t.run()).toMatchObject({ state: "failed", outcome: "head_moved" });
		expect(t.runAgent).not.toHaveBeenCalled();
	});
});
