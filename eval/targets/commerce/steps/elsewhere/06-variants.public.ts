test("variants inherit their parent's category and are listed under it", () => {
  const shop = subject.createCommerce({ now: () => 100 });
  shop.catalog.add({ sku: "pen", name: "Pen", priceCents: 1000, category: "office" });
  shop.catalog.addVariant("pen", { sku: "pen-blue", name: "Blue Pen", priceCents: 1100 });
  const variant = shop.catalog.get("pen-blue");
  assert.equal(variant.parentSku, "pen");
  assert.equal(variant.category, "office");
  assert.equal(shop.catalog.get("pen").parentSku, undefined);
  assert.deepEqual(shop.catalog.variants("pen").map((product: any) => product.sku), ["pen-blue"]);
});
