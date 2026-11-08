test("taxes reduced-class products at the regional reduced rate on orders and invoices", () => {
  const shop = subject.createCommerce({ now: () => 100 });
  shop.catalog.add({ sku: "book", name: "Book", priceCents: 2000, category: "media", taxClass: "reduced" });
  shop.catalog.add({ sku: "pen", name: "Pen", priceCents: 1000, category: "office" });
  const customer = shop.accounts.register({ name: "Eve", email: "eve@example.test", region: "EU" });
  const order = shop.orders.placeOrder({ customerId: customer.id, lines: [{ sku: "book", quantity: 1 }, { sku: "pen", quantity: 1 }] });
  assert.equal(order.taxCents, 300);
  assert.equal(order.totalCents, 3300);
  assert.equal(shop.billing.invoiceForOrder(order.id)?.totalCents, 3300);
});
