import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import type { Agent } from "../agents/define.js";
import {
	evalBaseline,
	evalPlaybookImplementer,
	evalPostRefactor,
	evalPostRefactorBriefed,
	evalPostRefactorPlaybook,
	evalPostRefactorSignals,
	evalPreRefactor,
	evalSkillApplier,
	evalSkillReviewer,
	evalTraceAuthor,
} from "../agents/eval/index.js";
import { TALK_SKILL_DIR } from "./workspace.js";

export const SCENARIO_IDS = [
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
] as const;

export type ScenarioId = (typeof SCENARIO_IDS)[number];

export interface EvalScenario {
	id: ScenarioId;
	label: string;
	implementer: Agent;
	postRefactor?: Agent;
	preRefactor?: Agent;
	/** Writes a replay script before each post-refactor; a refactor that changes its output is rolled back. */
	traceAuthor?: Agent;
	/** Gives the post-refactor agent measured structural-health evidence. */
	briefing?: boolean;
	/** Reviews every feature with the full refactoring skill; the post-refactor agent applies only what the review says to act on. */
	reviewer?: Agent;
	/** Uploads the full refactoring skill instead of the short change-locality guide. */
	skill?: "talk";
	/** Compares replay output after sorting object keys, so reordered fields are not a behavior change. */
	replayCanonical?: boolean;
	exposesSkill: boolean;
	intervention:
		| "never"
		| "periodic_after"
		| "triggered_after"
		| "evidence_seeking"
		| "refactor_after_3"
		| "refactor_after_6"
		| "refactor_after_9"
		| "health_triggered"
		| "health_safeguard"
		| "skill_review"
		| "coupling_triggered"
		| "signals_triggered";
	targetIds?: readonly string[];
}

export const SCENARIOS: readonly EvalScenario[] = [
	{
		id: "baseline",
		label: "Task only",
		implementer: evalBaseline,
		exposesSkill: false,
		intervention: "never",
	},
	{
		id: "periodic-after",
		label: "Refactor after features 3, 6, and 9",
		implementer: evalBaseline,
		postRefactor: evalPostRefactor,
		exposesSkill: true,
		intervention: "periodic_after",
		targetIds: ["inventory-reservations"],
	},
	{
		id: "triggered-after",
		label: "Refactor after prior-history trigger",
		implementer: evalBaseline,
		postRefactor: evalPostRefactor,
		exposesSkill: true,
		intervention: "triggered_after",
	},
	{
		id: "evidence-seeking",
		label: "Compare direct and refactor-first implementations",
		implementer: evalBaseline,
		preRefactor: evalPreRefactor,
		exposesSkill: true,
		intervention: "evidence_seeking",
	},
	{
		id: "refactor-after-3",
		label: "Refactor once after feature 3",
		implementer: evalBaseline,
		postRefactor: evalPostRefactor,
		exposesSkill: true,
		intervention: "refactor_after_3",
		targetIds: ["usage-metering"],
	},
	{
		id: "refactor-after-6",
		label: "Refactor once after feature 6",
		implementer: evalBaseline,
		postRefactor: evalPostRefactor,
		exposesSkill: true,
		intervention: "refactor_after_6",
		targetIds: ["usage-metering"],
	},
	{
		id: "refactor-after-9",
		label: "Refactor once after feature 9",
		implementer: evalBaseline,
		postRefactor: evalPostRefactor,
		exposesSkill: true,
		intervention: "refactor_after_9",
		targetIds: ["usage-metering"],
	},
	{
		id: "refactor-after-6-guarded",
		label: "Refactor once after feature 6 behind a replay guard",
		implementer: evalBaseline,
		postRefactor: evalPostRefactor,
		traceAuthor: evalTraceAuthor,
		exposesSkill: true,
		intervention: "refactor_after_6",
		targetIds: ["usage-metering"],
	},
	{
		id: "refactor-after-6-briefed",
		label: "Guarded refactor after feature 6 with measured health evidence",
		implementer: evalBaseline,
		postRefactor: evalPostRefactorBriefed,
		traceAuthor: evalTraceAuthor,
		briefing: true,
		exposesSkill: true,
		intervention: "refactor_after_6",
		targetIds: ["usage-metering"],
	},
	{
		id: "refactor-after-6-playbook",
		label: "Briefed, guarded refactor after feature 6 that leaves a playbook",
		implementer: evalPlaybookImplementer,
		postRefactor: evalPostRefactorPlaybook,
		traceAuthor: evalTraceAuthor,
		briefing: true,
		exposesSkill: true,
		intervention: "refactor_after_6",
		targetIds: ["usage-metering"],
	},
	{
		id: "health-triggered",
		label: "One briefed, guarded refactor when a hotspot's health decays",
		implementer: evalBaseline,
		postRefactor: evalPostRefactorBriefed,
		traceAuthor: evalTraceAuthor,
		briefing: true,
		exposesSkill: true,
		intervention: "health_triggered",
	},
	{
		id: "health-safeguard",
		label: "Guarded refactor of each feature's new health findings",
		implementer: evalBaseline,
		postRefactor: evalPostRefactorBriefed,
		traceAuthor: evalTraceAuthor,
		briefing: true,
		exposesSkill: true,
		intervention: "health_safeguard",
	},
	{
		id: "skill-review",
		label: "Refactoring skill reviews every feature; apply its first act-now finding behind a replay guard",
		implementer: evalBaseline,
		reviewer: evalSkillReviewer,
		postRefactor: evalSkillApplier,
		traceAuthor: evalTraceAuthor,
		skill: "talk",
		replayCanonical: true,
		exposesSkill: true,
		intervention: "skill_review",
	},
	{
		id: "skill-review-health-gated",
		label: "The health gate decides when; the refactoring skill reviews once and decides what, or nothing",
		implementer: evalBaseline,
		reviewer: evalSkillReviewer,
		postRefactor: evalSkillApplier,
		traceAuthor: evalTraceAuthor,
		skill: "talk",
		replayCanonical: true,
		exposesSkill: true,
		intervention: "health_triggered",
	},
	{
		id: "skill-review-maturity-gated",
		label: "The maturity gate decides when; the refactoring skill reviews once and decides what, or nothing",
		implementer: evalBaseline,
		reviewer: evalSkillReviewer,
		postRefactor: evalSkillApplier,
		traceAuthor: evalTraceAuthor,
		skill: "talk",
		replayCanonical: true,
		exposesSkill: true,
		intervention: "triggered_after",
	},
	{
		id: "skill-review-coupling-gated",
		label: "The coupling gate decides when and where to look; the refactoring skill reviews once and decides what, or nothing",
		implementer: evalBaseline,
		reviewer: evalSkillReviewer,
		postRefactor: evalSkillApplier,
		traceAuthor: evalTraceAuthor,
		skill: "talk",
		replayCanonical: true,
		exposesSkill: true,
		intervention: "coupling_triggered",
	},
	{
		id: "signals-only",
		label: "Health, heat, and coupling decide when and where; one guarded refactor of what they name",
		implementer: evalBaseline,
		postRefactor: evalPostRefactorSignals,
		traceAuthor: evalTraceAuthor,
		replayCanonical: true,
		exposesSkill: true,
		intervention: "signals_triggered",
	},
	{
		id: "signals-skill",
		label: "Health, heat, and coupling decide when and where to look; the refactoring skill reviews the window once and decides what, or nothing",
		implementer: evalBaseline,
		reviewer: evalSkillReviewer,
		postRefactor: evalSkillApplier,
		traceAuthor: evalTraceAuthor,
		skill: "talk",
		replayCanonical: true,
		exposesSkill: true,
		intervention: "signals_triggered",
	},
];

export function requireScenario(id: string): EvalScenario {
	const scenario = SCENARIOS.find((candidate) => candidate.id === id);
	if (!scenario) throw new Error(`unknown eval scenario ${JSON.stringify(id)}`);
	return scenario;
}

const agentIdentity = (agent: Agent | undefined) => (agent ? { id: agent.id, prompt: agent.prompt, model: agent.harness.label } : null);

export function scenarioHash(scenario: EvalScenario): string {
	return createHash("sha256")
		.update(
			JSON.stringify({
				id: scenario.id,
				implementer: agentIdentity(scenario.implementer),
				postRefactor: agentIdentity(scenario.postRefactor),
				preRefactor: agentIdentity(scenario.preRefactor),
				// Added only when set, so scenarios that predate these fields keep their recorded hashes.
				...(scenario.traceAuthor ? { traceAuthor: agentIdentity(scenario.traceAuthor) } : {}),
				...(scenario.briefing ? { briefing: true } : {}),
				...(scenario.reviewer ? { reviewer: agentIdentity(scenario.reviewer) } : {}),
				...(scenario.skill ? { talkSkill: talkSkillHash() } : {}),
				...(scenario.replayCanonical ? { replayCanonical: true } : {}),
				exposesSkill: scenario.exposesSkill,
				intervention: scenario.intervention,
				targetIds: scenario.targetIds ?? null,
				skill: scenario.exposesSkill ? readFileSync(new URL("../../eval/skills/refactoring/SKILL.md", import.meta.url), "utf8") : null,
			}),
		)
		.digest("hex");
}

function talkSkillHash(): string {
	const hash = createHash("sha256");
	const paths = readdirSync(TALK_SKILL_DIR, { recursive: true, withFileTypes: true })
		.filter((entry) => entry.isFile() && !entry.name.startsWith(".") && !entry.parentPath.includes("__pycache__"))
		.map((entry) => relative(TALK_SKILL_DIR, join(entry.parentPath, entry.name)))
		.sort();
	for (const path of paths) hash.update(path).update(readFileSync(join(TALK_SKILL_DIR, path)));
	return hash.digest("hex");
}
