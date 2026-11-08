test("imports a batch of products", () => {
  const shop = subject.createCommerce({ now: () => 100 });
  const added = shop.catalog.importProducts([
    { sku: "pen", name: "Pen", priceCents: 1000, category: "office" },
    { sku: "mug", name: "Mug", priceCents: 900, category: "kitchen" },
  ]);
  assert.deepEqual(added.map((product: any) => product.sku), ["pen", "mug"]);
  assert.deepEqual(shop.catalog.list().map((product: any) => product.sku), ["mug", "pen"]);
});
