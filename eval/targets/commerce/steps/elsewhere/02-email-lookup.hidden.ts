test("unknown emails return undefined and stored emails are trimmed", () => {
  const shop = subject.createCommerce({ now: () => 100 });
  const dan = shop.accounts.register({ name: "Dan", email: "  dan@example.test  ", region: "UK" });
  assert.equal(shop.accounts.get(dan.id).email, "dan@example.test");
  assert.equal(shop.accounts.findByEmail("nobody@example.test"), undefined);
  assert.equal(shop.accounts.findByEmail("DAN@example.test")?.name, "Dan");
});
