export type TaxClass = "standard" | "reduced";

export interface Product {
  sku: string;
  name: string;
  priceCents: number;
  category: string;
  taxClass: TaxClass;
  discontinued: boolean;
  parentSku?: string;
}

export interface NewProduct {
  sku: string;
  name: string;
  priceCents: number;
  category: string;
  taxClass?: TaxClass;
}

export interface PriceChange {
  priceCents: number;
  at: number;
}

export interface ProductQuery {
  text?: string;
  category?: string;
}
