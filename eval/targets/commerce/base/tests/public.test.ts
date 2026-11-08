import test from "node:test";
import assert from "node:assert/strict";
import * as subject from "../src/index.ts";

test("places an order, invoices it, and confirms it", () => {
  const shop = subject.createCommerce({ now: () => 100 });
  shop.catalog.add({ sku: "pen", name: "Pen", priceCents: 1000, category: "office" });
  const customer = shop.accounts.register({ name: "Ann", email: "ann@example.test", region: "US" });
  const order = shop.orders.placeOrder({ customerId: customer.id, lines: [{ sku: "pen", quantity: 2 }] });
  assert.equal(order.subtotalCents, 2000);
  assert.equal(order.taxCents, 140);
  assert.equal(order.totalCents, 2140);
  assert.equal(shop.billing.invoiceForOrder(order.id)?.totalCents, 2140);
  assert.deepEqual(
    shop.notifications.outbox().map((message) => message.template),
    ["order_confirmation"],
  );
});

test("gold customers get ten percent off each line before tax", () => {
  const shop = subject.createCommerce({ now: () => 100 });
  shop.catalog.add({ sku: "lamp", name: "Lamp", priceCents: 1000, category: "home" });
  const customer = shop.accounts.register({ name: "Bo", email: "bo@example.test", region: "EU", tier: "gold" });
  const order = shop.orders.placeOrder({ customerId: customer.id, lines: [{ sku: "lamp", quantity: 1 }] });
  assert.equal(order.discountCents, 100);
  assert.equal(order.taxCents, 180);
  assert.equal(order.totalCents, 1080);
  assert.deepEqual(shop.billing.invoiceForOrder(order.id)?.lines, order.lines);
});
