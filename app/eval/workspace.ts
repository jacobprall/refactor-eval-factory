import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import type { EvalTarget } from "../../eval/targets/index.js";
import type { Sandbox } from "../sandbox/index.js";
import { shq } from "../sandbox/shell.js";
import { APP_DIR, REPO_DIR, RUN_AS, SCRATCH_DIR } from "../sandbox/types.js";

export const EVAL_WORKDIR = `${SCRATCH_DIR}/eval-worktree`;
const SKILL_PATH = fileURLToPath(new URL("../../eval/skills/refactoring/SKILL.md", import.meta.url));
export const TALK_SKILL_DIR = fileURLToPath(new URL("../../eval/skills/talk-refactoring/", import.meta.url));

/** `stub` is the short change-locality guide; `talk` is the full refactoring skill with its cards and recon script. */
export type EvalSkill = "stub" | "talk";

export async function talkSkillFiles(): Promise<Record<string, Buffer>> {
	const paths = (await readdir(TALK_SKILL_DIR, { recursive: true, withFileTypes: true }))
		.filter((entry) => entry.isFile() && !entry.name.startsWith(".") && !entry.parentPath.includes("__pycache__"))
		.map((entry) => relative(TALK_SKILL_DIR, join(entry.parentPath, entry.name)))
		.sort();
	return Object.fromEntries(await Promise.all(paths.map(async (path) => [path, await readFile(join(TALK_SKILL_DIR, path))] as const)));
}

export async function prepareEvalWorkspace(sandbox: Sandbox, target: EvalTarget, skill?: EvalSkill): Promise<void> {
	await sandbox.exec(`rm -rf ${shq(EVAL_WORKDIR)} && mkdir -p ${shq(EVAL_WORKDIR)} && chown ${RUN_AS}: ${shq(EVAL_WORKDIR)}`);
	for (const path of Object.keys(target.files)) {
		const parent = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
		if (parent) await sandbox.exec(`mkdir -p ${shq(`${EVAL_WORKDIR}/${parent}`)}`);
		await sandbox.upload(`${EVAL_WORKDIR}/${path}`, target.files[path]);
	}
	if (skill === "stub") {
		await sandbox.exec(`mkdir -p ${shq(`${EVAL_WORKDIR}/.eval-skill/refactoring`)}`);
		await sandbox.upload(`${EVAL_WORKDIR}/.eval-skill/refactoring/SKILL.md`, await readFile(SKILL_PATH));
	}
	if (skill === "talk") {
		for (const [path, contents] of Object.entries(await talkSkillFiles())) {
			const absolute = `${EVAL_WORKDIR}/.eval-skill/refactoring/${path}`;
			await sandbox.exec(`mkdir -p ${shq(absolute.slice(0, absolute.lastIndexOf("/")))}`);
			await sandbox.upload(absolute, contents);
		}
	}
	// The full skill stays out of git so its recon script never profiles its own code as part of the target.
	const exclude = skill === "talk" ? " && echo .eval-skill/ >> .git/info/exclude" : "";
	await sandbox.exec(
		[
			`chown -R ${RUN_AS}: ${shq(EVAL_WORKDIR)}`,
			`chown -R root:root ${shq(REPO_DIR)}`,
			`chmod -R go-rwx ${shq(REPO_DIR)}`,
			`chmod 711 ${shq(REPO_DIR)}`,
			`bash ${APP_DIR}/as-runner.sh bash -c ${shq(
				`cd ${EVAL_WORKDIR} && git init --quiet${exclude} && git config user.name eval-factory && git config user.email eval@localhost && git add . && git commit --quiet -m seed`,
			)}`,
		].join(" && "),
	);
}

export async function runInWorkspace(
	sandbox: Sandbox,
	command: string,
	timeoutMs = 10 * 60 * 1000,
): Promise<{ exitCode: number; stdout: string; stderr: string; durationMs: number }> {
	const started = Date.now();
	const result = await sandbox.exec(`cd ${shq(EVAL_WORKDIR)} && ${command}`, { asRunner: true, timeoutMs });
	return { ...result, durationMs: Date.now() - started };
}

export async function uploadHiddenTest(sandbox: Sandbox, contents: string): Promise<void> {
	await sandbox.upload(`${EVAL_WORKDIR}/tests/hidden.test.ts`, contents);
	await sandbox.exec(`chown ${RUN_AS}: ${shq(`${EVAL_WORKDIR}/tests/hidden.test.ts`)}`);
}

export async function uploadPublicFeatureTest(sandbox: Sandbox, contents: string): Promise<void> {
	await sandbox.upload(`${EVAL_WORKDIR}/tests/feature.test.ts`, contents);
	await sandbox.exec(`chown ${RUN_AS}: ${shq(`${EVAL_WORKDIR}/tests/feature.test.ts`)}`);
}

export async function removePublicFeatureTest(sandbox: Sandbox): Promise<void> {
	await sandbox.exec(`rm -f ${shq(`${EVAL_WORKDIR}/tests/feature.test.ts`)}`);
}

export async function removeHiddenTest(sandbox: Sandbox): Promise<void> {
	await sandbox.exec(`rm -f ${shq(`${EVAL_WORKDIR}/tests/hidden.test.ts`)}`);
}

const WorkspaceSources = z.record(z.string().max(500), z.string().max(1_000_000));

const READ_SOURCES = `
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const listed = execFileSync("git", ["ls-files", "-co", "--exclude-standard", "--", "src", "app", "lib"], { encoding: "utf8" });
const files = listed.split("\\n").filter((path) => /\\.[cm]?[jt]sx?$/.test(path) && fs.existsSync(path));
console.log(JSON.stringify(Object.fromEntries(files.map((path) => [path, fs.readFileSync(path, "utf8")]))));
`.trim();

/** Tracked and untracked source files under the conventional production roots, as the working tree holds them now. */
export async function readWorkspaceSources(sandbox: Sandbox): Promise<Record<string, string>> {
	const result = await runInWorkspace(sandbox, `node -e ${shq(READ_SOURCES)}`);
	if (result.exitCode !== 0) throw new Error(`failed to read workspace sources: ${(result.stderr || result.stdout).slice(-2000)}`);
	return WorkspaceSources.parse(JSON.parse(result.stdout));
}

export async function readWorkspaceFile(sandbox: Sandbox, path: string): Promise<string | undefined> {
	const result = await runInWorkspace(sandbox, `test -f ${shq(path)} && cat ${shq(path)}`);
	return result.exitCode === 0 ? result.stdout : undefined;
}

export async function uploadWorkspaceFile(sandbox: Sandbox, path: string, contents: string): Promise<void> {
	const absolute = `${EVAL_WORKDIR}/${path}`;
	await sandbox.exec(`mkdir -p ${shq(absolute.slice(0, absolute.lastIndexOf("/")))}`);
	await sandbox.upload(absolute, contents);
	await sandbox.exec(`chown -R ${RUN_AS}: ${shq(absolute.slice(0, absolute.lastIndexOf("/")))}`);
}
