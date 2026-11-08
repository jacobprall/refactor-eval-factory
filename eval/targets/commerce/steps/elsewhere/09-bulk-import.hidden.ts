test("a failed import adds nothing", () => {
  const shop = subject.createCommerce({ now: () => 100 });
  shop.catalog.add({ sku: "pen", name: "Pen", priceCents: 1000, category: "office" });
  const lamp = { sku: "lamp", name: "Lamp", priceCents: 2000, category: "home" };
  assert.throws(() => shop.catalog.importProducts([lamp, { ...lamp, name: "Lamp 2" }]), (error: any) => error.code === "conflict");
  assert.throws(() => shop.catalog.importProducts([lamp, { sku: "pen", name: "Pen", priceCents: 1, category: "office" }]), (error: any) => error.code === "conflict");
  assert.throws(() => shop.catalog.importProducts([lamp, { sku: "cup", name: "Cup", priceCents: -1, category: "kitchen" }]), (error: any) => error.code === "invalid_input");
  assert.deepEqual(shop.catalog.list().map((product: any) => product.sku), ["pen"]);
});
