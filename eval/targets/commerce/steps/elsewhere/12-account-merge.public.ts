test("merging moves addresses to the target and deactivates the source", () => {
  const shop = subject.createCommerce({ now: () => 100 });
  const source = shop.accounts.register({ name: "Old", email: "old@example.test", region: "US" });
  const target = shop.accounts.register({ name: "New", email: "new@example.test", region: "US" });
  shop.accounts.addAddress(source.id, { line1: "1 Old Rd", city: "Oldtown", country: "US" });
  const home = shop.accounts.addAddress(target.id, { line1: "2 New Rd", city: "Newtown", country: "US" });
  assert.equal(shop.accounts.merge(source.id, target.id).id, target.id);
  const addresses = shop.accounts.listAddresses(target.id);
  assert.equal(addresses.length, 2);
  assert.deepEqual(addresses.filter((address: any) => address.isDefault).map((address: any) => address.id), [home.id]);
  assert.equal(shop.accounts.get(source.id).active, false);
});
