test("tier changes apply to later orders and unknown tiers are rejected", () => {
  const shop = subject.createCommerce({ now: () => 100 });
  shop.catalog.add({ sku: "vase", name: "Vase", priceCents: 1990, category: "home" });
  const customer = shop.accounts.register({ name: "Rae", email: "rae@example.test", region: "EU" });
  shop.accounts.setTier(customer.id, "silver");
  const order = shop.orders.placeOrder({ customerId: customer.id, lines: [{ sku: "vase", quantity: 1 }] });
  assert.equal(order.discountCents, 100);
  assert.equal(order.taxCents, 378);
  assert.equal(order.totalCents, 2268);
  assert.deepEqual(shop.billing.invoiceForOrder(order.id)?.lines, order.lines);
  assert.throws(() => shop.accounts.setTier(customer.id, "platinum" as any), (error: any) => error.code === "invalid_input");
  assert.throws(
    () => shop.accounts.register({ name: "B", email: "b@example.test", region: "US", tier: "bronze" as any }),
    (error: any) => error.code === "invalid_input",
  );
});
