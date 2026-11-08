test("merging into an empty target keeps the source default and guards bad merges", () => {
  const shop = subject.createCommerce({ now: () => 100 });
  const source = shop.accounts.register({ name: "Old", email: "old@example.test", region: "US" });
  const target = shop.accounts.register({ name: "New", email: "new@example.test", region: "US" });
  const moved = shop.accounts.addAddress(source.id, { line1: "1 Old Rd", city: "Oldtown", country: "US" });
  shop.accounts.merge(source.id, target.id);
  assert.deepEqual(
    shop.accounts.listAddresses(target.id).map((address: any) => [address.id, address.isDefault]),
    [[moved.id, true]],
  );
  assert.deepEqual(shop.accounts.listAddresses(source.id), []);
  assert.throws(() => shop.accounts.merge(target.id, target.id), (error: any) => error.code === "invalid_input");
  assert.throws(() => shop.accounts.merge(source.id, target.id), (error: any) => error.code === "invalid_state");
  assert.throws(() => shop.accounts.merge("missing", target.id), (error: any) => error.code === "not_found");
});
