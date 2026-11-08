test("hidden reviews drop out of ratings but still count as the customer's review", () => {
  const shop = subject.createCommerce({ now: () => 100 });
  for (const sku of ["pen", "mug", "cup"]) shop.catalog.add({ sku, name: sku, priceCents: 100, category: "misc" });
  const [ann, bob] = ["ann", "bob"].map((name) => shop.accounts.register({ name, email: `${name}@example.test`, region: "US" }));
  const penReview = shop.reviews.add({ customerId: ann.id, sku: "pen", rating: 5, text: "Great" });
  shop.reviews.add({ customerId: ann.id, sku: "mug", rating: 4, text: "Good" });
  shop.reviews.add({ customerId: bob.id, sku: "mug", rating: 4, text: "Good" });
  shop.reviews.add({ customerId: ann.id, sku: "cup", rating: 4, text: "Good" });
  shop.reviews.hide(penReview.id);
  assert.equal(shop.reviews.averageRating("pen"), null);
  assert.deepEqual(shop.reviews.forProduct("pen"), []);
  assert.deepEqual(shop.reviews.topRated(5).map((entry: any) => entry.sku), ["mug", "cup"]);
  assert.throws(() => shop.reviews.add({ customerId: ann.id, sku: "pen", rating: 4, text: "again" }), (error: any) => error.code === "conflict");
  assert.throws(() => shop.reviews.topRated(0), (error: any) => error.code === "invalid_input");
  assert.throws(() => shop.reviews.hide("missing"), (error: any) => error.code === "not_found");
});
