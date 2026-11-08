import { createIdGenerator, fail, requireNonNegativeInt, requireOneOf, requireText } from "../shared/index.ts";
import type { Address, ChannelPreference, Customer, NewCustomer, Region, Tier } from "./types.ts";

const REGIONS: readonly Region[] = ["US", "EU", "UK"];
const TIERS: readonly Tier[] = ["standard", "silver", "gold"];

export type AccountDirectory = ReturnType<typeof createAccountDirectory>;

export function createAccountDirectory() {
  const customers = new Map<string, Customer>();
  const addresses = new Map<string, Address[]>();
  const contracts = new Map<string, Map<string, number>>();
  const customerId = createIdGenerator("c");
  const addressId = createIdGenerator("a");

  const require = (id: string): Customer => {
    const customer = customers.get(id);
    if (!customer) fail("not_found", `customer ${id} not found`);
    return customer;
  };
  const copy = (customer: Customer): Customer => ({ ...customer });
  const findByEmail = (email: string): Customer | undefined => {
    const wanted = email.trim().toLowerCase();
    return [...customers.values()].find((customer) => customer.email.toLowerCase() === wanted);
  };

  return {
    register(input: NewCustomer): Customer {
      const email = requireText(input.email, "email");
      if (findByEmail(email)) fail("conflict", `email ${email} is already registered`);
      const customer: Customer = {
        id: customerId(),
        name: requireText(input.name, "name"),
        email,
        region: requireOneOf(input.region, REGIONS, "region"),
        tier: requireOneOf(input.tier ?? "standard", TIERS, "tier"),
        active: true,
        channel: "email",
      };
      customers.set(customer.id, customer);
      return copy(customer);
    },

    get(id: string): Customer {
      return copy(require(id));
    },

    list(): Customer[] {
      return [...customers.values()].map(copy);
    },

    findByEmail(email: string): Customer | undefined {
      const customer = findByEmail(email);
      return customer ? copy(customer) : undefined;
    },

    setTier(id: string, tier: Tier): Customer {
      const customer = require(id);
      customer.tier = requireOneOf(tier, TIERS, "tier");
      return copy(customer);
    },

    setChannel(id: string, preference: ChannelPreference): Customer {
      const customer = require(id);
      if (preference.channel === "sms") {
        customer.phone = requireText(preference.phone, "phone");
        customer.channel = "sms";
      } else {
        requireOneOf(preference.channel, ["email"], "channel");
        customer.channel = "email";
      }
      return copy(customer);
    },

    deactivate(id: string): Customer {
      const customer = require(id);
      customer.active = false;
      return copy(customer);
    },

    setContractPrice(id: string, sku: string, priceCents: number | null): void {
      require(id);
      const terms = contracts.get(id) ?? new Map<string, number>();
      if (priceCents === null) terms.delete(sku);
      else terms.set(requireText(sku, "sku"), requireNonNegativeInt(priceCents, "priceCents"));
      contracts.set(id, terms);
    },

    contractPrice(id: string, sku: string): number | undefined {
      require(id);
      return contracts.get(id)?.get(sku);
    },

    addAddress(id: string, input: { line1: string; city: string; country: string }): Address {
      require(id);
      const list = addresses.get(id) ?? [];
      const address: Address = {
        id: addressId(),
        line1: requireText(input.line1, "line1"),
        city: requireText(input.city, "city"),
        country: requireText(input.country, "country"),
        isDefault: list.length === 0,
      };
      addresses.set(id, [...list, address]);
      return { ...address };
    },

    listAddresses(id: string): Address[] {
      require(id);
      return (addresses.get(id) ?? []).map((address) => ({ ...address }));
    },

    setDefaultAddress(id: string, addressIdToDefault: string): Address {
      require(id);
      const list = addresses.get(id) ?? [];
      const chosen = list.find((address) => address.id === addressIdToDefault);
      if (!chosen) fail("not_found", `address ${addressIdToDefault} not found`);
      for (const address of list) address.isDefault = address === chosen;
      return { ...chosen };
    },

    merge(sourceId: string, targetId: string): Customer {
      if (sourceId === targetId) fail("invalid_input", "cannot merge a customer into itself");
      const source = require(sourceId);
      const target = require(targetId);
      if (!source.active) fail("invalid_state", `customer ${sourceId} is inactive`);
      const targetAddresses = addresses.get(targetId) ?? [];
      const moved = (addresses.get(sourceId) ?? []).map((address) => ({ ...address, isDefault: targetAddresses.length === 0 && address.isDefault }));
      addresses.set(targetId, [...targetAddresses, ...moved]);
      addresses.set(sourceId, []);
      source.active = false;
      return copy(target);
    },
  };
}
