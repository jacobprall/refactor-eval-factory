import { z } from "zod";

/** Every task input names its repository and the App installation to act through. */
const RepoInput = z.object({
	repo: z.string().regex(/^[\w.-]+\/[\w.-]+$/),
	installationId: z.number().int().positive(),
});

const ActorLogin = z.string().min(1);

export const TriageInput = RepoInput.extend({
	issue: z.number().int().positive(),
	actor: ActorLogin,
	/** Set when a human reply started this round. */
	commentId: z.number().int().positive().optional(),
});

export const AutopilotInput = RepoInput.extend({
	issue: z.number().int().positive(),
	actor: ActorLogin,
	/** Set when a human reply restarted an autopilot run that had asked questions. */
	commentId: z.number().int().positive().optional(),
});

export const SpecApproval = z.discriminatedUnion("kind", [
	z.object({
		kind: z.literal("label"),
		/** When the approval label was applied; the spec must not have changed after it. */
		labeledAt: z.iso.datetime({ offset: true }),
	}),
	z.object({
		kind: z.literal("autopilot"),
		/** The exact App-authored spec returned by the Triage child task. */
		commentId: z.number().int().positive(),
		hash: z.string().regex(/^[0-9a-f]{64}$/),
		version: z.number().int().positive(),
	}),
]);

export const SpecToPrInput = RepoInput.extend({
	issue: z.number().int().positive(),
	actor: ActorLogin,
	approval: SpecApproval,
});

export const PrReviewInput = RepoInput.extend({
	pr: z.number().int().positive(),
	headSha: z.string().regex(/^[0-9a-f]{40}$/),
	actor: ActorLogin,
	/** Keeps an autopilot review under the issue-level root claim. */
	workflowIssue: z.number().int().positive().optional(),
});

export const CancelInput = RepoInput.extend({
	/** Issue or PR number. */
	number: z.number().int().positive(),
	kind: z.enum(["issue", "pr"]),
	actor: ActorLogin,
});

export const RefreshSnapshotInput = RepoInput.extend({
	sha: z.string().regex(/^[0-9a-f]{40}$/),
});

export const EvalScenarioId = z.enum([
	"baseline",
	"periodic-after",
	"triggered-after",
	"evidence-seeking",
	"refactor-after-3",
	"refactor-after-6",
	"refactor-after-9",
	"refactor-after-6-guarded",
	"refactor-after-6-briefed",
	"refactor-after-6-playbook",
	"health-triggered",
	"health-safeguard",
	"skill-review",
	"skill-review-health-gated",
	"skill-review-maturity-gated",
	"skill-review-coupling-gated",
	"signals-only",
	"signals-skill",
]);

export const EvalTargetId = z.enum([
	"subscription-billing",
	"inventory-reservations",
	"approval-workflows",
	"notification-routing",
	"access-control",
	"event-scheduling",
	"usage-metering",
	"commerce-monolith",
	"commerce-monolith-elsewhere",
	"commerce-monolith-clean",
]);

export const RunExperimentInput = z.object({
	experimentId: z.uuid().optional(),
	replicates: z.number().int().min(1).max(20).default(1),
	maxConcurrency: z.number().int().min(1).max(100).default(8),
	targetIds: z.array(EvalTargetId).min(1).max(EvalTargetId.options.length).optional(),
	scenarioIds: z.array(EvalScenarioId).min(1).max(EvalScenarioId.options.length).optional(),
});

export const RunTrajectoryInput = z.object({
	experimentId: z.uuid(),
	targetId: EvalTargetId,
	scenarioId: EvalScenarioId,
	replicate: z.number().int().min(0).max(19),
});

export const SummarizeExperimentInput = z.object({
	experimentId: z.uuid(),
});

export type TriageInput = z.infer<typeof TriageInput>;
export type AutopilotInput = z.infer<typeof AutopilotInput>;
export type SpecApproval = z.infer<typeof SpecApproval>;
export type SpecToPrInput = z.infer<typeof SpecToPrInput>;
export type PrReviewInput = z.infer<typeof PrReviewInput>;
export type CancelInput = z.infer<typeof CancelInput>;
export type RefreshSnapshotInput = z.infer<typeof RefreshSnapshotInput>;
export type RunExperimentInput = z.infer<typeof RunExperimentInput>;
export type RunTrajectoryInput = z.infer<typeof RunTrajectoryInput>;
export type SummarizeExperimentInput = z.infer<typeof SummarizeExperimentInput>;
