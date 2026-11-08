test("a customer's contract price replaces the catalog price", () => {
  const shop = subject.createCommerce({ now: () => 100 });
  shop.catalog.add({ sku: "pen", name: "Pen", priceCents: 1000, category: "office" });
  const customer = shop.accounts.register({ name: "Ann", email: "ann@example.test", region: "US" });
  shop.accounts.setContractPrice(customer.id, "pen", 800);
  assert.equal(shop.accounts.contractPrice(customer.id, "pen"), 800);
  const order = shop.orders.placeOrder({ customerId: customer.id, lines: [{ sku: "pen", quantity: 1 }] });
  assert.equal(order.lines[0].unitPriceCents, 800);
  assert.equal(order.totalCents, 856);
  const invoice = shop.billing.invoiceForOrder(order.id);
  assert.equal(invoice?.lines[0].unitPriceCents, 800);
  assert.equal(invoice?.totalCents, 856);
});
