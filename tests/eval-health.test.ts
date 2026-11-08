import { describe, expect, it } from "vitest";
import { analyzeHealth, newFindings } from "../app/eval/health.js";
import { requireTarget } from "../eval/targets/index.js";

const tangled = `export function route(order: { kind: string; items: number[]; express: boolean; region: string }) {
  let total = 0;
  for (const item of order.items) {
    if (item > 0) {
      if (order.express) {
        if (order.region === "eu" || order.region === "uk" || order.region === "ch" || order.region === "no") {
          total += item * 2;
        } else {
          total += item;
        }
      }
    }
  }
  switch (order.kind) {
    case "a": return total + 1;
    case "b": return total + 2;
    case "c": return total + 3;
    case "d": return total + 4;
    default: return total;
  }
}
`;

const flat = `const EXPRESS_REGIONS = new Set(["eu", "uk", "ch", "no"]);

export function route(order: { items: number[]; express: boolean; region: string }) {
  const multiplier = order.express && EXPRESS_REGIONS.has(order.region) ? 2 : 1;
  return order.items.filter((item) => item > 0).reduce((total, item) => total + item * multiplier, 0);
}
`;

const duplicated = (name: string) => `export function ${name}(input: { units: number; limit: number }) {
  const units = Math.max(0, input.units);
  const limit = Math.max(0, input.limit);
  const projected = units + 1;
  const allowed = projected <= limit;
  const remaining = limit - projected;
  return { allowed, remaining, projected };
}
`;

describe("structural health sensor", () => {
	it("scores tangled, deeply nested code below the AI-friendly bar and flat code at 10", () => {
		const before = analyzeHealth({ "src/route.ts": tangled });
		const after = analyzeHealth({ "src/route.ts": flat });
		expect(before.files[0].findings.map((finding) => finding.kind)).toEqual(
			expect.arrayContaining(["complex_method", "deep_nesting", "complex_conditional"]),
		);
		expect(before.score).toBeLessThan(9.5);
		expect(after.score).toBe(10);
	});

	it("treats an else-if ladder as one decision, not deeper nesting", () => {
		const ladder = `export function grade(score: number) {
  if (score > 90) return "a";
  else if (score > 80) return "b";
  else if (score > 70) return "c";
  else if (score > 60) return "d";
  return "f";
}
`;
		expect(analyzeHealth({ "src/grade.ts": ladder }).files[0].findings.filter((finding) => finding.kind === "deep_nesting")).toEqual([]);
	});

	it("finds duplicated blocks across production files and clears them once consolidated", () => {
		const copies = analyzeHealth({ "src/record.ts": duplicated("record"), "src/preview.ts": duplicated("preview") });
		expect(copies.files.flatMap((file) => file.findings.map((finding) => finding.kind))).toEqual(["duplicated_block", "duplicated_block"]);
		expect(analyzeHealth({ "src/evaluate.ts": duplicated("evaluate") }).score).toBe(10);
	});

	it("measures only production sources", () => {
		const health = analyzeHealth({ "src/route.ts": flat, "tests/route.test.ts": tangled, "scripts/build.ts": tangled, "README.md": "# x" });
		expect(health.files.map((file) => file.path)).toEqual(["src/route.ts"]);
	});

	it("records module boundaries beside the score: the planted reach-in in the debt seed, none in the clean seed", () => {
		const debt = analyzeHealth(requireTarget("commerce-monolith").files);
		const clean = analyzeHealth(requireTarget("commerce-monolith-clean").files);
		expect(debt.boundaries?.violations).toEqual([{ from: "src/notifications/notifier.ts", to: "src/orders/store.ts" }]);
		expect(clean.boundaries?.violations).toEqual([]);
		expect(clean.boundaries?.crossModuleImports).toBeGreaterThan(0);
		expect(analyzeHealth(requireTarget("usage-metering").files).boundaries).toBeUndefined();
	});

	it("reports only findings a change added, ignoring line shifts in existing ones", () => {
		const before = analyzeHealth({ "src/route.ts": tangled }).files[0];
		const shifted = analyzeHealth({ "src/route.ts": `// header\n\n${tangled}` }).files[0];
		expect(newFindings(before, shifted)).toEqual([]);
		const worse = analyzeHealth({
			"src/route.ts": `${tangled}\nexport function wide(a: number, b: number, c: number, d: number, e: number) { return a + b + c + d + e; }\n`,
		}).files[0];
		expect(newFindings(before, worse)).toEqual([expect.objectContaining({ kind: "excess_arguments", symbol: "wide" })]);
	});
});
