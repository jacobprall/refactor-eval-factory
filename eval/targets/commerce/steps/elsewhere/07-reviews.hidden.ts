test("reviews validate ratings, allow one per customer and product, and round averages", () => {
  const shop = subject.createCommerce({ now: () => 100 });
  shop.catalog.add({ sku: "pen", name: "Pen", priceCents: 1000, category: "office" });
  shop.catalog.add({ sku: "mug", name: "Mug", priceCents: 900, category: "kitchen" });
  const ids = ["a", "b", "c"].map((name) => shop.accounts.register({ name, email: `${name}@example.test`, region: "US" }).id);
  assert.equal(shop.reviews.averageRating("mug"), null);
  for (const [index, rating] of [4, 5, 5].entries()) shop.reviews.add({ customerId: ids[index], sku: "pen", rating, text: "ok" });
  assert.equal(shop.reviews.averageRating("pen"), 4.7);
  assert.throws(() => shop.reviews.add({ customerId: ids[0], sku: "pen", rating: 3, text: "again" }), (error: any) => error.code === "conflict");
  assert.throws(() => shop.reviews.add({ customerId: ids[0], sku: "mug", rating: 6, text: "x" }), (error: any) => error.code === "invalid_input");
  assert.throws(() => shop.reviews.add({ customerId: ids[0], sku: "mug", rating: 0, text: "x" }), (error: any) => error.code === "invalid_input");
  assert.throws(() => shop.reviews.add({ customerId: ids[0], sku: "missing", rating: 3, text: "x" }), (error: any) => error.code === "not_found");
});
