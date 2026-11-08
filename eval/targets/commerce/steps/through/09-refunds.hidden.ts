test("refunds are proportional, bounded by the line, and block cancellation", () => {
  const shop = subject.createCommerce({ now: () => 100 });
  shop.catalog.add({ sku: "mug", name: "Mug", priceCents: 999, category: "kitchen" });
  const customer = shop.accounts.register({ name: "Mo", email: "mo@example.test", region: "EU", tier: "gold" });
  const order = shop.orders.placeOrder({ customerId: customer.id, lines: [{ sku: "mug", quantity: 3 }] });
  assert.equal(shop.orders.refundLine(order.id, "mug", 2, 200).amountCents, 2157);
  assert.throws(() => shop.orders.refundLine(order.id, "mug", 2, 210), (error: any) => error.code === "invalid_input");
  assert.equal(shop.orders.refundLine(order.id, "mug", 1, 220).amountCents, 1079);
  assert.throws(() => shop.orders.refundLine(order.id, "mug", 1, 230), (error: any) => error.code === "invalid_input");
  assert.throws(() => shop.orders.refundLine(order.id, "cup", 1, 230), (error: any) => error.code === "invalid_input");
  assert.throws(() => shop.orders.cancelOrder(order.id, 240), (error: any) => error.code === "invalid_state");
  assert.equal(shop.billing.creditNotes(order.id).length, 2);

  const other = shop.orders.placeOrder({ customerId: customer.id, lines: [{ sku: "mug", quantity: 1 }] });
  shop.orders.cancelOrder(other.id, 250);
  assert.throws(() => shop.orders.refundLine(other.id, "mug", 1, 260), (error: any) => error.code === "invalid_state");
});
