/** Prices the factory's merged changes from the spend markers on its PRs, and compares changes before and after each refactor. */
import { z } from "zod";
import { parseMarker, type SpendMarker } from "../../app/github/index.js";

const RawPull = z.object({
	number: z.number().int().positive(),
	title: z.string(),
	body: z.string().nullable(),
	user: z.object({ login: z.string() }).nullable(),
	merged_at: z.string().nullable(),
	html_url: z.string(),
});
const RawFile = z.object({ filename: z.string() });

export interface PricedChange {
	number: number;
	title: string;
	url: string;
	mergedAt: string;
	spend: SpendMarker;
	files: string[];
}

export interface PullSource {
	closedPulls(): Promise<unknown[]>;
	pullFiles(number: number): Promise<unknown[]>;
}

/** Merged PRs the App's bot opened with a spend marker, oldest first. Anyone can paste a marker, so only the bot's PRs count. */
export async function loadPricedChanges(source: PullSource, botLogin: string): Promise<PricedChange[]> {
	const pulls = z.array(RawPull).parse(await source.closedPulls());
	const priced = pulls.flatMap((pull) => {
		const spend = pull.merged_at && pull.user?.login.toLowerCase() === botLogin.toLowerCase() ? parseMarker(pull.body ?? "", "spend") : null;
		return spend && pull.merged_at ? [{ pull, spend, mergedAt: pull.merged_at }] : [];
	});
	const changes: PricedChange[] = [];
	for (const { pull, spend, mergedAt } of priced) {
		const files = z.array(RawFile).parse(await source.pullFiles(pull.number)).map((file) => file.filename);
		changes.push({ number: pull.number, title: pull.title, url: pull.html_url, mergedAt, spend, files });
	}
	return changes.sort((a, b) => a.mergedAt.localeCompare(b.mergedAt));
}

const TEST_FILE = /(?:^|\/)(?:tests?|__tests__|spec|fixtures)\/|\.(?:test|spec)\.[cm]?[jt]sx?$/;

export interface RefactorPayback {
	refactor: PricedChange;
	/** What deciding on and applying the refactor cost. */
	investmentUsd: number;
	before: { changes: number; meanUsd: number | null };
	after: { changes: number; meanUsd: number | null };
	/** Changes after the refactor needed to repay it at the observed difference; null when changes didn't get cheaper. */
	breakEvenChanges: number | null;
	/** Saved so far, net of the investment. Null until there are changes on both sides. */
	netUsd: number | null;
}

/**
 * For each refactor, the factory's feature changes that touched its production files, before and after it merged.
 * The two sides are different changes, so the comparison is only as fair as the changes are alike.
 */
export function refactorPayback(changes: readonly PricedChange[]): RefactorPayback[] {
	const features = changes.filter((change) => change.spend.kind === "feature");
	return changes
		.filter((change) => change.spend.kind === "refactor")
		.map((refactor) => {
			const files = new Set(refactor.files.filter((path) => !TEST_FILE.test(path)));
			const touching = features.filter((change) => change.files.some((path) => files.has(path)));
			const before = summarize(touching.filter((change) => change.mergedAt < refactor.mergedAt));
			const after = summarize(touching.filter((change) => change.mergedAt > refactor.mergedAt));
			const investmentUsd = refactor.spend.costUsd + (refactor.spend.decisionUsd ?? 0);
			const saved = before.meanUsd !== null && after.meanUsd !== null ? before.meanUsd - after.meanUsd : null;
			return {
				refactor,
				investmentUsd,
				before,
				after,
				breakEvenChanges: saved !== null && saved > 0 ? investmentUsd / saved : null,
				netUsd: saved === null ? null : saved * after.changes - investmentUsd,
			};
		});
}

function summarize(changes: readonly PricedChange[]): { changes: number; meanUsd: number | null } {
	if (changes.length === 0) return { changes: 0, meanUsd: null };
	return { changes: changes.length, meanUsd: changes.reduce((sum, change) => sum + change.spend.costUsd, 0) / changes.length };
}

const usd = (value: number | null) => (value === null ? "—" : `$${value.toFixed(2)}`);

export function renderReport(repo: string, changes: readonly PricedChange[], paybacks: readonly RefactorPayback[]): string {
	const features = changes.filter((change) => change.spend.kind === "feature");
	const total = features.reduce((sum, change) => sum + change.spend.costUsd, 0);
	const lines = [
		`# Cost of change in ${repo}`,
		"",
		`${features.length} merged feature PRs from the factory, ${usd(total)} in agent spend, ${usd(features.length ? total / features.length : null)} per change.`,
		"",
	];
	if (paybacks.length === 0) return [...lines, "No factory refactor has merged yet."].join("\n");
	lines.push(
		"| Refactor | Investment | Changes before | Mean before | Changes after | Mean after | Break-even changes | Net so far |",
		"| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
		...paybacks.map((p) =>
			[
				`[#${p.refactor.number}](${p.refactor.url})`,
				usd(p.investmentUsd),
				p.before.changes,
				usd(p.before.meanUsd),
				p.after.changes,
				usd(p.after.meanUsd),
				p.breakEvenChanges === null ? "—" : p.breakEvenChanges.toFixed(1),
				usd(p.netUsd),
			].join(" | "),
		).map((row) => `| ${row} |`),
		"",
		"Each row compares the factory's feature changes that touched the refactor's production files before and after it merged. They are different changes, so read a difference as evidence only when the changes are alike.",
	);
	return lines.join("\n");
}
