test("an empty query lists everything in sku order and results are copies", () => {
  const shop = subject.createCommerce({ now: () => 100 });
  shop.catalog.add({ sku: "pen", name: "Blue Pen", priceCents: 1000, category: "office" });
  shop.catalog.add({ sku: "mug", name: "Mug", priceCents: 900, category: "kitchen" });
  assert.deepEqual(shop.catalog.search({}).map((product: any) => product.sku), ["mug", "pen"]);
  assert.deepEqual(shop.catalog.search({ text: "pen", category: "kitchen" }), []);
  const [first] = shop.catalog.search({ text: "mug" });
  first.name = "Changed";
  assert.equal(shop.catalog.get("mug").name, "Mug");
});
