test("promo codes stack with tiers and invalid promotions are rejected", () => {
  const shop = subject.createCommerce({ now: () => 100, promotions: { SPRING: 15 } });
  shop.catalog.add({ sku: "lamp", name: "Lamp", priceCents: 1000, category: "home" });
  const customer = shop.accounts.register({ name: "Gil", email: "gil@example.test", region: "EU", tier: "gold" });
  const order = shop.orders.placeOrder({ customerId: customer.id, lines: [{ sku: "lamp", quantity: 1 }], promoCode: "SPRING" });
  assert.equal(order.discountCents, 250);
  assert.equal(order.totalCents, 900);
  assert.deepEqual(shop.billing.invoiceForOrder(order.id)?.lines, order.lines);
  const plain = shop.orders.placeOrder({ customerId: customer.id, lines: [{ sku: "lamp", quantity: 1 }] });
  assert.equal(plain.totalCents, 1080);
  assert.equal(plain.promoCode, undefined);
  assert.throws(
    () => shop.orders.placeOrder({ customerId: customer.id, lines: [{ sku: "lamp", quantity: 1 }], promoCode: "NOPE" }),
    (error: any) => error.code === "invalid_input",
  );
  assert.throws(() => subject.createCommerce({ promotions: { BAD: 80 } }), (error: any) => error.code === "invalid_input");
});
