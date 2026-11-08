test("channel choice applies at send time and sms requires a phone", () => {
  const shop = subject.createCommerce({ now: () => 100 });
  shop.catalog.add({ sku: "pen", name: "Pen", priceCents: 1000, category: "office" });
  const customer = shop.accounts.register({ name: "Ann", email: "ann@example.test", region: "US" });
  const first = shop.orders.placeOrder({ customerId: customer.id, lines: [{ sku: "pen", quantity: 1 }] });
  shop.accounts.setChannel(customer.id, { channel: "sms", phone: "+15550100" });
  shop.orders.cancelOrder(first.id, 200);
  shop.accounts.setChannel(customer.id, { channel: "email" });
  shop.orders.placeOrder({ customerId: customer.id, lines: [{ sku: "pen", quantity: 1 }] });
  assert.deepEqual(
    shop.notifications.outbox().map((message: any) => [message.channel, message.to]),
    [
      ["email", "ann@example.test"],
      ["sms", "+15550100"],
      ["email", "ann@example.test"],
    ],
  );
  assert.throws(() => shop.accounts.setChannel(customer.id, { channel: "sms", phone: " " }), (error: any) => error.code === "invalid_input");
});
