test("confirms each order exactly once with its own invoice", () => {
  const shop = subject.createCommerce({ now: () => 100 });
  shop.catalog.add({ sku: "pen", name: "Pen", priceCents: 1000, category: "office" });
  shop.catalog.add({ sku: "ink", name: "Ink", priceCents: 500, category: "office" });
  const customer = shop.accounts.register({ name: "Cy", email: "cy@example.test", region: "US" });
  const first = shop.orders.placeOrder({ customerId: customer.id, lines: [{ sku: "pen", quantity: 1 }] });
  const second = shop.orders.placeOrder({ customerId: customer.id, lines: [{ sku: "pen", quantity: 1 }, { sku: "ink", quantity: 2 }] });
  const outbox = shop.notifications.outbox();
  assert.equal(outbox.length, 2);
  assert.equal(outbox[0].body, `Order ${first.id} confirmed: 1 items, total $10.70, invoice ${shop.billing.invoiceForOrder(first.id)?.id}`);
  assert.equal(outbox[1].body, `Order ${second.id} confirmed: 3 items, total $21.40, invoice ${shop.billing.invoiceForOrder(second.id)?.id}`);
  assert.notEqual(shop.billing.invoiceForOrder(first.id)?.id, shop.billing.invoiceForOrder(second.id)?.id);
});
