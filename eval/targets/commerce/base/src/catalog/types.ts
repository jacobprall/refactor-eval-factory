export type TaxClass = "standard";

export interface Product {
  sku: string;
  name: string;
  priceCents: number;
  category: string;
  taxClass: TaxClass;
}

export interface NewProduct {
  sku: string;
  name: string;
  priceCents: number;
  category: string;
  taxClass?: TaxClass;
}
