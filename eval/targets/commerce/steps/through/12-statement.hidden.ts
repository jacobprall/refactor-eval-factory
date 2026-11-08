test("statements are per customer, empty for strangers, and defensive", () => {
  const shop = subject.createCommerce({ now: () => 100 });
  shop.catalog.add({ sku: "pen", name: "Pen", priceCents: 1000, category: "office" });
  const ann = shop.accounts.register({ name: "Ann", email: "ann@example.test", region: "US" });
  const bob = shop.accounts.register({ name: "Bob", email: "bob@example.test", region: "US" });
  shop.orders.placeOrder({ customerId: ann.id, lines: [{ sku: "pen", quantity: 1 }] });
  shop.orders.placeOrder({ customerId: bob.id, lines: [{ sku: "pen", quantity: 2 }] });
  assert.deepEqual(shop.billing.statement("missing"), { invoices: [], creditNotes: [], balanceCents: 0 });
  const statement = shop.billing.statement(ann.id);
  assert.equal(statement.balanceCents, 1070);
  assert.equal(statement.invoices.length, 1);
  statement.invoices[0].totalCents = 0;
  assert.equal(shop.billing.statement(ann.id).balanceCents, 1070);
  assert.equal(shop.billing.statement(bob.id).balanceCents, 2140);
});
