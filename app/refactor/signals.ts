import { analyzeHealth, COGNITIVE_LIMIT, type FileHealth, type FunctionComplexity, HEALTH_BAR, type LineRange } from "./health.js";

/**
 * Three questions, one signal each, all read from code and change history. Health: is it hard to change? Heat: do we
 * change it often? Coupling: does changing it drag something else along? The signals say when and where to look; they
 * never say what to change. Thresholds were fixed before any evaluation compared them with outcomes.
 */
export const SIGNAL_WINDOW = 4;
/** A hot file changed in this many of the last SIGNAL_WINDOW merges. */
const HOT_TOUCHES = 3;
/** A coupled cluster all changed in this many of the last SIGNAL_WINDOW merges. */
const COUPLING_MIN_SHARED = 3;
/** Barrels and type modules change with almost every merge without carrying logic. */
const COUPLING_IGNORED = /(?:^|\/)(?:index|types)\.[cm]?[jt]sx?$|\.d\.ts$/;
const MAX_BRIEFED_FUNCTIONS = 5;

export interface HotspotSignal {
	path: string;
	health: number;
	healthAtWindowStart: number;
	/** How many of the last SIGNAL_WINDOW merges changed it. */
	changedIn: number;
	/** Functions above the cognitive-complexity limit, most complex first. */
	complexFunctions: FunctionComplexity[];
	copiedRanges: LineRange[];
}

export interface GateReading {
	open: boolean;
	hotspots: HotspotSignal[];
	/** Files in two or more directories that some COUPLING_MIN_SHARED of the last SIGNAL_WINDOW merges all changed. */
	coupling?: string[];
	/** Health of the code the window's merges changed, weighted by size times how often. */
	healthWhereWorkIs: number;
}

export interface GateHistory {
	/** Production paths each of the last SIGNAL_WINDOW + 1 merges changed, oldest first. */
	merges: readonly (readonly string[])[];
	snapshots: Record<"head" | "previous" | "windowBase" | "previousWindowBase", Readonly<Record<string, string>>>;
}

/**
 * The gate fires on the merge where a problem forms: when the window ending at HEAD shows a hotspot or coupled
 * cluster that the window ending one merge earlier didn't. A problem that persists, whether the review declined it
 * or a person rejected it, doesn't cost another review on every merge.
 */
export function gateFires(history: GateHistory): { fires: boolean; reading: GateReading } {
	const { merges, snapshots } = history;
	const reading = readGate(snapshots.head, snapshots.windowBase, merges.slice(1));
	if (!reading.open) return { fires: false, reading };
	const before = readGate(snapshots.previous, snapshots.previousWindowBase, merges.slice(0, SIGNAL_WINDOW));
	const earlier = new Set(triggers(before));
	return { fires: triggers(reading).some((trigger) => !earlier.has(trigger)), reading };
}

const triggers = (reading: GateReading): string[] => [
	...reading.hotspots.map((hot) => `hot:${hot.path}`),
	...(reading.coupling ? [`coupled:${reading.coupling.join(",")}`] : []),
];

/**
 * Reads the gate. `merges` lists the production paths each of the last SIGNAL_WINDOW merges changed, oldest first;
 * `sources` and `windowStartSources` hold production code at the newest merge and just before the oldest one.
 * The gate opens on a hot file that is below the health bar and got less healthy, or on a coupled cluster.
 */
function readGate(
	sources: Readonly<Record<string, string>>,
	windowStartSources: Readonly<Record<string, string>>,
	merges: readonly (readonly string[])[],
): GateReading {
	const current = analyzeHealth(sources, merges);
	const before = analyzeHealth(windowStartSources);
	const hotspots = decayingHotspots(merges, current.files, before.files);
	const coupling = couplingCluster(merges);
	return {
		open: hotspots.length > 0 || coupling !== undefined,
		hotspots,
		...(coupling ? { coupling } : {}),
		healthWhereWorkIs: current.healthWhereWorkIs,
	};
}

/**
 * The largest set of files, spanning at least two directories, that some COUPLING_MIN_SHARED of the last
 * SIGNAL_WINDOW merges all changed. Requiring every file to change in the same merges keeps a file that changes
 * with everything from chaining unrelated work into one cluster.
 */
function couplingCluster(merges: readonly (readonly string[])[]): string[] | undefined {
	const window = merges.slice(-SIGNAL_WINDOW);
	if (window.length < SIGNAL_WINDOW) return undefined;
	const paths = window.map((changed) => changed.filter((path) => !COUPLING_IGNORED.test(path)));
	let best: string[] | undefined;
	for (let skip = 0; skip < SIGNAL_WINDOW; skip++) {
		const chosen = paths.filter((_, index) => index !== skip).slice(0, COUPLING_MIN_SHARED);
		const shared = chosen.reduce((common, files) => common.filter((path) => files.includes(path)), chosen[0] ?? []).sort();
		const directories = new Set(shared.map((path) => path.slice(0, Math.max(0, path.lastIndexOf("/")))));
		if (directories.size >= 2 && (!best || shared.length > best.length)) best = shared;
	}
	return best;
}

/**
 * Hot files that are hard to change and got harder: changed in HOT_TOUCHES of the window's merges, below the bar,
 * and less healthy than at the window's start. Nonexistent code is perfectly healthy, so a file created during the
 * window starts at 10.
 */
function decayingHotspots(merges: readonly (readonly string[])[], current: readonly FileHealth[], windowStart: readonly FileHealth[]): HotspotSignal[] {
	const touches = new Map<string, number>();
	for (const changed of merges.slice(-SIGNAL_WINDOW)) {
		for (const path of new Set(changed)) touches.set(path, (touches.get(path) ?? 0) + 1);
	}
	return [...touches.entries()]
		.filter(([, count]) => count >= HOT_TOUCHES)
		.flatMap(([path, changedIn]) => {
			const file = current.find((candidate) => candidate.path === path);
			const before = windowStart.find((candidate) => candidate.path === path)?.health ?? 10;
			if (!file || file.health >= HEALTH_BAR || file.health >= before) return [];
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

/** What the gate saw, in the words a reviewer reads. */
export function describeGate(reading: Pick<GateReading, "hotspots" | "coupling">): string[] {
	const lines = reading.hotspots.flatMap((hot) => [
		`- ${hot.path} is hard to change and often changed: health ${hot.health} (10 is best; ${HEALTH_BAR} is the bar), down from ${hot.healthAtWindowStart} ${SIGNAL_WINDOW} merges ago; changed in ${hot.changedIn} of the last ${SIGNAL_WINDOW} merges.`,
		...hot.complexFunctions.map((fn) => `  - ${fn.symbol} (line ${fn.line}): cognitive complexity ${fn.cognitive}; the limit is ${COGNITIVE_LIMIT}.`),
		...(hot.copiedRanges.length > 0
			? [
					`  - Lines ${hot.copiedRanges.map(({ from, to }) => (from === to ? `${from}` : `${from}–${to}`)).join(", ")} repeat code found elsewhere, after renaming.`,
				]
			: []),
	]);
	if (reading.coupling) {
		lines.push(`- These files all changed together in ${COUPLING_MIN_SHARED} of the last ${SIGNAL_WINDOW} merges: ${reading.coupling.join(", ")}.`);
	}
	return lines;
}
