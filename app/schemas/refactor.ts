import { z } from "zod";

const RefactorPlanStep = z.strictObject({
	refactor: z.string().min(1).max(80),
	direction: z.enum(["remove", "reshape", "add", "test", "safety"]),
	behavior: z.enum(["preserving", "changes-failure-paths", "changes-behavior"]),
	note: z.string().max(1000).default(""),
});

/** One finding in the refactoring skill's findings.json shape. */
export const RefactorFinding = z.strictObject({
	id: z.string().min(1).max(40),
	fingerprint: z.string().min(1).max(300),
	title: z.string().min(1).max(300),
	primary: z.string().min(1).max(80),
	sites: z
		.array(z.strictObject({ path: z.string().min(1).max(300), symbol: z.string().max(200).default("") }))
		.min(1)
		.max(10),
	symptom: z.string().max(80).default(""),
	case_for: z.string().max(1500).default(""),
	case_against: z.string().max(1500).default(""),
	severity: z.enum(["low", "medium", "high"]),
	confidence: z.enum(["low", "medium", "high"]),
	effort: z.enum(["S", "M", "L"]),
	when: z.enum(["now", "next-change", "later", "never"]),
	risk: z.enum(["low", "medium", "high"]),
	plan: z.array(RefactorPlanStep).max(8),
});

/** A review by the refactoring skill: its headline and ranked findings. */
export const RefactorReview = z.strictObject({
	summary: z.string().min(1).max(4000),
	static_only: z.boolean(),
	findings: z.array(RefactorFinding).max(10),
});

/** What the applier did with one finding. Git and the verify commands are authoritative; these are its notes. */
export const RefactorApplication = z.strictObject({
	applied: z.boolean(),
	summary: z.string().min(1).max(4000),
	changedPaths: z.array(z.string().min(1).max(500)).max(200).default([]),
	testsRun: z.array(z.string().min(1).max(1000)).max(50).default([]),
	expectedBenefit: z.string().max(2000).default(""),
});

/** The replay the guard records before a refactor and compares after it. */
export const ReplayTrace = z.strictObject({
	summary: z.string().min(1).max(2000),
	/** Runs the replay from the repository root and prints one JSON line per case. */
	command: z.string().min(1).max(500),
});

export type RefactorFinding = z.infer<typeof RefactorFinding>;
export type RefactorReview = z.infer<typeof RefactorReview>;
export type RefactorApplication = z.infer<typeof RefactorApplication>;
export type ReplayTrace = z.infer<typeof ReplayTrace>;
