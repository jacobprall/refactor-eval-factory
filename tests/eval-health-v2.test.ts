import { describe, expect, it } from "vitest";
import { analyzeHealth } from "../app/eval/health.js";
import { analyzeHealthV2 } from "../app/eval/health-v2.js";

const cognitive = (source: string, symbol: string) =>
	analyzeHealthV2({ "src/code.ts": source }).files[0].functions.find((fn) => fn.symbol === symbol)?.cognitive;

const decide = (name: string, field: string) => `export function ${name}(input: { units: number; limit: number; used: number }) {
  const ${field} = input.used + input.units;
  if (${field} > input.limit) {
    return { allowed: false, ${field}, remaining: input.limit - input.used, reason: "limit_exceeded" };
  }
  return { allowed: true, ${field}, remaining: input.limit - ${field}, reason: null };
}
`;

describe("structural health v2", () => {
	it("scores cognitive complexity like SonarSource's published examples", () => {
		const sumOfPrimes = `export function sumOfPrimes(max: number) {
  let total = 0;
  OUT: for (let i = 1; i <= max; ++i) {
    for (let j = 2; j < i; ++j) {
      if (i % j === 0) {
        continue OUT;
      }
    }
    total += i;
  }
  return total;
}`;
		const getWords = `export function getWords(n: number) {
  switch (n) {
    case 1: return "one";
    case 2: return "a couple";
    default: return "lots";
  }
}`;
		expect(cognitive(sumOfPrimes, "sumOfPrimes")).toBe(7);
		expect(cognitive(getWords, "getWords")).toBe(1);
	});

	it("charges each run of like logical operators once and does not nest an else-if chain", () => {
		const source = `export function grade(a: boolean, b: boolean, c: boolean, d: boolean, score: number) {
  if (a && b && c || d) return "x";
  if (score > 90) return "a";
  else if (score > 80) return "b";
  else return "c";
}`;
		expect(cognitive(source, "grade")).toBe(6);
	});

	it("scores nested functions on their own, so factory-style modules are not charged for what they return", () => {
		const source = `export function createThing() {
  return {
    run(x: number) {
      if (x > 1) return 1;
      return 0;
    },
  };
}`;
		expect(cognitive(source, "createThing")).toBe(0);
		expect(cognitive(source, "run")).toBe(1);
	});

	it("costs 0.2 health per point of cognitive complexity above Sonar's limit of 15", () => {
		const source = `export function tangled(rows: number[][], a: boolean, b: boolean, c: boolean) {
  let total = 0;
  for (const row of rows) {
    for (const cell of row) {
      for (let i = 0; i < cell; i++) {
        if (a) {
          if (b) total += i;
        }
      }
    }
  }
  if (a && b || c) total++;
  while (total > 100) total -= 10;
  const sign = total > 0 ? 1 : -1;
  return total * sign;
}
`;
		const file = analyzeHealthV2({ "src/tangled.ts": source }).files[0];
		expect(file.functions[0].cognitive).toBe(20);
		expect(file.complexityExcess).toBe(5);
		expect(file.health).toBe(9);
	});

	it("finds copies that were renamed, which exact matching misses, and ignores matching type declarations", () => {
		const renamed = { "src/record.ts": decide("record", "projected"), "src/preview.ts": decide("preview", "total") };
		expect(analyzeHealth(renamed).score).toBe(10);
		expect(analyzeHealthV2(renamed).files.every((file) => file.duplicatedLines > 0 && file.health < 10)).toBe(true);
		expect(analyzeHealthV2(renamed).files[0].copiedRanges).toEqual([{ from: 1, to: 7 }]);

		const shape =
			"export interface Line {\n  sku: string;\n  quantity: number;\n  unitPriceCents: number;\n  subtotalCents: number;\n  discountCents: number;\n  taxCents: number;\n  totalCents: number;\n}\n";
		expect(analyzeHealthV2({ "src/orders.ts": shape, "src/billing.ts": shape.replace("Line", "InvoiceLine") }).health).toBe(10);
	});

	it("weights health where the work is by how often recent features changed each file", () => {
		const cold = `${Array.from({ length: 30 }, (_, index) => `// configuration note ${index}`).join("\n")}\nexport const ready = true;\n`;
		const sources = { "src/hot.ts": `${decide("record", "projected")}\n${decide("preview", "total")}`, "src/cold.ts": cold };
		const history = [["src/hot.ts"], ["src/hot.ts"], ["src/hot.ts", "src/cold.ts"]];
		const snapshot = analyzeHealthV2(sources, history);
		expect(snapshot.files.map((file) => [file.path, file.heat])).toEqual([
			["src/cold.ts", 1],
			["src/hot.ts", 3],
		]);
		expect(snapshot.healthWhereWorkIs).toBeLessThan(snapshot.health);
		expect(analyzeHealthV2(sources).healthWhereWorkIs).toBe(analyzeHealthV2(sources).health);
	});
});
