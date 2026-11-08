import { AI_FRIENDLY_HEALTH } from "./health.js";
import { analyzeHealthV2, COGNITIVE_LIMIT, type FileHealthV2, type FunctionComplexity, type LineRange } from "./health-v2.js";
import type { FileChange } from "./trajectory.js";

/**
 * Three questions, one signal each, all read from code and change history. Health: is it hard to change? Heat: do we
 * change it often? Coupling: does changing it drag something else along? The signals say when and where to look; they
 * never say what to change.
 */
export const SIGNAL_WINDOW = 4;
/** A hot file changed in this many of the last SIGNAL_WINDOW features. */
export const HOT_TOUCHES = 3;
/** A coupled cluster all changed in this many of the last SIGNAL_WINDOW features. */
export const COUPLING_MIN_SHARED = 3;
/** Barrels and type modules change with almost every feature without carrying logic. */
const COUPLING_IGNORED = /(?:^|\/)(?:index|types)\.[cm]?[jt]sx?$|\.d\.ts$/;
const MAX_BRIEFED_FUNCTIONS = 5;

export interface SignalSnapshot {
	/** Health of all production code, weighted by file length. */
	health: number;
	/** Health weighted by size times heat: the code recent features actually changed. */
	healthWhereWorkIs: number;
	files: FileHealthV2[];
	/** Files in two or more directories that some COUPLING_MIN_SHARED of the last SIGNAL_WINDOW features all changed. */
	coupling?: string[];
}

/** `features` lists each completed feature's file changes, oldest first; heat and coupling read only production files. */
export function measureSignals(sources: Readonly<Record<string, string>>, features: readonly (readonly FileChange[])[]): SignalSnapshot {
	const v2 = analyzeHealthV2(sources, features.map(productionPaths));
	const coupling = couplingCluster(features);
	return { ...v2, ...(coupling ? { coupling } : {}) };
}

/**
 * The largest set of production files, spanning at least two directories, that some COUPLING_MIN_SHARED of the
 * last SIGNAL_WINDOW features all changed. Requiring every file to change in the same features keeps a file that
 * changes with everything from chaining unrelated work into one cluster.
 */
export function couplingCluster(features: readonly (readonly FileChange[])[]): string[] | undefined {
	const window = features.slice(-SIGNAL_WINDOW);
	if (window.length < SIGNAL_WINDOW) return undefined;
	const paths = window.map((changes) => productionPaths(changes).filter((path) => !COUPLING_IGNORED.test(path)));
	let best: string[] | undefined;
	for (let skip = 0; skip < SIGNAL_WINDOW; skip++) {
		const chosen = paths.filter((_, index) => index !== skip).slice(0, COUPLING_MIN_SHARED);
		const shared = chosen.reduce((common, files) => common.filter((path) => files.includes(path)), chosen[0] ?? []).sort();
		const directories = new Set(shared.map((path) => path.slice(0, Math.max(0, path.lastIndexOf("/")))));
		if (directories.size >= 2 && (!best || shared.length > best.length)) best = shared;
	}
	return best;
}

export interface HotspotSignal {
	path: string;
	health: number;
	healthAtWindowStart: number;
	/** How many of the last SIGNAL_WINDOW features changed it. */
	changedIn: number;
	/** Functions above the cognitive-complexity limit, most complex first. */
	complexFunctions: FunctionComplexity[];
	copiedRanges: LineRange[];
}

/**
 * Hot files that are hard to change and got harder: changed in HOT_TOUCHES of the `window` features, below the
 * AI-friendly bar, and less healthy than at the window's start. Nonexistent code is perfectly healthy, so a file
 * created during the window starts at 10.
 */
export function decayingHotspots(window: readonly (readonly FileChange[])[], current: SignalSnapshot, windowStart: SignalSnapshot): HotspotSignal[] {
	const touches = new Map<string, number>();
	for (const changes of window.slice(-SIGNAL_WINDOW)) {
		for (const path of productionPaths(changes)) touches.set(path, (touches.get(path) ?? 0) + 1);
	}
	return [...touches.entries()]
		.filter(([, count]) => count >= HOT_TOUCHES)
		.flatMap(([path, changedIn]) => {
			const file = current.files.find((candidate) => candidate.path === path);
			const before = windowStart.files.find((candidate) => candidate.path === path)?.health ?? 10;
			if (!file || file.health >= AI_FRIENDLY_HEALTH || file.health >= before) return [];
			return [
				{
					path,
					health: file.health,
					healthAtWindowStart: before,
					changedIn,
					complexFunctions: file.functions.filter((fn) => fn.cognitive > COGNITIVE_LIMIT).slice(0, MAX_BRIEFED_FUNCTIONS),
					copiedRanges: file.copiedRanges,
				},
			];
		})
		.sort((a, b) => a.health - b.health || a.path.localeCompare(b.path));
}

/** What the gate saw, in the words a refactorer or reviewer reads. */
export function describeSignals(hotspots: readonly HotspotSignal[] = [], cluster?: readonly string[]): string[] {
	const lines = hotspots.flatMap((hot) => [
		`- ${hot.path} is hard to change and often changed: health ${hot.health} (10 is best; 9.5 is the bar), down from ${hot.healthAtWindowStart} ${SIGNAL_WINDOW} features ago; changed in ${hot.changedIn} of the last ${SIGNAL_WINDOW} features.`,
		...hot.complexFunctions.map((fn) => `  - ${fn.symbol} (line ${fn.line}): cognitive complexity ${fn.cognitive}; the limit is ${COGNITIVE_LIMIT}.`),
		...(hot.copiedRanges.length > 0
			? [
					`  - Lines ${hot.copiedRanges.map(({ from, to }) => (from === to ? `${from}` : `${from}–${to}`)).join(", ")} repeat code found elsewhere, after renaming.`,
				]
			: []),
	]);
	if (cluster)
		lines.push(`- These files all changed together in ${COUPLING_MIN_SHARED} of the last ${SIGNAL_WINDOW} features: ${cluster.join(", ")}.`);
	return lines;
}

const productionPaths = (changes: readonly FileChange[]): string[] => [
	...new Set(changes.filter((change) => change.category === "production").map((change) => change.path)),
];
