export type Region = "US" | "EU" | "UK";
export type Tier = "standard" | "gold";

export interface Customer {
  id: string;
  name: string;
  email: string;
  region: Region;
  tier: Tier;
}

export interface NewCustomer {
  name: string;
  email: string;
  region: Region;
  tier?: Tier;
}
