import { describe, expect, it } from "vitest";
import { SCENARIOS, scenarioHash } from "../app/eval/scenarios.js";
import {
	DEFAULT_MANIFEST,
	expandManifest,
	MONOLITH_MANIFEST,
	SKILL_REVIEW_MANIFEST,
	HEALTH_POLICY_MANIFEST,
	manifestHash,
	POSITIVE_CONTROL_LADDER_MANIFEST,
	POSITIVE_CONTROL_MANIFEST,
	SERIES_2_MANIFEST,
	SERIES_2_SMOKE_MANIFEST,
} from "../eval/manifest.js";
import { cumulativeHiddenTest, requireTarget, TARGETS } from "../eval/targets/index.js";

describe("evaluation manifest", () => {
	it("expands the asymmetric two-target experiment", () => {
		const cells = expandManifest();
		expect(TARGETS).toHaveLength(10);
		expect(SCENARIOS).toHaveLength(18);
		expect(cells).toHaveLength(23);
		expect(new Set(cells.map((cell) => `${cell.targetId}:${cell.scenarioId}`)).size).toBe(23);
		expect(expandManifest({ ...DEFAULT_MANIFEST, replicates: 5 })).toHaveLength(115);
		expect(cells).not.toContainEqual(expect.objectContaining({ targetId: "notification-routing", scenarioId: "periodic-after" }));
	});

	it("changes its content hash when repetitions change", () => {
		expect(manifestHash(DEFAULT_MANIFEST)).not.toBe(manifestHash({ ...DEFAULT_MANIFEST, replicates: 2 }));
	});

	it("randomizes cell order reproducibly from the experiment seed", () => {
		const first = expandManifest({ ...DEFAULT_MANIFEST, replicates: 3, orderSeed: "first" });
		expect(first).toEqual(expandManifest({ ...DEFAULT_MANIFEST, replicates: 3, orderSeed: "first" }));
		expect(first).not.toEqual(expandManifest({ ...DEFAULT_MANIFEST, replicates: 3, orderSeed: "second" }));
	});

	it("keeps every cadence arm distinct and exposes the skill only to refactor arms", () => {
		expect(new Set(SCENARIOS.map(scenarioHash)).size).toBe(18);
		const refactorArms = [
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
		];
		expect(SCENARIOS.filter((scenario) => scenario.exposesSkill).map((scenario) => scenario.id)).toEqual([
			"periodic-after",
			"triggered-after",
			"evidence-seeking",
			...refactorArms,
		]);
		expect(SCENARIOS.filter((scenario) => scenario.postRefactor).map((scenario) => scenario.id)).toEqual([
			"periodic-after",
			"triggered-after",
			...refactorArms,
		]);
		expect(SCENARIOS.filter((scenario) => scenario.preRefactor).map((scenario) => scenario.id)).toEqual(["evidence-seeking"]);
	});

	it("scopes one-shot timing scenarios to the usage-metering positive control", () => {
		const oneShotIds = ["refactor-after-3", "refactor-after-6", "refactor-after-9"] as const;
		for (const scenarioId of oneShotIds) {
			expect(SCENARIOS.find((scenario) => scenario.id === scenarioId)?.targetIds).toEqual(["usage-metering"]);
		}
		expect(expandManifest({ ...DEFAULT_MANIFEST, targetIds: ["inventory-reservations"], scenarioIds: oneShotIds })).toEqual([]);
		const futureCells = expandManifest({
			...DEFAULT_MANIFEST,
			targetIds: ["usage-metering"],
			scenarioIds: oneShotIds,
		});
		expect(futureCells).toHaveLength(3);
		expect(new Set(futureCells.map(({ targetId, scenarioId }) => `${targetId}:${scenarioId}`))).toEqual(
			new Set(oneShotIds.map((scenarioId) => `usage-metering:${scenarioId}`)),
		);
	});

	it("pre-registers the five-replicate positive-control timing matrix", () => {
		const cells = expandManifest(POSITIVE_CONTROL_MANIFEST);
		expect(cells).toHaveLength(20);
		expect(new Set(cells.map((cell) => cell.scenarioId))).toEqual(new Set(["baseline", "refactor-after-3", "refactor-after-6", "refactor-after-9"]));
		expect(cells.every((cell) => cell.targetId === "usage-metering")).toBe(true);
	});

	it("pre-registers the positive-control ladder and the health-policy comparison with concurrent baselines", () => {
		expect(expandManifest(POSITIVE_CONTROL_LADDER_MANIFEST)).toHaveLength(50);
		const policy = expandManifest(HEALTH_POLICY_MANIFEST);
		expect(policy).toHaveLength(120);
		for (const targetId of HEALTH_POLICY_MANIFEST.targetIds) {
			expect(policy.filter((cell) => cell.targetId === targetId && cell.scenarioId === "baseline")).toHaveLength(10);
		}
	});

	it("pre-registers the skill-review comparison with the fixed-timing arm only on the positive control", () => {
		const cells = expandManifest(SKILL_REVIEW_MANIFEST);
		expect(cells).toHaveLength(100);
		expect(cells.filter((cell) => cell.scenarioId === "refactor-after-6-briefed").every((cell) => cell.targetId === "usage-metering")).toBe(true);
		expect(SCENARIOS.find((scenario) => scenario.id === "skill-review")).toMatchObject({ skill: "talk", replayCanonical: true });
	});

	it("varies the monolith only by seed or by backlog, against one reference solution", () => {
		const [through, elsewhere, clean] = MONOLITH_MANIFEST.targetIds.map((id) => requireTarget(id));
		expect(expandManifest(MONOLITH_MANIFEST)).toHaveLength(180);
		expect(elsewhere.files).toEqual(through.files);
		expect(clean.steps).toEqual(through.steps);
		expect(clean.files).not.toEqual(through.files);
		expect(elsewhere.steps.map((step) => step.id)).not.toEqual(through.steps.map((step) => step.id));
		expect(clean.referenceFiles).toEqual(through.referenceFiles);
		expect(elsewhere.referenceFiles).toEqual(through.referenceFiles);
	});

	it("adds exactly one factor at each step of the positive-control ladder", () => {
		const factors = (id: string) => {
			const scenario = SCENARIOS.find((candidate) => candidate.id === id);
			if (!scenario) throw new Error(id);
			return {
				intervention: scenario.intervention,
				guard: Boolean(scenario.traceAuthor),
				briefing: Boolean(scenario.briefing),
				playbook: scenario.implementer.id === "eval-playbook-implementer",
			};
		};
		const ladder = POSITIVE_CONTROL_LADDER_MANIFEST.scenarioIds.slice(1).map(factors);
		for (const arm of ladder) expect(arm.intervention).toBe("refactor_after_6");
		for (let step = 1; step < ladder.length; step++) {
			const changed = (["guard", "briefing", "playbook"] as const).filter((factor) => ladder[step][factor] !== ladder[step - 1][factor]);
			expect(changed).toHaveLength(1);
		}
	});

	it("builds cumulative hidden tests without putting them in seed files", () => {
		for (const target of TARGETS) {
			expect(Object.keys(target.files).some((path) => path.includes("hidden"))).toBe(false);
			const throughThree = cumulativeHiddenTest(target, 2);
			expect(throughThree).toContain(target.steps[0].hiddenTest.trim());
			expect(throughThree).toContain(target.steps[2].hiddenTest.trim());
			expect(throughThree).not.toContain(target.steps[3].hiddenTest.trim());
		}
	});

	it("pre-registers series 2: four arms on five targets, every refactor behind the key-sorted replay guard", () => {
		const cells = expandManifest(SERIES_2_MANIFEST);
		expect(cells).toHaveLength(200);
		for (const targetId of SERIES_2_MANIFEST.targetIds) {
			for (const scenarioId of SERIES_2_MANIFEST.scenarioIds) {
				expect(cells.filter((cell) => cell.targetId === targetId && cell.scenarioId === scenarioId)).toHaveLength(10);
			}
		}
		const refactorArms = SERIES_2_MANIFEST.scenarioIds
			.map((id) => SCENARIOS.find((scenario) => scenario.id === id))
			.filter((scenario) => scenario?.postRefactor);
		expect(refactorArms.map((scenario) => scenario?.id)).toEqual(["skill-review", "signals-only", "signals-skill"]);
		for (const scenario of refactorArms) expect(scenario).toMatchObject({ replayCanonical: true, traceAuthor: expect.anything() });
		expect(expandManifest(SERIES_2_SMOKE_MANIFEST)).toHaveLength(4);
	});

	it("gives both gated series 2 arms the same gate, so they differ only in who decides what to change", () => {
		const [signalsOnly, signalsSkill] = (["signals-only", "signals-skill"] as const).map((id) => SCENARIOS.find((scenario) => scenario.id === id));
		expect(signalsOnly?.intervention).toBe("signals_triggered");
		expect(signalsSkill?.intervention).toBe("signals_triggered");
		expect(signalsOnly?.reviewer).toBeUndefined();
		expect(signalsSkill).toMatchObject({ skill: "talk", reviewer: expect.anything() });
	});
});
