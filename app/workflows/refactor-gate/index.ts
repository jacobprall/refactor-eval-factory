import { type TaskContext, task } from "@renderinc/sdk/workflows";
import { refactorReviewer, runAgent } from "../../agents/index.js";
import { traceIds } from "../../claims/trace.js";
import { config, type RepoContext, requireRepo, TASKS } from "../../config/index.js";
import { emit } from "../../events/index.js";
import { proposalBody, refactorTitle, type Spend } from "../../format/index.js";
import { type GitHubClient, githubFor, renderMarker } from "../../github/index.js";
import {
	chooseFinding,
	describeGate,
	discardChanges,
	gateFires,
	installSkill,
	openProposal,
	readHistory,
	rejectedFindings,
	SIGNAL_WINDOW,
	writeLedger,
} from "../../refactor/index.js";
import { type OpenedSandbox, openSandbox, type SandboxRef, withSandbox } from "../../sandbox/index.js";
import { type RefactorFinding, RefactorGateInput, type RefactorReview } from "../../schemas/index.js";
import { addSpend, NO_SPEND } from "../spend.js";

const REVIEW_TIMEOUT_MS = 45 * 60 * 1000;

export interface RefactorGateDeps {
	gh?: GitHubClient;
	openSandbox?: (repo: RepoContext, ref: SandboxRef) => Promise<OpenedSandbox>;
	runAgent?: typeof runAgent;
}

export interface RefactorGateResult {
	outcome: "disabled" | "proposal_open" | "superseded" | "insufficient_history" | "closed" | "declined" | "proposed";
	summary: string;
	sha: string;
	/** The proposal issue: the one that kept the gate from running, or the one it opened. */
	issue?: number;
	healthWhereWorkIs?: number;
	reviewUsd?: number;
}

interface Chosen {
	finding: RefactorFinding;
	review: RefactorReview;
	brief: string[];
	spend: Spend;
}

/**
 * After a push to the base branch: read the signals over the last merges, and when a problem has just formed, review
 * those merges with the refactoring skill and open at most one proposal issue. A closed gate runs no model.
 */
export async function runRefactorGate(ctx: Pick<TaskContext, "metadata">, raw: unknown, deps: RefactorGateDeps = {}): Promise<RefactorGateResult> {
	const input = RefactorGateInput.parse(raw);
	const repo = requireRepo(input.repo, input.installationId);
	const { traceId, runId } = traceIds(ctx);
	const finish = (result: Omit<RefactorGateResult, "sha">): RefactorGateResult => {
		emit({ traceId, runId, repo: repo.fullName, type: "run.finished", payload: { stage: TASKS.refactorGate, sha: input.sha, ...result } });
		return { ...result, sha: input.sha };
	};
	const sources = repo.config.refactor?.sources ?? [];
	if (sources.length === 0) return finish({ outcome: "disabled", summary: "the refactor gate is off for this repository." });

	const gh = deps.gh ?? githubFor(repo);
	const pending = await openProposal(gh);
	if (pending) return finish({ outcome: "proposal_open", summary: "a refactor proposal is still open.", issue: pending.number });

	const open = () => (deps.openSandbox ?? openSandbox)(repo, { kind: "branch", name: repo.config.baseBranch });
	const result = await withSandbox(open, async (sandbox): Promise<Omit<RefactorGateResult, "sha"> | Chosen> => {
		if (sandbox.headSha !== input.sha) return { outcome: "superseded", summary: "the base branch moved; the newer push runs the gate." };
		const history = await readHistory(sandbox, sources);
		if (!history) return { outcome: "insufficient_history", summary: `the base branch has fewer than ${SIGNAL_WINDOW + 2} merges.` };
		const { fires, reading } = gateFires(history);
		const health = { healthWhereWorkIs: reading.healthWhereWorkIs };
		if (!fires) return { outcome: "closed", summary: reading.open ? "the signals match the last merge's." : "no signal fired.", ...health };

		const brief = describeGate(reading);
		await installSkill(sandbox);
		const rejected = await rejectedFindings(gh);
		await writeLedger(sandbox, rejected);
		const run = await (deps.runAgent ?? runAgent)(refactorReviewer, gateMessage(repo, history.windowBase, brief), {
			sandbox,
			traceId,
			runId,
			repo: repo.fullName,
			subject: `${repo.config.baseBranch}@${input.sha.slice(0, 12)}`,
			timeoutMs: REVIEW_TIMEOUT_MS,
		});
		await discardChanges(sandbox);
		const spend = addSpend(NO_SPEND, run);
		const finding = chooseFinding(run.output.findings, new Set(rejected.map((entry) => entry.fingerprint)));
		if (!finding) {
			return { outcome: "declined", summary: "the review found nothing to act on now.", ...health, reviewUsd: spend.costUsd };
		}
		return { finding, review: run.output, brief, spend };
	});
	if ("outcome" in result) return finish(result);

	// Another push's gate may have opened one while this review ran.
	const raced = await openProposal(gh);
	if (raced) return finish({ outcome: "proposal_open", summary: "a refactor proposal opened while this one ran.", issue: raced.number });
	await gh.ensureLabel(config.labels.refactorProposal, "d4c5f9", "software-factory: a refactor the gate proposes");
	const marker = renderMarker("proposal", {
		sha: input.sha,
		fingerprint: result.finding.fingerprint,
		finding: result.finding,
		brief: result.brief,
		reviewUsd: result.spend.costUsd,
	});
	const body = proposalBody({ finding: result.finding, review: result.review, brief: result.brief, merges: SIGNAL_WINDOW, reviewSpend: result.spend });
	const issue = await gh.createIssue({ title: refactorTitle(result.finding), body: `${body}\n\n${marker}`, labels: [config.labels.refactorProposal] });
	return finish({ outcome: "proposed", summary: `opened refactor proposal #${issue.number}.`, issue: issue.number, reviewUsd: result.spend.costUsd });
}

function gateMessage(repo: RepoContext, windowBase: string, brief: readonly string[]): string {
	return [
		`# The last ${SIGNAL_WINDOW} merges to ${repo.config.baseBranch} in ${repo.fullName}`,
		`Review them as one pull request, in diff scope (\`--diff ${windowBase}\`). See the change with \`git diff ${windowBase} HEAD\`.`,
		"## What the signals saw",
		"Change-history signals opened this review. They say where to look, not what to change:",
		brief.join("\n"),
	].join("\n\n");
}

// A replay would repeat the review's model spend; the next push runs the gate again.
task({ name: TASKS.refactorGate, timeoutSeconds: 2 * 60 * 60, retry: { maxRetries: 0, waitDurationMs: 5_000, backoffScaling: 1 } }, (ctx, raw: unknown) =>
	runRefactorGate(ctx, raw),
);
