test("a promo code adds percentage points to the line discount on orders and invoices", () => {
  const shop = subject.createCommerce({ now: () => 100, promotions: { SAVE10: 10 } });
  shop.catalog.add({ sku: "pen", name: "Pen", priceCents: 1000, category: "office" });
  const customer = shop.accounts.register({ name: "Ann", email: "ann@example.test", region: "US" });
  const order = shop.orders.placeOrder({ customerId: customer.id, lines: [{ sku: "pen", quantity: 2 }], promoCode: "SAVE10" });
  assert.equal(order.discountCents, 200);
  assert.equal(order.taxCents, 126);
  assert.equal(order.totalCents, 1926);
  assert.equal(order.promoCode, "SAVE10");
  assert.equal(shop.billing.invoiceForOrder(order.id)?.totalCents, 1926);
});
