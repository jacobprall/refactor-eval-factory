test("price updates validate input, default to now, and leave existing orders alone", () => {
  const shop = subject.createCommerce({ now: () => 100 });
  shop.catalog.add({ sku: "pen", name: "Pen", priceCents: 1000, category: "office" });
  const customer = shop.accounts.register({ name: "Ann", email: "ann@example.test", region: "US" });
  const order = shop.orders.placeOrder({ customerId: customer.id, lines: [{ sku: "pen", quantity: 1 }] });
  shop.catalog.updatePrice("pen", 1500);
  assert.equal(shop.catalog.priceHistory("pen").at(-1)?.at, 100);
  assert.equal(shop.orders.getOrder(order.id).lines[0].unitPriceCents, 1000);
  assert.equal(shop.billing.invoiceForOrder(order.id)?.totalCents, 1070);
  assert.throws(() => shop.catalog.updatePrice("pen", -5, 200), (error: any) => error.code === "invalid_input");
  assert.throws(() => shop.catalog.updatePrice("missing", 5, 200), (error: any) => error.code === "not_found");
  assert.throws(() => shop.catalog.priceHistory("missing"), (error: any) => error.code === "not_found");
});
