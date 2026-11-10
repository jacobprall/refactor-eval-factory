import { randomUUID } from "node:crypto";
import { REPO_DIR, RUN_AS, type Sandbox, SCRATCH_DIR, shq } from "../sandbox/index.js";
import { discardChanges } from "./workspace.js";

/** Where the replay author writes; nothing else in the checkout may change while it works. */
export const TRACE_DIR = ".refactor-trace";
const RUN_TIMEOUT_MS = 5 * 60 * 1000;
const MAX_OUTPUT_BYTES = 20_000_000;

export type RecordedReplay =
	| { status: "recorded"; command: string; cases: number; output: string; stash: string }
	/** Why no replay could be recorded. Internal: it can quote repository output. */
	| { status: "unavailable"; reason: string };

export type ReplayResult =
	| { status: "passed"; cases: number }
	| { status: "diverged"; cases: number; line: number }
	| { status: "failed"; cases: number; exitCode: number };

/**
 * Runs the author's replay twice on the unchanged code and, if it is deterministic, moves it into a root-only
 * directory. The applier runs as the runner user, so it can't read or edit the replay that grades it. Anything
 * else the author changed is discarded.
 */
export async function recordReplay(sandbox: Sandbox, command: string): Promise<RecordedReplay> {
	try {
		const present = await sandbox.exec(`test -d ${TRACE_DIR}`, { asRunner: true });
		if (present.exitCode !== 0) return { status: "unavailable", reason: `the replay author wrote nothing under ${TRACE_DIR}/` };
		const first = await runReplay(sandbox, command);
		if (first.exitCode !== 0) return { status: "unavailable", reason: `the replay exited ${first.exitCode} on the unchanged code` };
		const second = await runReplay(sandbox, command);
		if (second.exitCode !== 0 || second.output !== first.output) return { status: "unavailable", reason: "the replay's output was not deterministic" };
		const cases = countCases(first.output);
		if (cases === 0) return { status: "unavailable", reason: "the replay printed no cases" };
		const stash = `/tmp/factory-replay-${randomUUID()}`;
		await check(sandbox, `mkdir -m 700 ${stash} && mv ${REPO_DIR}/${TRACE_DIR} ${stash}/trace && chown -R root:root ${stash}`);
		return { status: "recorded", command, cases, output: first.output, stash };
	} finally {
		await sandbox.exec(`rm -rf ${REPO_DIR}/${TRACE_DIR}`).catch(() => undefined);
		await discardChanges(sandbox);
	}
}

/** Puts the replay back, runs it on the refactored code, and removes it again. A changed line is a change in behavior. */
export async function compareReplay(sandbox: Sandbox, recorded: Extract<RecordedReplay, { status: "recorded" }>): Promise<ReplayResult> {
	const trace = `${REPO_DIR}/${TRACE_DIR}`;
	try {
		await check(sandbox, `rm -rf ${trace} && cp -R ${recorded.stash}/trace ${trace} && chown -R ${RUN_AS}: ${trace}`);
		const after = await runReplay(sandbox, recorded.command);
		if (after.exitCode !== 0) return { status: "failed", cases: recorded.cases, exitCode: after.exitCode };
		if (after.output === recorded.output) return { status: "passed", cases: recorded.cases };
		return { status: "diverged", cases: recorded.cases, line: firstDifference(recorded.output, after.output) };
	} finally {
		await sandbox.exec(`rm -rf ${trace} ${recorded.stash}`).catch(() => undefined);
	}
}

/** stdout goes to a file the host downloads: exec keeps only the end of a command's output. */
async function runReplay(sandbox: Sandbox, command: string): Promise<{ exitCode: number; output: string }> {
	const out = `${SCRATCH_DIR}/replay-${randomUUID()}.out`;
	try {
		const res = await sandbox.exec(`( ${command} ) > ${shq(out)} 2>/dev/null`, { asRunner: true, timeoutMs: RUN_TIMEOUT_MS });
		if (res.exitCode !== 0) return { exitCode: res.exitCode, output: "" };
		const bytes = await sandbox.download(out);
		if (bytes.length > MAX_OUTPUT_BYTES) return { exitCode: 1, output: "" };
		return { exitCode: 0, output: canonical(bytes.toString("utf8")) };
	} finally {
		await sandbox.exec(`rm -f ${shq(out)}`).catch(() => undefined);
	}
}

/** Each JSON line re-serialized with sorted keys, so reordering an object's fields isn't a change in behavior. */
function canonical(stdout: string): string {
	return stdout
		.split("\n")
		.map((line) => {
			try {
				return JSON.stringify(sortKeys(JSON.parse(line)));
			} catch {
				return line;
			}
		})
		.join("\n");
}

function sortKeys(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(sortKeys);
	if (value === null || typeof value !== "object") return value;
	return Object.fromEntries(
		Object.keys(value)
			.sort()
			.map((key) => [key, sortKeys((value as Record<string, unknown>)[key])]),
	);
}

const countCases = (output: string): number => output.split("\n").filter((line) => line.trim() !== "").length;

function firstDifference(expected: string, actual: string): number {
	const a = expected.split("\n");
	const b = actual.split("\n");
	let line = 0;
	while (line < Math.max(a.length, b.length) && a[line] === b[line]) line++;
	return line + 1;
}

async function check(sandbox: Sandbox, command: string): Promise<void> {
	const res = await sandbox.exec(command);
	if (res.exitCode !== 0) throw new Error(`sandbox command exited ${res.exitCode}: ${(res.stderr || res.stdout).trim().slice(-500)}`);
}
