test("order-level tax rounding rounds the summed tax once", () => {
  const shop = subject.createCommerce({ now: () => 100, taxRounding: "order" });
  for (const sku of ["a", "b", "c"]) shop.catalog.add({ sku, name: sku.toUpperCase(), priceCents: 5, category: "small" });
  const customer = shop.accounts.register({ name: "Ann", email: "ann@example.test", region: "US" });
  const order = shop.orders.placeOrder({
    customerId: customer.id,
    lines: [{ sku: "a", quantity: 1 }, { sku: "b", quantity: 1 }, { sku: "c", quantity: 1 }],
  });
  assert.deepEqual(order.lines.map((line: any) => line.taxCents), [0, 0, 0]);
  assert.equal(order.taxCents, 1);
  assert.equal(order.totalCents, 16);
  assert.equal(shop.billing.invoiceForOrder(order.id)?.taxCents, 1);
});
