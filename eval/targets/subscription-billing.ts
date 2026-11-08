import { type EvalTarget, seedFiles } from "./types.js";

const source = `export interface LineItem { quantity: number; unitPriceCents: number }

export function subtotal(items: LineItem[]): number {
  return items.reduce((total, item) => total + item.quantity * item.unitPriceCents, 0);
}
`;

const publicTests = `import test from "node:test";
import assert from "node:assert/strict";
import { subtotal } from "../src/index.ts";

test("computes a subtotal", () => {
  assert.equal(subtotal([{ quantity: 2, unitPriceCents: 500 }]), 1000);
});
`;

export const subscriptionBilling: EvalTarget = {
	id: "subscription-billing",
	title: "Subscription billing",
	files: seedFiles("subscription-billing", source, publicTests),
	publicVerify: ["npm test"],
	steps: [
		{
			id: "percentage-discount",
			title: "Percentage discounts",
			prompt:
				"Add quote(items, discountPercent) returning the subtotal after an integer percentage discount. Reject percentages outside 0..100. Round to the nearest cent.",
			hiddenTest: `test("applies percentage discounts", () => {
  assert.equal(subject.quote([{ quantity: 1, unitPriceCents: 1000 }], 15), 850);
  assert.throws(() => subject.quote([], 101));
});`,
		},
		{
			id: "plan-discount",
			title: "Plan-specific discounts",
			prompt:
				"Extend quote to accept a plan ('free' | 'pro' | 'enterprise'). Apply plan discounts of 0%, 10%, and 20% before the existing explicit percentage discount.",
			hiddenTest: `test("applies plan then explicit discount", () => {
  assert.equal(subject.quote([{ quantity: 1, unitPriceCents: 1000 }], 10, "pro"), 810);
  assert.equal(subject.quote([{ quantity: 1, unitPriceCents: 1000 }], 0, "enterprise"), 800);
});`,
		},
		{
			id: "coupon",
			title: "Fixed coupons",
			prompt: "Support an optional fixed-value coupon in cents. It is applied after percentage discounts and may not make the quote negative.",
			hiddenTest: `test("applies a bounded coupon", () => {
  assert.equal(subject.quote([{ quantity: 1, unitPriceCents: 1000 }], 0, "free", 250), 750);
  assert.equal(subject.quote([{ quantity: 1, unitPriceCents: 100 }], 0, "free", 250), 0);
});`,
		},
		{
			id: "tax",
			title: "Jurisdiction tax",
			prompt:
				"Add a jurisdiction argument ('none' | 'us-ca' | 'eu-de') and apply tax rates 0%, 7.25%, and 19% after all discounts. Return the final rounded cents.",
			hiddenTest: `test("applies jurisdiction tax last", () => {
  assert.equal(subject.quote([{ quantity: 1, unitPriceCents: 1000 }], 0, "free", 0, "us-ca"), 1073);
  assert.equal(subject.quote([{ quantity: 1, unitPriceCents: 1000 }], 0, "free", 0, "eu-de"), 1190);
});`,
		},
		{
			id: "proration",
			title: "Proration",
			prompt:
				"Support billing for activeDays out of periodDays. Prorate the subtotal before discounts. Validate both values and round only the final result.",
			hiddenTest: `test("prorates before discounts", () => {
  assert.equal(subject.quote([{ quantity: 1, unitPriceCents: 3100 }], 0, "free", 0, "none", 15, 30), 1550);
  assert.throws(() => subject.quote([], 0, "free", 0, "none", 31, 30));
});`,
		},
		{
			id: "currency",
			title: "Currency minor units",
			prompt: "Support currency 'USD' and 'JPY'. USD keeps cents; JPY rounds final amounts to whole units. Keep the existing numeric return value.",
			hiddenTest: `test("rounds by currency", () => {
  assert.equal(subject.quote([{ quantity: 1, unitPriceCents: 101 }], 0, "free", 0, "none", 1, 1, "JPY"), 101);
});`,
		},
		{
			id: "refund",
			title: "Refund calculations",
			prompt:
				"Add calculateRefund(originalPaid, usedFraction, nonRefundableCents). Return the refundable amount after subtracting usage and the non-refundable amount, bounded at zero.",
			hiddenTest: `test("calculates refunds", () => {
  assert.equal(subject.calculateRefund(1000, 0.25, 100), 650);
  assert.equal(subject.calculateRefund(100, 1, 50), 0);
});`,
		},
		{
			id: "breakdown",
			title: "Explainable quote",
			prompt:
				"Add explainQuote with the same arguments as quote. Return subtotal, proratedSubtotal, planDiscount, explicitDiscount, coupon, tax, and total. quote and explainQuote must use the same pricing rules.",
			hiddenTest: `test("returns an internally consistent breakdown", () => {
  const result = subject.explainQuote([{ quantity: 1, unitPriceCents: 1000 }], 10, "pro", 100, "us-ca", 1, 1, "USD");
  assert.equal(result.total, subject.quote([{ quantity: 1, unitPriceCents: 1000 }], 10, "pro", 100, "us-ca", 1, 1, "USD"));
  assert.equal(result.subtotal, 1000);
});`,
		},
	],
};
