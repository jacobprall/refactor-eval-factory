import { z } from "zod";

export const EvalImplementation = z.strictObject({
	summary: z.string().min(1).max(4000),
	// Git and the verifier are authoritative. These fields are useful agent notes, not a reason to discard a completed implementation.
	changedPaths: z.array(z.string().min(1).max(500)).max(200).default([]),
	testsRun: z.array(z.string().min(1).max(1000)).max(50).default([]),
	preparatoryRefactor: z
		.strictObject({
			applied: z.boolean(),
			summary: z.string().max(2000),
			expectedLocalityBenefit: z.string().max(2000),
		})
		.optional(),
});

export type EvalImplementation = z.infer<typeof EvalImplementation>;

export const EvalRefactor = z.strictObject({
	applied: z.boolean(),
	summary: z.string().min(1).max(4000),
	changedPaths: z.array(z.string().min(1).max(500)).max(200).default([]),
	testsRun: z.array(z.string().min(1).max(1000)).max(50).default([]),
	expectedLocalityBenefit: z.string().max(2000).default(""),
});

export type EvalRefactor = z.infer<typeof EvalRefactor>;

const ReviewPlanStep = z.strictObject({
	refactor: z.string().min(1).max(80),
	direction: z.enum(["remove", "reshape", "add", "test", "safety"]),
	behavior: z.enum(["preserving", "changes-failure-paths", "changes-behavior"]),
	note: z.string().max(1000).default(""),
});

export const EvalReviewFinding = z.strictObject({
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
	plan: z.array(ReviewPlanStep).max(8),
});

export type EvalReviewFinding = z.infer<typeof EvalReviewFinding>;

/** A pull request review by the refactoring skill: its ranked findings, in the skill's own findings.json shape. */
export const EvalReview = z.strictObject({
	summary: z.string().min(1).max(4000),
	static_only: z.boolean(),
	findings: z.array(EvalReviewFinding).max(10),
});

export type EvalReview = z.infer<typeof EvalReview>;

export const EvalTrace = z.strictObject({
	summary: z.string().min(1).max(2000),
});

export type EvalTrace = z.infer<typeof EvalTrace>;
