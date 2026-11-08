test("combined discounts are capped at sixty percent and nine units get no bulk discount", () => {
  const shop = subject.createCommerce({ now: () => 100, promotions: { HALF: 50 } });
  shop.catalog.add({ sku: "clip", name: "Clip", priceCents: 100, category: "office" });
  shop.catalog.add({ sku: "tack", name: "Tack", priceCents: 100, category: "office" });
  const customer = shop.accounts.register({ name: "Hal", email: "hal@example.test", region: "US", tier: "gold" });
  const order = shop.orders.placeOrder({
    customerId: customer.id,
    lines: [{ sku: "clip", quantity: 10 }, { sku: "tack", quantity: 9 }],
    promoCode: "HALF",
  });
  assert.deepEqual(order.lines.map((line: any) => line.discountCents), [600, 540]);
  assert.equal(order.totalCents, 813);
  assert.deepEqual(shop.billing.invoiceForOrder(order.id)?.lines, order.lines);
});
