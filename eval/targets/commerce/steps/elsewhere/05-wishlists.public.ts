test("customers keep a wishlist of products", () => {
  const shop = subject.createCommerce({ now: () => 100 });
  shop.catalog.add({ sku: "pen", name: "Pen", priceCents: 1000, category: "office" });
  shop.catalog.add({ sku: "mug", name: "Mug", priceCents: 900, category: "kitchen" });
  const customer = shop.accounts.register({ name: "Ann", email: "ann@example.test", region: "US" });
  shop.wishlists.add(customer.id, "pen");
  shop.wishlists.add(customer.id, "mug");
  shop.wishlists.add(customer.id, "pen");
  assert.deepEqual(shop.wishlists.list(customer.id), ["pen", "mug"]);
  shop.wishlists.remove(customer.id, "pen");
  assert.deepEqual(shop.wishlists.list(customer.id), ["mug"]);
});
