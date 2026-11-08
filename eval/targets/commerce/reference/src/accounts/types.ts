export type Region = "US" | "EU" | "UK";
export type Tier = "standard" | "silver" | "gold";
export type Channel = "email" | "sms";

export interface Customer {
  id: string;
  name: string;
  email: string;
  region: Region;
  tier: Tier;
  active: boolean;
  channel: Channel;
  phone?: string;
}

export interface NewCustomer {
  name: string;
  email: string;
  region: Region;
  tier?: Tier;
}

export interface Address {
  id: string;
  line1: string;
  city: string;
  country: string;
  isDefault: boolean;
}

export type ChannelPreference = { channel: "email" } | { channel: "sms"; phone: string };
