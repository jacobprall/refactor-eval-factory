import type { AccountDirectory } from "../accounts/index.ts";
import type { CatalogRepository } from "../catalog/index.ts";

export type Wishlists = ReturnType<typeof createWishlists>;

export function createWishlists(deps: { accounts: AccountDirectory; catalog: CatalogRepository }) {
  const lists = new Map<string, string[]>();
  return {
    add(customerId: string, sku: string): string[] {
      deps.accounts.get(customerId);
      deps.catalog.get(sku);
      const list = lists.get(customerId) ?? [];
      if (!list.includes(sku)) lists.set(customerId, [...list, sku]);
      return [...(lists.get(customerId) ?? [])];
    },
    remove(customerId: string, sku: string): string[] {
      deps.accounts.get(customerId);
      lists.set(
        customerId,
        (lists.get(customerId) ?? []).filter((candidate) => candidate !== sku),
      );
      return [...(lists.get(customerId) ?? [])];
    },
    list(customerId: string): string[] {
      deps.accounts.get(customerId);
      return [...(lists.get(customerId) ?? [])];
    },
  };
}
