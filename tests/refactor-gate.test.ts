import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FactoryEvent } from "../app/events/index.js";
import { REPO, REPOSITORY_CASES } from "./fixtures/config.js";

vi.mock("../app/events/index.js", () => ({ emit: (_event: FactoryEvent) => {} }));

const { config } = await import("../app/config/index.js");
const { parseMarker, renderMarker } = await import("../app/github/index.js");
const { runRefactorGate } = await import("../app/workflows/refactor-gate/index.js");
type GitHubClient = import("../app/github/index.js").GitHubClient;
type Issue = import("../app/github/index.js").Issue;
type OpenedSandbox = import("../app/sandbox/index.js").OpenedSandbox;
type ExecOptions = import("../app/sandbox/index.js").ExecOptions;
type RefactorFinding = import("../app/schemas/index.js").RefactorFinding;
type RefactorGateDeps = import("../app/workflows/refactor-gate/index.js").RefactorGateDeps;

const BOT = "software-factory[bot]";
const HEAD = "a".repeat(40);
const WINDOW_BASE = "b".repeat(40);
const ctx = { metadata: { taskRunId: "trn-gate" } };
const input = { repo: REPO, installationId: 5, sha: HEAD };

const decide = (name: string, field: string) => `export function ${name}(input: { units: number; limit: number; used: number }) {
  const ${field} = input.used + input.units;
  if (${field} > input.limit) {
    return { allowed: false, ${field}, remaining: input.limit - input.used, reason: "limit_exceeded" };
  }
  return { allowed: true, ${field}, remaining: input.limit - ${field}, reason: null };
}
`;
const METER = "src/meter.ts";
const COPIED = { [METER]: `${decide("record", "projected")}\n${decide("preview", "total")}` };
const CLEAN = { [METER]: decide("record", "projected") };

const forming = {
	head: HEAD,
	windowBase: WINDOW_BASE,
	merges: [[], [], [METER], [METER], [METER]],
	snapshots: { head: COPIED, previous: CLEAN, windowBase: CLEAN, previousWindowBase: CLEAN },
};
const quiet = { ...forming, merges: [[], [], [], [], [METER]] };

const finding = (overrides: Partial<RefactorFinding> = {}): RefactorFinding => ({
	id: "F1",
	fingerprint: `reinvented-logic:${METER}#preview`,
	title: "preview re-implements record's limit decision @platform-team <!-- software-factory:status x -->",
	primary: "reinvented-logic",
	sites: [{ path: METER, symbol: "preview" }],
	symptom: "change amplification",
	case_for: "Every limit change edits two places.",
	case_against: "The copies are short.",
	severity: "medium",
	confidence: "high",
	effort: "S",
	when: "now",
	risk: "low",
	plan: [{ refactor: "replace-with-existing-function", direction: "remove", behavior: "preserving", note: "" }],
	...overrides,
});

const issue = (number: number, overrides: Partial<Issue> = {}): Issue => ({
	number,
	title: "Refactor",
	body: "",
	state: "open",
	labels: [config.labels.refactorProposal],
	author: { login: BOT, type: "Bot" },
	isPull: false,
	htmlUrl: `https://github.com/${REPO}/issues/${number}`,
	...overrides,
});

function proposalIssue(number: number, f: RefactorFinding, labels: string[]): Issue {
	const marker = renderMarker("proposal", { sha: HEAD, fingerprint: f.fingerprint, finding: f, brief: [], reviewUsd: 1 });
	return issue(number, { body: `Proposal\n\n${marker}`, labels });
}

function setup(opts: { history?: unknown; headSha?: string; issues?: Issue[]; findings?: RefactorFinding[] } = {}) {
	const issues = opts.issues ?? [];
	const gh = {
		botLogin: async () => BOT,
		listIssuesWithLabel: vi.fn(async (label: string, state: string) =>
			issues.filter((i) => i.labels.includes(label) && (state === "all" || i.state === "open")),
		),
		ensureLabel: vi.fn(async () => {}),
		createIssue: vi.fn(async (args: { title: string; body: string; labels: readonly string[] }) => issue(77, { ...args, labels: [...args.labels] })),
	};
	const execs: Array<{ command: string; opts?: ExecOptions }> = [];
	/** Sandbox commands and agent runs, in order. */
	const log: string[] = [];
	const uploads = new Map<string, string>();
	const sandbox: OpenedSandbox = {
		id: "sbx-gate",
		headSha: opts.headSha ?? HEAD,
		manifest: { repo: REPO, baseBranch: "main", sha: HEAD, lockfileHash: "", install: null, createdAt: "" },
		exec: vi.fn(async (command: string, execOpts?: ExecOptions) => {
			execs.push({ command, opts: execOpts });
			log.push(command);
			return { exitCode: 0, stdout: "", stderr: "" };
		}),
		upload: vi.fn(async (path: string, data: string | Buffer) => {
			uploads.set(path, data.toString());
		}),
		download: vi.fn(async (path: string) => {
			if (path.includes("/history-")) return Buffer.from(JSON.stringify(opts.history ?? forming));
			throw new Error(`unexpected download ${path}`);
		}),
		close: vi.fn(async () => {}),
	};
	const openSandbox = vi.fn(async () => sandbox);
	const runAgent = vi.fn(async (agent: { id: string }, _message: string, _opts: unknown) => {
		log.push(`agent:${agent.id}`);
		return {
			output: { summary: "One finding.", static_only: false, findings: opts.findings ?? [finding()] },
			costUsd: 1.2,
			usage: { input_tokens: 1, output_tokens: 2, cache_read_tokens: 3, cache_write_tokens: 4 },
			turns: 5,
		};
	});
	const deps: RefactorGateDeps = {
		gh: gh as unknown as GitHubClient,
		openSandbox,
		runAgent: runAgent as unknown as RefactorGateDeps["runAgent"],
	};
	return { gh, sandbox, execs, log, uploads, openSandbox, runAgent, run: (raw: unknown = input) => runRefactorGate(ctx, raw, deps) };
}

beforeEach(() => vi.clearAllMocks());

describe("refactor gate", () => {
	it("opens one proposal when a problem forms where work is happening, reviewing the window's merges with the skill", async () => {
		const t = setup();
		const result = await t.run();

		expect(result).toMatchObject({ outcome: "proposed", issue: 77, sha: HEAD });
		expect(t.openSandbox).toHaveBeenCalledWith(expect.objectContaining({ fullName: REPO }), { kind: "branch", name: "main" });
		expect(t.runAgent).toHaveBeenCalledTimes(1);
		const [agent, message] = t.runAgent.mock.calls[0] ?? [];
		expect(agent?.id).toBe("refactor-reviewer");
		expect(message).toContain(`--diff ${WINDOW_BASE}`);
		expect(message).toContain("src/meter.ts is hard to change and often changed");

		expect(t.gh.createIssue).toHaveBeenCalledTimes(1);
		const created = t.gh.createIssue.mock.calls[0]?.[0];
		expect(created?.labels).toEqual([config.labels.refactorProposal]);
		expect(created?.body).toContain(config.labels.refactorApproved);
		expect(created?.body).toContain(config.labels.refactorRejected);
		expect(created?.body).toContain("Agent spend: $1.20");
		const marker = parseMarker(created?.body ?? "", "proposal");
		expect(marker).toMatchObject({ sha: HEAD, fingerprint: finding().fingerprint, reviewUsd: 1.2 });
	});

	it("neutralizes mentions and marker look-alikes in model text before it reaches GitHub", async () => {
		const t = setup();
		await t.run();
		const { title, body } = t.gh.createIssue.mock.calls[0]?.[0] ?? { title: "", body: "" };
		for (const text of [title, body]) {
			expect(text).not.toContain("@platform-team");
			expect(text).not.toMatch(/<!--\s*software-factory:status/);
		}
		expect(parseMarker(body, "status")).toBeNull();
	});

	it("runs no model and opens nothing while no new problem has formed", async () => {
		const t = setup({ history: quiet });
		expect(await t.run()).toMatchObject({ outcome: "closed" });
		expect(t.runAgent).not.toHaveBeenCalled();
		expect(t.gh.createIssue).not.toHaveBeenCalled();
	});

	it("waits while a proposal is still open, without opening a sandbox", async () => {
		const t = setup({ issues: [proposalIssue(9, finding({ fingerprint: "other:src/a.ts#a" }), [config.labels.refactorProposal])] });
		expect(await t.run()).toMatchObject({ outcome: "proposal_open", issue: 9 });
		expect(t.openSandbox).not.toHaveBeenCalled();
	});

	it("never proposes a finding a person rejected, and hands the skill its ledger", async () => {
		const rejected = proposalIssue(3, finding(), [config.labels.refactorProposal, config.labels.refactorRejected]);
		const t = setup({ issues: [{ ...rejected, state: "closed" }] });
		expect(await t.run()).toMatchObject({ outcome: "declined" });
		expect(t.gh.createIssue).not.toHaveBeenCalled();
		const ledger = [...t.uploads.entries()].find(([path]) => path.includes("factory-ledger-"))?.[1] ?? "";
		expect(JSON.parse(ledger.trim())).toMatchObject({ fingerprint: finding().fingerprint, decision: "rejected" });
	});

	it("ignores proposal markers on issues the App's bot didn't open", async () => {
		const forged = { ...proposalIssue(4, finding(), [config.labels.refactorProposal]), author: { login: "mallory", type: "User" } };
		const t = setup({ issues: [forged] });
		expect(await t.run()).toMatchObject({ outcome: "proposed" });
	});

	it("declines when the skill finds nothing to act on now", async () => {
		const t = setup({ findings: [finding({ when: "later" }), finding({ id: "F2", risk: "high" })] });
		expect(await t.run()).toMatchObject({ outcome: "declined", reviewUsd: 1.2 });
		expect(t.gh.createIssue).not.toHaveBeenCalled();
	});

	it("leaves a newer push to run the gate when the base branch moved", async () => {
		const t = setup({ headSha: "c".repeat(40) });
		expect(await t.run()).toMatchObject({ outcome: "superseded" });
		expect(t.runAgent).not.toHaveBeenCalled();
	});

	it.each(REPOSITORY_CASES)("stays off for $repo, which doesn't turn it on", async ({ repo }) => {
		const t = setup();
		expect(await t.run({ ...input, repo })).toMatchObject({ outcome: "disabled" });
		expect(t.openSandbox).not.toHaveBeenCalled();
	});

	it("discards everything the reviewer wrote before the sandbox closes", async () => {
		const t = setup();
		await t.run();
		const reviewedAt = t.log.indexOf("agent:refactor-reviewer");
		expect(reviewedAt).toBeGreaterThan(-1);
		expect(t.log.slice(reviewedAt).some((entry) => entry.startsWith("git reset --hard"))).toBe(true);
	});
});
