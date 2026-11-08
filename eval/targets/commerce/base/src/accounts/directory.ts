import { fail, requireOneOf, requireText } from "../shared/index.ts";
import type { Customer, NewCustomer, Region, Tier } from "./types.ts";

const REGIONS: readonly Region[] = ["US", "EU", "UK"];
const TIERS: readonly Tier[] = ["standard", "gold"];

export type AccountDirectory = ReturnType<typeof createAccountDirectory>;

export function createAccountDirectory() {
  const customers = new Map<string, Customer>();
  let lastId = 0;

  const find = (id: string): Customer => {
    const customer = customers.get(id);
    if (!customer) fail("not_found", `customer ${id} not found`);
    return customer;
  };

  return {
    register(input: NewCustomer): Customer {
      const customer: Customer = {
        id: `c${++lastId}`,
        name: requireText(input.name, "name"),
        email: requireText(input.email, "email"),
        region: requireOneOf(input.region, REGIONS, "region"),
        tier: requireOneOf(input.tier ?? "standard", TIERS, "tier"),
      };
      customers.set(customer.id, customer);
      return { ...customer };
    },

    get(id: string): Customer {
      return { ...find(id) };
    },

    list(): Customer[] {
      return [...customers.values()].map((customer) => ({ ...customer }));
    },

    setTier(id: string, tier: Tier): Customer {
      const customer = find(id);
      customer.tier = requireOneOf(tier, TIERS, "tier");
      return { ...customer };
    },
  };
}
