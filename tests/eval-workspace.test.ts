import { describe, expect, it } from "vitest";
import { prepareEvalWorkspace } from "../app/eval/workspace.js";
import { TARGETS } from "../eval/targets/index.js";
import { FakeSandbox } from "./helpers/fake-sandbox.js";

describe("evaluation workspace", () => {
	it("uploads only seed files and locks the factory checkout away from the agent", async () => {
		const sandbox = new FakeSandbox({ jsonl: "" });
		await prepareEvalWorkspace(sandbox, TARGETS[0]);

		expect([...sandbox.uploads.keys()]).toEqual(
			expect.arrayContaining(Object.keys(TARGETS[0].files).map((path) => `/opt/factory/scratch/eval-worktree/${path}`)),
		);
		expect([...sandbox.uploads.keys()].some((path) => path.includes("hidden"))).toBe(false);
		expect([...sandbox.uploads.keys()].some((path) => path.includes(".eval-skill"))).toBe(false);
		expect(sandbox.execs.some(({ command }) => command.includes("chown -R root:root '/opt/factory/repo'"))).toBe(true);
	});

	it("uploads the refactoring skill only for skill scenarios", async () => {
		const sandbox = new FakeSandbox({ jsonl: "" });
		await prepareEvalWorkspace(sandbox, TARGETS[0], "stub");
		expect(sandbox.uploads.has("/opt/factory/scratch/eval-worktree/.eval-skill/refactoring/SKILL.md")).toBe(true);
	});

	it("uploads the full talk skill and keeps it out of git so its recon script never profiles itself", async () => {
		const sandbox = new FakeSandbox({ jsonl: "" });
		await prepareEvalWorkspace(sandbox, TARGETS[0], "talk");
		const skill = "/opt/factory/scratch/eval-worktree/.eval-skill/refactoring";
		for (const path of ["SKILL.md", "smells/reinvented-logic.md", "refactors/extract-function.md", "references/scoring.md", "scripts/recon.py"]) {
			expect(sandbox.uploads.has(`${skill}/${path}`), path).toBe(true);
		}
		const init = sandbox.execs.find(({ command }) => command.includes("git init"))?.command ?? "";
		expect(init.indexOf(".git/info/exclude")).toBeGreaterThan(-1);
		expect(init.indexOf(".git/info/exclude")).toBeLessThan(init.indexOf("git add ."));
	});
});
