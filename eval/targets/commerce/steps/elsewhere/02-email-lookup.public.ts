test("finds customers by email and rejects duplicate emails", () => {
  const shop = subject.createCommerce({ now: () => 100 });
  const ann = shop.accounts.register({ name: "Ann", email: "ann@example.test", region: "US" });
  assert.equal(shop.accounts.findByEmail(" ANN@example.test ")?.id, ann.id);
  assert.throws(
    () => shop.accounts.register({ name: "Ann 2", email: "Ann@Example.test", region: "US" }),
    (error: any) => error.code === "conflict",
  );
});
