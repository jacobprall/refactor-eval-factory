test("contract prices compose with discounts, can be removed, and never rewrite history", () => {
  const shop = subject.createCommerce({ now: () => 100 });
  shop.catalog.add({ sku: "pen", name: "Pen", priceCents: 1000, category: "office" });
  const customer = shop.accounts.register({ name: "Ann", email: "ann@example.test", region: "US" });
  shop.accounts.setContractPrice(customer.id, "pen", 800);
  const first = shop.orders.placeOrder({ customerId: customer.id, lines: [{ sku: "pen", quantity: 1 }] });
  shop.accounts.setContractPrice(customer.id, "pen", null);
  assert.equal(shop.accounts.contractPrice(customer.id, "pen"), undefined);
  const second = shop.orders.placeOrder({ customerId: customer.id, lines: [{ sku: "pen", quantity: 1 }] });
  assert.equal(second.lines[0].unitPriceCents, 1000);
  assert.equal(shop.orders.getOrder(first.id).totalCents, 856);
  assert.equal(shop.billing.invoiceForOrder(first.id)?.totalCents, 856);

  const gold = shop.accounts.register({ name: "Gia", email: "gia@example.test", region: "EU", tier: "gold" });
  shop.accounts.setContractPrice(gold.id, "pen", 500);
  const discounted = shop.orders.placeOrder({ customerId: gold.id, lines: [{ sku: "pen", quantity: 2 }] });
  assert.equal(discounted.totalCents, 1080);
  assert.deepEqual(shop.billing.invoiceForOrder(discounted.id)?.lines, discounted.lines);
  assert.throws(() => shop.accounts.setContractPrice(gold.id, "pen", -1), (error: any) => error.code === "invalid_input");
  assert.throws(() => shop.accounts.setContractPrice("missing", "pen", 5), (error: any) => error.code === "not_found");
});
