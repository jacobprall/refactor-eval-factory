import { config } from "../config/index.js";
import type { RefactorApplication, RefactorFinding, RefactorReview } from "../schemas/index.js";
import { escapeCell, type VerifyResult, verificationTable } from "./pull-request.js";
import { type Spend, spendLine } from "./spend.js";
import { BODY_MAX_CHARS, codeSpan, fitAround, sanitize, sanitizeInline, truncate } from "./text.js";

const TITLE_MAX_CHARS = 256;
const MAX_OTHER_FINDINGS = 5;

export function refactorTitle(finding: RefactorFinding): string {
	const title = `Refactor: ${sanitizeInline(finding.title)}`;
	return title.length <= TITLE_MAX_CHARS ? title : `${title.slice(0, TITLE_MAX_CHARS - 1).trimEnd()}…`;
}

export interface ProposalBodyInput {
	finding: RefactorFinding;
	review: RefactorReview;
	/** The gate's brief: generated from the signals, but it quotes repository paths and symbols. */
	brief: readonly string[];
	merges: number;
	reviewSpend: Spend;
}

/** The issue the gate opens. The caller appends the proposal marker. */
export function proposalBody(input: ProposalBodyInput): string {
	const { finding, review } = input;
	const others = review.findings.filter((f) => f.id !== finding.id).slice(0, MAX_OTHER_FINDINGS);
	const sections = [
		`The refactor gate opened after the last ${input.merges} merges, and the refactoring skill reviewed them as one change. It recommends one refactor.`,
		`## Why now\n\n${input.brief.map((line) => `${line.match(/^\s*/)?.[0] ?? ""}${sanitizeInline(line)}`).join("\n")}`,
		findingSection(finding),
		...(others.length > 0 ? [`## Other findings\n\n${others.map(otherLine).join("\n")}`] : []),
		[
			"## Decide",
			"",
			`- Add \`${config.labels.refactorApproved}\` to apply it behind a replay of the current behavior and open a draft PR.`,
			`- Add \`${config.labels.refactorRejected}\` to drop it. The skill won't propose it again.`,
		].join("\n"),
	];
	return fitAround("", sections.join("\n\n"), `\n\n---\n\n_${sanitizeInline(spendLine(input.reviewSpend))}_`, BODY_MAX_CHARS);
}

export interface RefactorReviewBodyInput {
	review: RefactorReview;
	baseRef: string;
}

/** The comment a refactor review posts on a pull request. The caller appends its marker. */
export function refactorReviewBody({ review, baseRef }: RefactorReviewBodyInput): string {
	const actionable = review.findings.filter((f) => f.when === "now" || f.when === "next-change");
	const waiting = review.findings.filter((f) => !actionable.includes(f));
	const sections = [
		`## Refactoring review\n\n${sanitize(review.summary)}`,
		...actionable.map(findingSection),
		...(waiting.length > 0 ? [`## Not now\n\n${waiting.map(otherLine).join("\n")}`] : []),
	];
	if (review.findings.length === 0) sections.push("Nothing here is worth changing now.");
	const scope = `Reviewed the change since ${codeSpan(baseRef.slice(0, 12))}${review.static_only ? " without running the project's tests" : ""}.`;
	return fitAround("", sections.join("\n\n"), `\n\n---\n\n_${scope} This review changes nothing; it is one input to your review._`, BODY_MAX_CHARS);
}

export interface RefactorPullBodyInput {
	issue: number;
	finding: RefactorFinding;
	application: RefactorApplication;
	replayCases: number;
	verification: readonly VerifyResult[];
	spend: Spend;
}

export function refactorPullBody(input: RefactorPullBodyInput): string {
	const { finding, application } = input;
	const sections = [
		`## Summary\n\n${sanitize(application.summary)}`,
		...(application.expectedBenefit ? [`## The next change\n\n${sanitize(application.expectedBenefit)}`] : []),
		findingSection(finding),
		[
			"## Behavior",
			"",
			`A replay of ${input.replayCases} cases, recorded before the refactor by a separate agent the applier never saw, printed the same output after it.`,
		].join("\n"),
		`## Verification\n\n${verificationTable(input.verification)}`,
	];
	return fitAround(
		`Closes #${input.issue}.\n\n`,
		sections.join("\n\n"),
		`\n\n---\n\n_${sanitizeInline(spendLine(input.spend))} Opened as a draft by the factory. Review it before marking it ready._`,
		BODY_MAX_CHARS,
	);
}

function findingSection(finding: RefactorFinding): string {
	const sites = finding.sites.map((site) => `- ${codeSpan(site.symbol ? `${site.path}#${site.symbol}` : site.path)}`).join("\n");
	const facts = [
		["Smell", finding.primary],
		["Severity", finding.severity],
		["Confidence", finding.confidence],
		["Effort", finding.effort],
		["Risk", finding.risk],
		["When", finding.when],
	]
		.map(([name, value]) => `| ${name} | ${escapeCell(sanitizeInline(value ?? ""))} |`)
		.join("\n");
	const plan = finding.plan.map((step, index) => {
		const note = step.note ? `: ${sanitizeInline(step.note)}` : "";
		return `${index + 1}. ${sanitizeInline(step.refactor)} (${step.direction}, ${step.behavior})${note}`;
	});
	return [
		`## ${sanitizeInline(finding.title)}`,
		"",
		"| | |\n| --- | --- |",
		facts,
		"",
		`**Where**\n\n${sites}`,
		...(finding.case_for ? ["", `**The case for**\n\n${truncate(sanitize(finding.case_for), 2000)}`] : []),
		...(finding.case_against ? ["", `**The case against**\n\n${truncate(sanitize(finding.case_against), 2000)}`] : []),
		...(plan.length > 0 ? ["", `**Plan**\n\n${plan.join("\n")}`] : []),
	].join("\n");
}

const otherLine = (finding: RefactorFinding): string =>
	`- ${sanitizeInline(finding.title)} (${finding.when}, severity ${finding.severity}): ${codeSpan(finding.sites[0]?.path ?? "")}`;
