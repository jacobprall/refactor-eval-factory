test("lists the top-rated products", () => {
  const shop = subject.createCommerce({ now: () => 100 });
  shop.catalog.add({ sku: "pen", name: "Pen", priceCents: 1000, category: "office" });
  shop.catalog.add({ sku: "mug", name: "Mug", priceCents: 900, category: "kitchen" });
  const ann = shop.accounts.register({ name: "Ann", email: "ann@example.test", region: "US" });
  shop.reviews.add({ customerId: ann.id, sku: "pen", rating: 5, text: "Great" });
  shop.reviews.add({ customerId: ann.id, sku: "mug", rating: 3, text: "Fine" });
  assert.deepEqual(shop.reviews.topRated(1), [{ sku: "pen", averageRating: 5, reviews: 1 }]);
});
