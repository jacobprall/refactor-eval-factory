import { createHash } from "node:crypto";

export interface EvalStep {
	id: string;
	title: string;
	prompt: string;
	/** Current-feature acceptance test exposed before the agent runs. */
	publicTest?: string;
	/** Node test body appended to the cumulative hidden test after this step. */
	hiddenTest: string;
}

export interface EvalTarget {
	id:
		| "subscription-billing"
		| "inventory-reservations"
		| "approval-workflows"
		| "notification-routing"
		| "access-control"
		| "event-scheduling"
		| "usage-metering"
		| "commerce-monolith"
		| "commerce-monolith-elsewhere"
		| "commerce-monolith-clean";
	title: string;
	files: Readonly<Record<string, string>>;
	/** Complete known-good implementation used only by local contract tests; never uploaded to an evaluation workspace. */
	referenceFiles?: Readonly<Record<string, string>>;
	steps: readonly EvalStep[];
	publicVerify: readonly string[];
}

export type TargetId = EvalTarget["id"];

export function seedFiles(name: string, source: string, publicTests: string): Readonly<Record<string, string>> {
	return {
		"package.json": `${JSON.stringify(
			{
				name: `eval-${name}`,
				version: "1.0.0",
				private: true,
				type: "module",
				scripts: {
					test: "node --experimental-strip-types --test tests/*.test.ts",
					check: "npm test",
				},
			},
			null,
			2,
		)}\n`,
		"src/index.ts": source,
		"tests/public.test.ts": publicTests,
		"README.md": "# Evaluation target\n\nImplement only the requirement supplied for the current iteration. Run `npm test` before finishing.\n",
	};
}

export function cumulativeHiddenTest(target: EvalTarget, through: number): string {
	const bodies = target.steps.slice(0, through + 1).map((step) => `// ${step.id}: ${step.title}\n${step.hiddenTest.trim()}`);
	return `import test from "node:test";\nimport assert from "node:assert/strict";\nimport * as subject from "../src/index.ts";\n\n${bodies.join("\n\n")}\n`;
}

export function cumulativePublicTest(target: EvalTarget, through: number): string | undefined {
	const bodies = target.steps
		.slice(0, through + 1)
		.filter((step): step is EvalStep & { publicTest: string } => Boolean(step.publicTest))
		.map((step) => `// ${step.id}: ${step.title}\n${step.publicTest.trim()}`);
	if (bodies.length === 0) return undefined;
	return `import test from "node:test";\nimport assert from "node:assert/strict";\nimport * as subject from "../src/index.ts";\n\n${bodies.join("\n\n")}\n`;
}

export function targetHash(target: EvalTarget): string {
	return createHash("sha256")
		.update(JSON.stringify({ id: target.id, files: target.files, steps: target.steps, publicVerify: target.publicVerify }))
		.digest("hex");
}
