test("customers keep addresses with exactly one default", () => {
  const shop = subject.createCommerce({ now: () => 100 });
  const customer = shop.accounts.register({ name: "Ann", email: "ann@example.test", region: "US" });
  const home = shop.accounts.addAddress(customer.id, { line1: "1 Main St", city: "Springfield", country: "US" });
  const work = shop.accounts.addAddress(customer.id, { line1: "2 Elm St", city: "Shelbyville", country: "US" });
  assert.equal(home.isDefault, true);
  assert.equal(work.isDefault, false);
  shop.accounts.setDefaultAddress(customer.id, work.id);
  assert.deepEqual(shop.accounts.listAddresses(customer.id).map((address: any) => address.isDefault), [false, true]);
});
