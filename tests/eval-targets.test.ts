import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { afterAll, describe, expect, it } from "vitest";
import { cumulativeHiddenTest, cumulativePublicTest, TARGETS } from "../eval/targets/index.js";

const exec = promisify(execFile);
const roots: string[] = [];

afterAll(async () => {
	await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })));
});

describe("greenfield target seeds", () => {
	it("all pass their public step-zero checks", { timeout: 30_000 }, async () => {
		for (const target of TARGETS) {
			const root = await mkdtemp(join(tmpdir(), `refactor-eval-${target.id}-`));
			roots.push(root);
			for (const [path, contents] of Object.entries(target.files)) {
				await mkdir(dirname(join(root, path)), { recursive: true });
				await writeFile(join(root, path), contents);
			}
			const result = await exec(process.execPath, ["--experimental-strip-types", "--test", "tests/*.test.ts"], {
				cwd: root,
				shell: true,
			});
			expect(result.stderr, target.id).toBe("");
			expect(result.stdout, target.id).toMatch(/(?:# |ℹ )fail 0/);
		}
	});

	it("focused targets have explicit, satisfiable cumulative contracts", { timeout: 30_000 }, async () => {
		for (const target of TARGETS.filter((candidate) => candidate.referenceFiles)) {
			expect(target.steps.length).toBeGreaterThanOrEqual(10);
			expect(target.steps.every((step) => Boolean(step.publicTest))).toBe(true);
			const root = await mkdtemp(join(tmpdir(), `refactor-eval-reference-${target.id}-`));
			roots.push(root);
			for (const [path, contents] of Object.entries({ ...target.files, ...target.referenceFiles })) {
				await mkdir(dirname(join(root, path)), { recursive: true });
				await writeFile(join(root, path), contents);
			}
			await mkdir(join(root, "tests"), { recursive: true });
			for (let ordinal = 0; ordinal < target.steps.length; ordinal++) {
				await writeFile(join(root, "tests", "feature.test.ts"), cumulativePublicTest(target, ordinal) ?? "");
				await writeFile(join(root, "tests", "hidden.test.ts"), cumulativeHiddenTest(target, ordinal));
				const result = await exec(process.execPath, ["--experimental-strip-types", "--test", "tests/*.test.ts"], {
					cwd: root,
					shell: true,
				});
				expect(result.stderr, `${target.id} step ${ordinal + 1}`).toBe("");
				expect(result.stdout, `${target.id} step ${ordinal + 1}`).toMatch(/(?:# |ℹ )fail 0/);
			}
		}
	});
});
