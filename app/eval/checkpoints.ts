import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { isProductionSource } from "./health.js";

/**
 * Rebuilds a trajectory's checkpoints offline by applying each iteration's stored patch, in order, to the target seed.
 * Returns the production sources after each iteration; it stops at the first patch that no longer applies (patches are
 * stored truncated past 200 KB), so later checkpoints are simply missing.
 */
export function rebuildCheckpoints(seed: Readonly<Record<string, string>>, patches: readonly string[]): Record<string, string>[] {
	const dir = mkdtempSync(join(tmpdir(), "eval-checkpoint-"));
	try {
		for (const [path, contents] of Object.entries(seed)) {
			mkdirSync(dirname(join(dir, path)), { recursive: true });
			writeFileSync(join(dir, path), contents);
		}
		const checkpoints: Record<string, string>[] = [];
		for (const patch of patches) {
			if (patch.trim()) {
				try {
					execFileSync("git", ["apply", "--whitespace=nowarn", "-"], { cwd: dir, input: `${patch}\n`, stdio: ["pipe", "ignore", "pipe"] });
				} catch {
					break;
				}
			}
			checkpoints.push(productionSources(dir));
		}
		return checkpoints;
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

function productionSources(dir: string): Record<string, string> {
	const files: Record<string, string> = {};
	const walk = (path: string) => {
		for (const name of readdirSync(path)) {
			const full = join(path, name);
			if (statSync(full).isDirectory()) walk(full);
			else if (isProductionSource(relative(dir, full))) files[relative(dir, full)] = readFileSync(full, "utf8");
		}
	};
	walk(dir);
	return files;
}
