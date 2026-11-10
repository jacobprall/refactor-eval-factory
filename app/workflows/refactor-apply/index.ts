import { refactorApplier, replayAuthor, runAgent } from "../../agents/index.js";
import { publish } from "../../changeset/index.js";
import { ExpectedFailure, type Outcome } from "../../claims/index.js";
import { config, type RepoContext, TASKS } from "../../config/index.js";
import { fenced, refactorPullBody, refactorTitle, verbatimCodeSpan } from "../../format/index.js";
import { type GitDataClient, type GitHubClient, gitData } from "../../github/index.js";
import { compareReplay, installSkill, type Proposal, readProposal, recordReplay, resetSkillOutput, TRACE_DIR } from "../../refactor/index.js";
import { type OpenedSandbox, openSandbox, type SandboxRef, withSandbox } from "../../sandbox/index.js";
import { RefactorApplyInput } from "../../schemas/index.js";
import { defineGitHubTask, type GitHubTaskDeps } from "../github-task.js";
import { runVerify } from "../run-verify.js";
import { botIdentity, commitDate, ownedCommits, refusalSummary } from "../spec-to-pr/branch.js";
import { allPassed, failureSummary, hasChanges } from "../spec-to-pr/verify.js";
import { addSpend, NO_SPEND, spendMarker } from "../spend.js";

const APPLY_TIMEOUT_MS = 60 * 60 * 1000;

export interface RefactorApplyDeps extends GitHubTaskDeps {
	gitData?: GitDataClient;
	openSandbox?: (repo: RepoContext, ref: SandboxRef) => Promise<OpenedSandbox>;
	runAgent?: typeof runAgent;
	publish?: typeof publish;
	now?: () => Date;
}

const refactorBranch = (issue: number): string => `factory/refactor-${issue}`;

/**
 * Approved proposal to draft PR. A separate agent records a replay of the code's current behavior, which is locked
 * away before the applier starts; the refactor is published only if the replay's output is unchanged and every
 * verify command passes.
 */
export const refactorApplyWorkflow = defineGitHubTask(
	{
		name: TASKS.refactorApply,
		title: "Refactor",
		input: RefactorApplyInput,
		subject: (input) => ({ kind: "issue", number: input.issue }),
		timeoutSeconds: 3 * 60 * 60,
	},
	async (claim, input, deps: RefactorApplyDeps): Promise<Outcome> => {
		const { gh, repo } = claim;
		const date = commitDate((deps.now ?? (() => new Date()))());
		const proposal = await loadProposal(gh, input.issue);
		const author = await botIdentity(gh, date);
		const git = deps.gitData ?? gitData(repo);
		const branch = refactorBranch(input.issue);
		const agent = deps.runAgent ?? runAgent;

		await claim.reportProgress("opening a sandbox");
		const open = () => (deps.openSandbox ?? openSandbox)(repo, { kind: "branch", name: repo.config.baseBranch });
		return withSandbox(open, async (sandbox) => {
			await claim.trackSandbox(sandbox);
			const baseSha = sandbox.headSha;
			const owned = await ownedCommits(git, branch, baseSha, author);
			await installSkill(sandbox);

			await claim.reportProgress("recording the code's current behavior");
			const finding = fenced(JSON.stringify(proposal.finding, null, 2), "json");
			const authored = await agent(replayAuthor, replayMessage(finding), claim.agentRunOptions(sandbox));
			let spend = addSpend(NO_SPEND, authored);
			const recorded = await recordReplay(sandbox, authored.output.command);
			if (recorded.status === "unavailable") {
				throw new ExpectedFailure(
					"couldn't record a replay of the code's current behavior, so nothing was changed. Remove and reapply the label to retry.",
					"replay_unavailable",
				);
			}

			await claim.reportProgress("applying the refactor");
			const applied = await agent(refactorApplier, applyMessage(repo, proposal, finding), { ...claim.agentRunOptions(sandbox), timeoutMs: APPLY_TIMEOUT_MS });
			spend = addSpend(spend, applied);
			await resetSkillOutput(sandbox);
			if (!applied.output.applied || !(await hasChanges(sandbox))) {
				return { outcome: "no_changes", summary: "the refactoring agent found the finding no longer holds, so there is nothing to publish." };
			}

			await claim.reportProgress("replaying the recorded behavior");
			const replay = await compareReplay(sandbox, recorded);
			if (replay.status !== "passed") {
				const detail = replay.status === "diverged" ? `its output changed at case ${replay.line} of ${replay.cases}` : `it exited ${replay.exitCode}`;
				throw new ExpectedFailure(
					`the refactor changed the code's behavior: ${detail}. Nothing was published. Add \`${config.labels.refactorRejected}\` to drop this finding, or remove and reapply \`${config.labels.refactorApproved}\` to try again.`,
					"behavior_changed",
				);
			}

			await claim.reportProgress("running the verify commands");
			const verification = await runVerify(sandbox, repo.config.verify);
			if (!allPassed(verification)) {
				throw new ExpectedFailure(`verification failed after the refactor: ${failureSummary(verification)}. Nothing was published.`, "verification_failed");
			}

			await claim.reportProgress("publishing the branch");
			const published = await (deps.publish ?? publish)({
				sandbox,
				repo,
				baseSha,
				branch,
				message: `${refactorTitle(proposal.finding)}\n\nRefs #${input.issue}`,
				author,
				ownedCommits: owned,
				gitData: git,
			});
			if ("refused" in published) throw new ExpectedFailure(refusalSummary(published.refused), "publish_refused");

			await claim.reportProgress("opening the draft pull request");
			const body = refactorPullBody({
				issue: input.issue,
				finding: proposal.finding,
				application: applied.output,
				replayCases: replay.cases,
				verification,
				spend,
			});
			const { pull } = await gh.ensurePull({
				head: branch,
				base: repo.config.baseBranch,
				title: refactorTitle(proposal.finding),
				body: `${body}\n\n${spendMarker("refactor", spend, proposal.marker.reviewUsd)}`,
				draft: true,
			});
			return {
				outcome: "pr_opened",
				summary: `opened draft PR #${pull.number}. The replay of ${replay.cases} cases matched.`,
				links: [{ label: `Draft PR #${pull.number}`, url: pull.htmlUrl }],
			};
		});
	},
);

export const runRefactorApply = refactorApplyWorkflow.run;

async function loadProposal(gh: Pick<GitHubClient, "getIssue" | "botLogin">, number: number): Promise<Proposal> {
	const issue = await gh.getIssue(number);
	const proposal = readProposal(issue, await gh.botLogin());
	if (!proposal) throw new ExpectedFailure("this issue isn't a refactor proposal the factory opened, so there's nothing to apply.", "not_a_proposal");
	if (issue.state !== "open") throw new ExpectedFailure("this proposal is closed. Reopen it to apply it.", "proposal_closed");
	if (issue.labels.includes(config.labels.refactorRejected)) {
		throw new ExpectedFailure(`this proposal is labeled \`${config.labels.refactorRejected}\`. Remove that label to apply it.`, "proposal_rejected");
	}
	return proposal;
}

function replayMessage(finding: string): string {
	return [
		"A refactor is about to change the code at the sites in this finding. Record what that code does today.",
		`Write the replay under \`${TRACE_DIR}/\`.`,
		`## Finding\n\n${finding}`,
	].join("\n\n");
}

function applyMessage(repo: RepoContext, proposal: Proposal, finding: string): string {
	const verify = repo.config.verify.length ? repo.config.verify.map((command) => `- ${verbatimCodeSpan(command)}`).join("\n") : "- (none configured)";
	return [
		`Apply this approved finding in ${repo.fullName}. The review ran at ${proposal.marker.sha}; the checkout may be newer.`,
		`## Finding\n\n${finding}`,
		`## Verify commands\n\n${verify}`,
	].join("\n\n");
}
