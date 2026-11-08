import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import type { EvalStep, EvalTarget } from "./types.js";

/**
 * A modular monolith of deliberately different module styles. Three targets share one codebase:
 * - `commerce-monolith`: planted cross-module debt, and a backlog that keeps working through it.
 * - `commerce-monolith-elsewhere`: the same debt, and a backlog that never needs it. Leaving it alone is right.
 * - `commerce-monolith-clean`: the same backlog as the first on a well-factored seed. Nothing should need fixing.
 * The planted debt is one pricing policy copied into orders and billing (kept in agreement by the composition root),
 * notifications reading the orders module's internal store, and a grab-bag shared utils file.
 */
const ROOT = fileURLToPath(new URL("./commerce/", import.meta.url));

function tree(dir: string): Record<string, string> {
	const base = join(ROOT, dir);
	return Object.fromEntries(
		readdirSync(base, { recursive: true, withFileTypes: true })
			.filter((entry) => entry.isFile())
			.map((entry) => {
				const path = join(entry.parentPath, entry.name);
				return [relative(base, path), readFileSync(path, "utf8")] as const;
			})
			.sort(([a], [b]) => a.localeCompare(b)),
	);
}

const step = (backlog: "through" | "elsewhere", file: string, id: string, title: string, prompt: string): EvalStep => ({
	id,
	title,
	prompt,
	publicTest: readFileSync(join(ROOT, "steps", backlog, `${file}.public.ts`), "utf8"),
	hiddenTest: readFileSync(join(ROOT, "steps", backlog, `${file}.hidden.ts`), "utf8"),
});

const THROUGH_THE_DEBT: readonly EvalStep[] = [
	step(
		"through",
		"01-reduced-tax",
		"reduced-tax",
		"Tax reduced-class products",
		"Allow Product.taxClass 'reduced' in catalog.add (the default stays 'standard'; any other value throws 'invalid_input'). Reduced-class lines are taxed at the customer's regional reduced rate: US 3%, EU 5%, UK 5%. Standard rates are unchanged (US 7%, EU 20%, UK 20%). Tax stays rounded half-up per line in cents, and an order and its invoice must report identical lines and amounts.",
	),
	step(
		"through",
		"02-confirmation-details",
		"confirmation-details",
		"Detail the order confirmation",
		"The order_confirmation message body must read exactly `Order <orderId> confirmed: <n> items, total <amount>, invoice <invoiceId>`, where n is the total quantity across the order's lines, amount is the order total in dollars with a leading '$' and two decimals (for example $21.40), and invoiceId is the id of that order's invoice. Each order is confirmed exactly once, to the customer's email.",
	),
	step(
		"through",
		"03-silver-tier",
		"silver-tier",
		"Add a silver tier",
		"Add a 'silver' customer tier with a 5% discount (gold stays 10%, standard 0%). accounts.register and accounts.setTier accept it; any other tier throws 'invalid_input'. The discount applies per line, rounded half-up in cents, before tax, identically on orders and their invoices.",
	),
	step(
		"through",
		"04-promo-codes",
		"promo-codes",
		"Accept promo codes",
		"Add CommerceOptions.promotions?: Record<string, number>, mapping a code to whole percentage points from 1 to 50; createCommerce throws 'invalid_input' for any other value. placeOrder accepts an optional promoCode, and an unknown code throws 'invalid_input'. A line's discount percentage becomes the tier percentage plus the promo percentage, rounded half-up per line before tax. The order records promoCode (absent when none was used), and its invoice must match the order's amounts exactly.",
	),
	step(
		"through",
		"05-bulk-discount",
		"bulk-discount",
		"Discount bulk lines",
		"A line with quantity 10 or more gets 5 extra discount percentage points, added to the tier and promo percentages. The combined percentage for a line is capped at 60. Apply this identically to orders and their invoices.",
	),
	step(
		"through",
		"06-cancellation",
		"cancellation",
		"Cancel orders",
		"Add orders.cancelOrder(orderId, at?): Order. Only a placed order can be cancelled; cancelling an order that is not placed throws 'invalid_state', and an unknown order throws 'not_found'. The order becomes status 'cancelled' with cancelledAt, its invoice becomes status 'void', and the customer receives one 'order_cancelled' message with body `Order <orderId> cancelled`. Other orders and invoices are unchanged.",
	),
	step(
		"through",
		"07-shipping",
		"shipping",
		"Charge regional shipping",
		"Add CommerceOptions.shipping?: { rates: Record<Region, number>; freeFromCents: number } with non-negative integer cents. When configured, an order charges shippingCents equal to its region's rate unless the sum of its discounted line amounts is at least freeFromCents, in which case shipping is 0. Shipping is taxed at the region's standard rate, rounded half-up separately from the lines, and included in taxCents and totalCents. Orders and invoices both expose shippingCents, which is 0 when shipping is not configured, and must match exactly.",
	),
	step(
		"through",
		"08-contract-prices",
		"contract-prices",
		"Honor contract prices",
		"Add accounts.setContractPrice(customerId, sku, priceCents | null) and accounts.contractPrice(customerId, sku): number | undefined. A contract price replaces the catalog price as the unit price for that customer's later orders; null removes it. Prices must be non-negative integers ('invalid_input') and unknown customers throw 'not_found'. Discounts, tax, and shipping apply to contract prices exactly as to catalog prices, invoices match their orders, and existing orders and invoices never change.",
	),
	step(
		"through",
		"09-refunds",
		"refunds",
		"Refund order lines",
		"Add orders.refundLine(orderId, sku, quantity, at?): Refund. Only placed orders can be refunded ('invalid_state'); the sku must be on the order ('invalid_input'), and quantity must be a positive integer no greater than the line's not-yet-refunded quantity ('invalid_input'). The refund amount is (line subtotal - line discount + line tax) x quantity / line quantity, rounded half-up; shipping is never refunded. The order lists its refunds ({ id, sku, quantity, amountCents, at }). billing.creditNotes(orderId) returns one credit note per refund ({ id, invoiceId, orderId, refundId, amountCents, at }). The customer receives a 'refund_issued' message `Refund of <amount> issued for order <orderId>`, with the amount formatted like the confirmation total. An order with refunds can no longer be cancelled ('invalid_state').",
	),
	step(
		"through",
		"10-order-tax-rounding",
		"order-tax-rounding",
		"Round tax per order",
		"Add CommerceOptions.taxRounding?: 'line' | 'order' (default 'line'). With 'order', an order's taxCents is the half-up rounding of the sum of its unrounded line taxes plus its unrounded shipping tax, instead of the sum of separately rounded amounts. Line taxCents values stay rounded per line, totalCents uses the order-level taxCents, invoices match their orders exactly, and refund amounts keep using line values.",
	),
	step(
		"through",
		"11-notification-channel",
		"notification-channel",
		"Send by the customer's channel",
		"Add accounts.setChannel(customerId, preference) where preference is { channel: 'email' } or { channel: 'sms'; phone: string }; sms requires a non-empty phone ('invalid_input'). Every message records its channel and is addressed to the customer's email or phone according to the channel the customer has at the moment the message is sent. The default channel is email, and messages already sent never change.",
	),
	step(
		"through",
		"12-statement",
		"statement",
		"Produce customer statements",
		"Add billing.statement(customerId): { invoices, creditNotes, balanceCents } listing the customer's invoices (including void ones) and credit notes in creation order. balanceCents is the sum of open invoice totals minus the sum of the customer's credit note amounts. An unknown customer gets an empty statement with balance 0. Everything returned is a copy.",
	),
];

const ELSEWHERE: readonly EvalStep[] = [
	step(
		"elsewhere",
		"01-catalog-search",
		"catalog-search",
		"Search the catalog",
		"Add catalog.search(query: { text?: string; category?: string }): Product[]. text matches product names case-insensitively as a substring after trimming; category matches exactly; omitted fields match everything. Results are sorted by sku and are copies.",
	),
	step(
		"elsewhere",
		"02-email-lookup",
		"email-lookup",
		"Look customers up by email",
		"Add accounts.findByEmail(email): Customer | undefined, matching trimmed emails case-insensitively. accounts.register stores emails trimmed and rejects an email that is already registered, compared case-insensitively, with 'conflict'.",
	),
	step(
		"elsewhere",
		"03-price-history",
		"price-history",
		"Track price changes",
		"Add catalog.updatePrice(sku, priceCents, at?) returning the updated product, and catalog.priceHistory(sku): { priceCents, at }[] beginning with the price at the time the product was added. Prices must be non-negative integers ('invalid_input'); unknown skus throw 'not_found'. Timestamps default to CommerceOptions.now. New orders use the current price; existing orders and invoices are unchanged.",
	),
	step(
		"elsewhere",
		"04-addresses",
		"addresses",
		"Store customer addresses",
		"Add accounts.addAddress(customerId, { line1, city, country }): Address, accounts.listAddresses(customerId), and accounts.setDefaultAddress(customerId, addressId). Address ids start with 'a'; fields are trimmed and required ('invalid_input'). A customer's first address is the default, and after setDefaultAddress exactly that address is the default. Unknown customers or addresses throw 'not_found'.",
	),
	step(
		"elsewhere",
		"05-wishlists",
		"wishlists",
		"Add wishlists",
		"Add a wishlists module exposed as commerce.wishlists with add(customerId, sku), remove(customerId, sku), and list(customerId): string[] listing skus in the order they were first added. Unknown customers, and unknown skus when adding, throw 'not_found'. Adding a sku already on the list and removing one that is absent change nothing.",
	),
	step(
		"elsewhere",
		"06-variants",
		"variants",
		"Add product variants",
		"Add catalog.addVariant(parentSku, { sku, name, priceCents }) and catalog.variants(parentSku). A variant is a product with parentSku set (absent on other products) that inherits its parent's category and taxClass. The parent must exist ('not_found') and must not itself be a variant ('invalid_input'); a sku already in the catalog throws 'conflict'. Variants appear in get, list, and search and can be ordered like any product.",
	),
	step(
		"elsewhere",
		"07-reviews",
		"reviews",
		"Collect product reviews",
		"Add a reviews module exposed as commerce.reviews with add({ customerId, sku, rating, text }): Review, forProduct(sku): Review[], and averageRating(sku): number | null. Ratings are integers from 1 to 5 ('invalid_input'); unknown customers or skus throw 'not_found'; a customer may review a sku once ('conflict'). averageRating is rounded to one decimal place and is null when a product has no reviews.",
	),
	step(
		"elsewhere",
		"08-discontinue",
		"discontinue",
		"Discontinue products",
		"Add catalog.discontinue(sku): Product. Products report discontinued (false until discontinued). Discontinued products stay readable through get and list, are excluded from search, and cannot be ordered: placeOrder throws 'invalid_state' for a discontinued sku. Discontinuing twice changes nothing; unknown skus throw 'not_found'. Existing orders are unchanged.",
	),
	step(
		"elsewhere",
		"09-bulk-import",
		"bulk-import",
		"Import products in bulk",
		"Add catalog.importProducts(inputs): Product[]. Validate every input with the same rules as catalog.add before adding any. A sku repeated within the batch or already in the catalog throws 'conflict', and invalid fields throw 'invalid_input'. On any error nothing is added. On success, return the added products in input order.",
	),
	step(
		"elsewhere",
		"10-deactivation",
		"deactivation",
		"Deactivate customers",
		"Customers report active (true when registered). Add accounts.deactivate(customerId): Customer, setting active to false; deactivating twice changes nothing and unknown customers throw 'not_found'. Deactivated customers cannot place orders ('invalid_state'). Their existing orders and invoices are unchanged, and other customers are unaffected.",
	),
	step(
		"elsewhere",
		"11-review-moderation",
		"review-moderation",
		"Moderate reviews and rank products",
		"Add reviews.hide(reviewId): Review and reviews.topRated(limit): { sku, averageRating, reviews }[]. Hidden reviews are excluded from forProduct, averageRating, and topRated, but still count as the customer's one review of that sku. topRated lists products with at least one visible review, sorted by average rating descending, then visible review count descending, then sku; limit must be a positive integer ('invalid_input'). Unknown review ids throw 'not_found'.",
	),
	step(
		"elsewhere",
		"12-account-merge",
		"account-merge",
		"Merge duplicate accounts",
		"Add accounts.merge(sourceId, targetId): Customer. Move the source's addresses to the target, keeping their ids. The target keeps its default address; if the target had none, the source's default becomes the target's default. The source is left with no addresses and is deactivated, and the target is returned. Merging a customer into itself throws 'invalid_input', an inactive source throws 'invalid_state', and unknown customers throw 'not_found'.",
	),
];

const debtSeed = { ...tree("base"), ...tree("debt") };
const cleanSeed = { ...tree("base"), ...tree("clean") };
const reference = tree("reference");

export const commerceMonolith: EvalTarget = {
	id: "commerce-monolith",
	title: "Commerce modular monolith",
	files: debtSeed,
	referenceFiles: reference,
	publicVerify: ["npm test"],
	steps: THROUGH_THE_DEBT,
};

export const commerceMonolithElsewhere: EvalTarget = {
	id: "commerce-monolith-elsewhere",
	title: "Commerce modular monolith",
	files: debtSeed,
	referenceFiles: reference,
	publicVerify: ["npm test"],
	steps: ELSEWHERE,
};

export const commerceMonolithClean: EvalTarget = {
	id: "commerce-monolith-clean",
	title: "Commerce modular monolith",
	files: cleanSeed,
	referenceFiles: reference,
	publicVerify: ["npm test"],
	steps: THROUGH_THE_DEBT,
};
