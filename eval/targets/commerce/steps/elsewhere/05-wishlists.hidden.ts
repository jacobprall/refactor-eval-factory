test("wishlists validate customers and products and are isolated", () => {
  const shop = subject.createCommerce({ now: () => 100 });
  shop.catalog.add({ sku: "pen", name: "Pen", priceCents: 1000, category: "office" });
  const ann = shop.accounts.register({ name: "Ann", email: "ann@example.test", region: "US" });
  const bob = shop.accounts.register({ name: "Bob", email: "bob@example.test", region: "US" });
  shop.wishlists.add(ann.id, "pen");
  assert.deepEqual(shop.wishlists.list(bob.id), []);
  shop.wishlists.remove(bob.id, "pen");
  assert.deepEqual(shop.wishlists.list(ann.id), ["pen"]);
  assert.throws(() => shop.wishlists.add(ann.id, "missing"), (error: any) => error.code === "not_found");
  assert.throws(() => shop.wishlists.list("missing"), (error: any) => error.code === "not_found");
});
