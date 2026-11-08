import { fail, requireNonNegativeInt, requireOneOf, requireText } from "../shared/index.ts";
import type { NewProduct, Product, TaxClass } from "./types.ts";

const TAX_CLASSES: readonly TaxClass[] = ["standard"];

export class CatalogRepository {
  private readonly products = new Map<string, Product>();

  add(input: NewProduct): Product {
    const product: Product = {
      sku: requireText(input.sku, "sku"),
      name: requireText(input.name, "name"),
      priceCents: requireNonNegativeInt(input.priceCents, "priceCents"),
      category: requireText(input.category, "category"),
      taxClass: requireOneOf(input.taxClass ?? "standard", TAX_CLASSES, "taxClass"),
    };
    if (this.products.has(product.sku)) fail("conflict", `product ${product.sku} already exists`);
    this.products.set(product.sku, product);
    return { ...product };
  }

  get(sku: string): Product {
    const product = this.products.get(sku);
    if (!product) fail("not_found", `product ${sku} not found`);
    return { ...product };
  }

  list(): Product[] {
    return [...this.products.values()].sort((a, b) => a.sku.localeCompare(b.sku)).map((product) => ({ ...product }));
  }
}
