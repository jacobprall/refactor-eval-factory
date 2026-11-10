import { describe, expect, it } from "vitest";
import { describeGate, type GateHistory, gateFires } from "../app/refactor/index.js";

/** One limit decision; two calls with different names are a renamed copy, which exact matching misses. */
const decide = (name: string, field: string) => `export function ${name}(input: { units: number; limit: number; used: number }) {
  const ${field} = input.used + input.units;
  if (${field} > input.limit) {
    return { allowed: false, ${field}, remaining: input.limit - input.used, reason: "limit_exceeded" };
  }
  return { allowed: true, ${field}, remaining: input.limit - ${field}, reason: null };
}
`;

const tangled = `export function tangled(rows: number[][], a: boolean, b: boolean, c: boolean) {
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

const METER = "src/meter.ts";
const copied = { [METER]: `${decide("record", "projected")}\n${decide("preview", "total")}` };
const clean = { [METER]: decide("record", "projected") };

/** Five merges, oldest first: the window ending at HEAD is the last four, the previous window the first four. */
function history(merges: string[][], snapshots: Partial<GateHistory["snapshots"]> = {}): GateHistory {
	return { merges, snapshots: { head: copied, previous: clean, windowBase: clean, previousWindowBase: clean, ...snapshots } };
}

describe("refactor gate", () => {
	it("fires on the merge where a file that keeps changing becomes hard to change, and says why", () => {
		const { fires, reading } = gateFires(history([[], [], [METER], [METER], [METER]]));
		expect(fires).toBe(true);
		expect(describeGate(reading)).toEqual([
			expect.stringMatching(/^- src\/meter\.ts is hard to change and often changed: health \d+(\.\d+)? \(10 is best; 9\.5 is the bar\), down from 10 4 merges ago; changed in 3 of the last 4 merges\.$/),
			"  - Lines 1–7, 9–15 repeat code found elsewhere, after renaming.",
		]);
	});

	it("leaves hard code alone when work isn't happening there", () => {
		expect(gateFires(history([[], [], [], [METER], ["src/other.ts"]])).fires).toBe(false);
	});

	it("leaves a hot file alone while it stays healthy", () => {
		expect(gateFires(history([[], [], [METER], [METER], [METER]], { head: clean })).fires).toBe(false);
	});

	it("doesn't fire again while the same problem persists, so a declined or rejected finding costs no further reviews", () => {
		const persisting = history([[METER], [METER], [METER], [METER], [METER]], { previous: copied });
		expect(gateFires(persisting).reading.open).toBe(true);
		expect(gateFires(persisting).fires).toBe(false);
	});

	it("names functions above the cognitive-complexity limit of 15 in the brief", () => {
		const head = { "src/tangled.ts": tangled };
		const { fires, reading } = gateFires({
			merges: [[], [], ["src/tangled.ts"], ["src/tangled.ts"], ["src/tangled.ts"]],
			snapshots: { head, previous: {}, windowBase: {}, previousWindowBase: {} },
		});
		expect(fires).toBe(true);
		expect(describeGate(reading)).toContain("  - tangled (line 1): cognitive complexity 20; the limit is 15.");
	});

	it("fires when files in different directories keep changing together", () => {
		const pair = ["src/orders/price.ts", "src/billing/invoice.ts"];
		const sources = { [pair[0] as string]: "export const a = 1;\n", [pair[1] as string]: "export const b = 2;\n" };
		const { fires, reading } = gateFires({
			merges: [[], [], pair, pair, pair],
			snapshots: { head: sources, previous: sources, windowBase: sources, previousWindowBase: sources },
		});
		expect(fires).toBe(true);
		expect(reading.coupling).toEqual(["src/billing/invoice.ts", "src/orders/price.ts"]);
	});
});
