test("a statement nets open invoices against credit notes", () => {
  const shop = subject.createCommerce({ now: () => 100 });
  shop.catalog.add({ sku: "pen", name: "Pen", priceCents: 1000, category: "office" });
  const customer = shop.accounts.register({ name: "Ann", email: "ann@example.test", region: "US" });
  const kept = shop.orders.placeOrder({ customerId: customer.id, lines: [{ sku: "pen", quantity: 2 }] });
  const cancelled = shop.orders.placeOrder({ customerId: customer.id, lines: [{ sku: "pen", quantity: 1 }] });
  shop.orders.cancelOrder(cancelled.id, 200);
  shop.orders.refundLine(kept.id, "pen", 1, 300);
  const statement = shop.billing.statement(customer.id);
  assert.equal(statement.invoices.length, 2);
  assert.equal(statement.creditNotes.length, 1);
  assert.equal(statement.balanceCents, 1070);
});
