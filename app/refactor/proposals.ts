import { config } from "../config/index.js";
import { type GitHubClient, type Issue, type ProposalMarker, parseMarker } from "../github/index.js";
import { RefactorFinding } from "../schemas/index.js";
import type { LedgerEntry } from "./workspace.js";

const ACTIONABLE_WHEN = new Set<RefactorFinding["when"]>(["now", "next-change"]);

/**
 * The finding a proposal offers: the skill's highest-ranked finding that it says to act on now or at the next change,
 * that it is confident in, that is not high risk, and whose every plan step preserves behavior. Findings people
 * rejected are never offered again, whatever the skill did with the ledger.
 */
export function chooseFinding(findings: readonly RefactorFinding[], rejected: ReadonlySet<string>): RefactorFinding | undefined {
	return findings.find(
		(finding) =>
			ACTIONABLE_WHEN.has(finding.when) &&
			finding.confidence !== "low" &&
			finding.risk !== "high" &&
			finding.plan.length > 0 &&
			finding.plan.every((step) => step.behavior === "preserving") &&
			!rejected.has(finding.fingerprint),
	);
}

export interface Proposal {
	issue: Issue;
	marker: ProposalMarker;
	finding: RefactorFinding;
}

/** The proposal on an issue the App's bot opened, or null. Anyone can paste a marker, so only the bot's issues count. */
export function readProposal(issue: Issue, botLogin: string): Proposal | null {
	if (issue.isPull || issue.author.login.toLowerCase() !== botLogin.toLowerCase()) return null;
	const marker = parseMarker(issue.body, "proposal");
	if (!marker) return null;
	const finding = RefactorFinding.safeParse(marker.finding);
	if (!finding.success || finding.data.fingerprint !== marker.fingerprint) return null;
	return { issue, marker, finding: finding.data };
}

/** The ledger kept in GitHub: every bot-opened proposal a person labeled rejected. */
export async function rejectedFindings(gh: Pick<GitHubClient, "botLogin" | "listIssuesWithLabel">): Promise<LedgerEntry[]> {
	const bot = await gh.botLogin();
	const issues = await gh.listIssuesWithLabel(config.labels.refactorRejected, "all");
	return issues.flatMap((issue) => {
		const proposal = readProposal(issue, bot);
		return proposal ? [{ fingerprint: proposal.finding.fingerprint, reason: `rejected on #${issue.number}`, at: new Date().toISOString() }] : [];
	});
}

/** An open proposal nobody has rejected yet. The gate opens at most one at a time. */
export async function openProposal(gh: Pick<GitHubClient, "botLogin" | "listIssuesWithLabel">): Promise<Issue | null> {
	const bot = await gh.botLogin();
	const issues = await gh.listIssuesWithLabel(config.labels.refactorProposal, "open");
	return issues.find((issue) => readProposal(issue, bot) && !issue.labels.includes(config.labels.refactorRejected)) ?? null;
}
