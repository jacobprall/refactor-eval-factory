test("adds taxed regional shipping to orders and invoices", () => {
  const shipping = { rates: { US: 500, EU: 800, UK: 700 }, freeFromCents: 5000 };
  const shop = subject.createCommerce({ now: () => 100, shipping });
  shop.catalog.add({ sku: "pen", name: "Pen", priceCents: 1000, category: "office" });
  const customer = shop.accounts.register({ name: "Ann", email: "ann@example.test", region: "US" });
  const order = shop.orders.placeOrder({ customerId: customer.id, lines: [{ sku: "pen", quantity: 2 }] });
  assert.equal(order.shippingCents, 500);
  assert.equal(order.taxCents, 175);
  assert.equal(order.totalCents, 2675);
  const invoice = shop.billing.invoiceForOrder(order.id);
  assert.equal(invoice?.shippingCents, 500);
  assert.equal(invoice?.totalCents, 2675);
});
