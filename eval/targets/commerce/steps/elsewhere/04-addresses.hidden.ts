test("addresses are validated, trimmed, isolated, and looked up by id", () => {
  const shop = subject.createCommerce({ now: () => 100 });
  const ann = shop.accounts.register({ name: "Ann", email: "ann@example.test", region: "US" });
  const bob = shop.accounts.register({ name: "Bob", email: "bob@example.test", region: "US" });
  const address = shop.accounts.addAddress(ann.id, { line1: " 3 Oak Ave ", city: " Boston ", country: "US" });
  assert.equal(address.city, "Boston");
  assert.match(address.id, /^a/);
  assert.deepEqual(shop.accounts.listAddresses(bob.id), []);
  assert.throws(() => shop.accounts.addAddress(ann.id, { line1: "x", city: " ", country: "US" }), (error: any) => error.code === "invalid_input");
  assert.throws(() => shop.accounts.setDefaultAddress(ann.id, "missing"), (error: any) => error.code === "not_found");
  assert.throws(() => shop.accounts.addAddress("missing", { line1: "x", city: "y", country: "US" }), (error: any) => error.code === "not_found");
});
