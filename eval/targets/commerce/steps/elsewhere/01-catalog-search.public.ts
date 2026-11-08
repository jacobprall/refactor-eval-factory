test("searches the catalog by name text and category", () => {
  const shop = subject.createCommerce({ now: () => 100 });
  shop.catalog.add({ sku: "pen", name: "Blue Pen", priceCents: 1000, category: "office" });
  shop.catalog.add({ sku: "notebook", name: "Notebook", priceCents: 700, category: "office" });
  shop.catalog.add({ sku: "mug", name: "Mug", priceCents: 900, category: "kitchen" });
  assert.deepEqual(shop.catalog.search({ text: " NOTE " }).map((product: any) => product.sku), ["notebook"]);
  assert.deepEqual(shop.catalog.search({ category: "office" }).map((product: any) => product.sku), ["notebook", "pen"]);
});
