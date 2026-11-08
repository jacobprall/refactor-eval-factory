test("customers who choose sms receive messages by phone", () => {
  const shop = subject.createCommerce({ now: () => 100 });
  shop.catalog.add({ sku: "pen", name: "Pen", priceCents: 1000, category: "office" });
  const customer = shop.accounts.register({ name: "Ann", email: "ann@example.test", region: "US" });
  shop.accounts.setChannel(customer.id, { channel: "sms", phone: "+15550100" });
  shop.orders.placeOrder({ customerId: customer.id, lines: [{ sku: "pen", quantity: 1 }] });
  const [message] = shop.notifications.outbox();
  assert.equal(message.channel, "sms");
  assert.equal(message.to, "+15550100");
});
