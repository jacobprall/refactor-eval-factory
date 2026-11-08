import { EvalImplementation, EvalRefactor, EvalReview, EvalTrace } from "../../schemas/eval.js";
import { defineAgent } from "../define.js";
import { piSonnet } from "../models.js";

const implementation = (id: string, prompt: string) =>
	defineAgent({
		id,
		prompt,
		harness: piSonnet,
		tools: ["read", "ls", "bash", "edit", "write"] as const,
		output: EvalImplementation,
		maxTurns: 40,
	});

const refactorer = (id: string, prompt: string) =>
	defineAgent({
		id,
		prompt,
		harness: piSonnet,
		tools: ["read", "ls", "bash", "edit", "write"] as const,
		output: EvalRefactor,
		maxTurns: 30,
	});

export const evalBaseline = implementation("eval-baseline", "eval/baseline.md");
export const evalQualityGuidance = implementation("eval-quality-guidance", "eval/quality-guidance.md");
export const evalRefactoringKnowledge = implementation("eval-refactoring-knowledge", "eval/refactoring-knowledge.md");
export const evalChangeLocality = implementation("eval-change-locality", "eval/change-locality.md");
export const evalChangeLocalitySkill = implementation("eval-change-locality-skill", "eval/change-locality-skill.md");
export const evalRefactorAfter = implementation("eval-refactor-after", "eval/refactor-after.md");
export const evalPlaybookImplementer = implementation("eval-playbook-implementer", "eval/playbook-implementer.md");

export const evalPostRefactor = refactorer("eval-post-refactor", "eval/post-refactor.md");
export const evalPostRefactorBriefed = refactorer("eval-post-refactor-briefed", "eval/post-refactor-briefed.md");
export const evalPostRefactorPlaybook = refactorer("eval-post-refactor-playbook", "eval/post-refactor-playbook.md");
export const evalPostRefactorSignals = refactorer("eval-post-refactor-signals", "eval/post-refactor-signals.md");
export const evalPreRefactor = refactorer("eval-pre-refactor", "eval/pre-refactor.md");
export const evalSkillApplier = refactorer("eval-skill-applier", "eval/skill-applier.md");

export const evalSkillReviewer = defineAgent({
	id: "eval-skill-reviewer",
	prompt: "eval/skill-reviewer.md",
	harness: piSonnet,
	// Writes only the skill's .refactor/ working files; the harness restores everything else after the review.
	tools: ["read", "ls", "bash", "edit", "write"],
	output: EvalReview,
	maxTurns: 80,
});

export const evalTraceAuthor = defineAgent({
	id: "eval-trace-author",
	prompt: "eval/trace-author.md",
	harness: piSonnet,
	tools: ["read", "ls", "bash", "write"],
	output: EvalTrace,
	maxTurns: 25,
});

export const EVAL_AGENTS = [
	evalBaseline,
	evalQualityGuidance,
	evalRefactoringKnowledge,
	evalChangeLocality,
	evalChangeLocalitySkill,
	evalRefactorAfter,
	evalPlaybookImplementer,
] as const;

/** Agents that act between feature implementations: reviewers, refactorers, and the replay trace author. */
export const EVAL_INTERVENTION_AGENTS = [
	evalPostRefactor,
	evalPostRefactorBriefed,
	evalPostRefactorPlaybook,
	evalPostRefactorSignals,
	evalPreRefactor,
	evalTraceAuthor,
	evalSkillReviewer,
	evalSkillApplier,
] as const;
