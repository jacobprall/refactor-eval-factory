import { randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { create as createTar } from "tar";
import { z } from "zod";
import { RUN_AS, type Sandbox, SANDBOX_ROOT, SCRATCH_DIR, shq } from "../sandbox/index.js";
import { SIGNAL_WINDOW } from "./signals.js";

const SKILL_SOURCE = fileURLToPath(new URL("../../skills/refactoring/", import.meta.url));
const HISTORY_SCRIPT = fileURLToPath(new URL("../../sandbox/read-history.mjs", import.meta.url));
/** Outside the checkout and root-owned, so nothing an agent reads from the skill can be published or edited. */
const SKILL_DIR = `${SANDBOX_ROOT}/skills/refactoring`;
/** The skill's working directory; it may hold the ledger, so it is reset to the commit's state before publishing. */
export const SKILL_OUTPUT = ".refactor";

const SHA = z.string().regex(/^[0-9a-f]{40}$/);
const Sources = z.record(z.string().max(500), z.string().max(1_000_000));
const HistoryFile = z.union([
	z.object({ insufficient: z.number().int().min(0) }),
	z.object({
		head: SHA,
		windowBase: SHA,
		merges: z.array(z.array(z.string().min(1).max(500)).max(10_000)).length(SIGNAL_WINDOW + 1),
		snapshots: z.object({ head: Sources, previous: Sources, windowBase: Sources, previousWindowBase: Sources }),
	}),
]);

export type History = Exclude<z.infer<typeof HistoryFile>, { insufficient: number }>;

/**
 * The last SIGNAL_WINDOW + 1 merges on the checked-out branch and the production sources at the ends of the window
 * ending at HEAD and the one ending a merge earlier, or null without enough history.
 */
export async function readHistory(sandbox: Sandbox, sourceDirs: readonly string[]): Promise<History | null> {
	const dir = `/tmp/factory-history-${randomUUID()}`;
	const out = `${SCRATCH_DIR}/history-${randomUUID()}.json`;
	await check(sandbox, `mkdir -m 755 ${dir}`);
	try {
		await sandbox.upload(`${dir}/read-history.mjs`, await readFile(HISTORY_SCRIPT));
		await check(sandbox, ["node", `${dir}/read-history.mjs`, out, String(SIGNAL_WINDOW), ...sourceDirs].map(shq).join(" "), true);
		const parsed = HistoryFile.parse(JSON.parse((await sandbox.download(out)).toString("utf8")));
		return "insufficient" in parsed ? null : parsed;
	} finally {
		await sandbox.exec(`rm -rf ${dir} ${shq(out)}`).catch(() => undefined);
	}
}

/** Installs the refactoring skill, read-only, where the refactor agents' prompts point. */
export async function installSkill(sandbox: Sandbox): Promise<void> {
	const archive = `/tmp/factory-skill-${randomUUID()}.tgz`;
	await sandbox.upload(archive, await skillArchive());
	await check(
		sandbox,
		[
			`rm -rf ${SKILL_DIR}`,
			`mkdir -p ${SKILL_DIR}`,
			`tar -xzf ${archive} -C ${SKILL_DIR}`,
			`rm -f ${archive}`,
			`chown -R root:root ${SANDBOX_ROOT}/skills`,
			`chmod -R a+rX,go-w ${SANDBOX_ROOT}/skills`,
		].join(" && "),
	);
}

async function skillArchive(): Promise<Buffer> {
	const files = (await readdir(SKILL_SOURCE, { recursive: true, withFileTypes: true }))
		.filter((entry) => entry.isFile() && !entry.name.startsWith(".") && !entry.parentPath.includes("__pycache__"))
		.map((entry) => relative(SKILL_SOURCE, join(entry.parentPath, entry.name)))
		.sort();
	const chunks: Buffer[] = [];
	for await (const chunk of createTar({ cwd: SKILL_SOURCE, portable: true, gzip: true }, files)) chunks.push(chunk as Buffer);
	return Buffer.concat(chunks);
}

export interface LedgerEntry {
	fingerprint: string;
	reason: string;
	at: string;
}

/** Appends people's rejections to the skill's ledger in the checkout, where its reduce step reads them. */
export async function writeLedger(sandbox: Sandbox, rejected: readonly LedgerEntry[]): Promise<void> {
	if (rejected.length === 0) return;
	const lines = rejected.map((entry) =>
		JSON.stringify({ fingerprint: entry.fingerprint, decision: "rejected", at: entry.at.slice(0, 10), by: "user", reason: entry.reason }),
	);
	const staged = `/tmp/factory-ledger-${randomUUID()}.jsonl`;
	await sandbox.upload(staged, `${lines.join("\n")}\n`);
	await check(sandbox, `chown ${RUN_AS}: ${staged}`);
	await check(sandbox, `mkdir -p ${SKILL_OUTPUT} && cat ${staged} >> ${SKILL_OUTPUT}/ledger.jsonl`, true);
	await sandbox.exec(`rm -f ${staged}`).catch(() => undefined);
}

/**
 * Returns the checkout to HEAD. Ignored files stay, because installed dependencies are ignored; the skill writes a
 * .gitignore that hides its own files, so its directory is reset explicitly.
 */
export async function discardChanges(sandbox: Sandbox): Promise<void> {
	await check(sandbox, "git reset --hard --quiet HEAD && git clean -fdq", true);
	await resetSkillOutput(sandbox);
}

/** Puts the skill's working directory back as the commit has it, so its files never reach a published change. */
export async function resetSkillOutput(sandbox: Sandbox): Promise<void> {
	await check(sandbox, `rm -rf ${SKILL_OUTPUT} && (git checkout --quiet HEAD -- ${SKILL_OUTPUT} 2>/dev/null || true)`, true);
}

async function check(sandbox: Sandbox, command: string, asRunner = false): Promise<string> {
	const res = await sandbox.exec(command, { asRunner, timeoutMs: 10 * 60 * 1000 });
	if (res.exitCode !== 0) throw new Error(`sandbox command exited ${res.exitCode}: ${(res.stderr || res.stdout).trim().slice(-500)}`);
	return res.stdout;
}
