test("customers review products and products report an average rating", () => {
  const shop = subject.createCommerce({ now: () => 100 });
  shop.catalog.add({ sku: "pen", name: "Pen", priceCents: 1000, category: "office" });
  const ann = shop.accounts.register({ name: "Ann", email: "ann@example.test", region: "US" });
  const bob = shop.accounts.register({ name: "Bob", email: "bob@example.test", region: "US" });
  shop.reviews.add({ customerId: ann.id, sku: "pen", rating: 5, text: "Great" });
  shop.reviews.add({ customerId: bob.id, sku: "pen", rating: 4, text: "Good" });
  assert.equal(shop.reviews.forProduct("pen").length, 2);
  assert.equal(shop.reviews.averageRating("pen"), 4.5);
});
