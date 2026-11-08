test("refunding part of a line records the refund, credits the invoice, and notifies", () => {
  const shop = subject.createCommerce({ now: () => 100 });
  shop.catalog.add({ sku: "pen", name: "Pen", priceCents: 1000, category: "office" });
  const customer = shop.accounts.register({ name: "Ann", email: "ann@example.test", region: "US" });
  const order = shop.orders.placeOrder({ customerId: customer.id, lines: [{ sku: "pen", quantity: 2 }] });
  const refund = shop.orders.refundLine(order.id, "pen", 1, 300);
  assert.equal(refund.amountCents, 1070);
  assert.deepEqual(
    shop.orders.getOrder(order.id).refunds.map((entry: any) => [entry.sku, entry.quantity, entry.amountCents]),
    [["pen", 1, 1070]],
  );
  const [note] = shop.billing.creditNotes(order.id);
  assert.equal(note.amountCents, 1070);
  assert.equal(note.refundId, refund.id);
  const last = shop.notifications.outbox().at(-1);
  assert.equal(last?.template, "refund_issued");
  assert.equal(last?.body, `Refund of $10.70 issued for order ${order.id}`);
});
