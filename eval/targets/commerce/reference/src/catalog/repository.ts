import { fail, requireNonNegativeInt, requireOneOf, requireText } from "../shared/index.ts";
import type { NewProduct, PriceChange, Product, ProductQuery, TaxClass } from "./types.ts";

const TAX_CLASSES: readonly TaxClass[] = ["standard", "reduced"];

export interface CatalogOptions {
  now?: () => number;
}

export class CatalogRepository {
  private readonly products = new Map<string, Product>();
  private readonly prices = new Map<string, PriceChange[]>();
  private readonly now: () => number;

  constructor(options: CatalogOptions = {}) {
    this.now = options.now ?? Date.now;
  }

  add(input: NewProduct): Product {
    const product = this.validate(input);
    if (this.products.has(product.sku)) fail("conflict", `product ${product.sku} already exists`);
    this.store(product);
    return { ...product };
  }

  importProducts(inputs: readonly NewProduct[]): Product[] {
    const products = inputs.map((input) => this.validate(input));
    const seen = new Set<string>();
    for (const product of products) {
      if (this.products.has(product.sku) || seen.has(product.sku)) fail("conflict", `product ${product.sku} already exists`);
      seen.add(product.sku);
    }
    for (const product of products) this.store(product);
    return products.map((product) => ({ ...product }));
  }

  addVariant(parentSku: string, input: { sku: string; name: string; priceCents: number }): Product {
    const parent = this.require(parentSku);
    if (parent.parentSku !== undefined) fail("invalid_input", `${parentSku} is itself a variant`);
    const product = { ...this.validate({ ...input, category: parent.category, taxClass: parent.taxClass }), parentSku: parent.sku };
    if (this.products.has(product.sku)) fail("conflict", `product ${product.sku} already exists`);
    this.store(product);
    return { ...product };
  }

  get(sku: string): Product {
    return { ...this.require(sku) };
  }

  list(): Product[] {
    return [...this.products.values()].sort((a, b) => a.sku.localeCompare(b.sku)).map((product) => ({ ...product }));
  }

  search(query: ProductQuery = {}): Product[] {
    const text = query.text?.trim().toLowerCase();
    return this.list().filter(
      (product) =>
        !product.discontinued &&
        (text === undefined || product.name.toLowerCase().includes(text)) &&
        (query.category === undefined || product.category === query.category),
    );
  }

  variants(parentSku: string): Product[] {
    this.require(parentSku);
    return this.list().filter((product) => product.parentSku === parentSku);
  }

  updatePrice(sku: string, priceCents: number, at = this.now()): Product {
    const product = this.require(sku);
    product.priceCents = requireNonNegativeInt(priceCents, "priceCents");
    this.prices.get(sku)?.push({ priceCents: product.priceCents, at });
    return { ...product };
  }

  priceHistory(sku: string): PriceChange[] {
    this.require(sku);
    return (this.prices.get(sku) ?? []).map((change) => ({ ...change }));
  }

  discontinue(sku: string): Product {
    const product = this.require(sku);
    product.discontinued = true;
    return { ...product };
  }

  private validate(input: NewProduct): Product {
    return {
      sku: requireText(input.sku, "sku"),
      name: requireText(input.name, "name"),
      priceCents: requireNonNegativeInt(input.priceCents, "priceCents"),
      category: requireText(input.category, "category"),
      taxClass: requireOneOf(input.taxClass ?? "standard", TAX_CLASSES, "taxClass"),
      discontinued: false,
    };
  }

  private store(product: Product): void {
    this.products.set(product.sku, product);
    this.prices.set(product.sku, [{ priceCents: product.priceCents, at: this.now() }]);
  }

  private require(sku: string): Product {
    const product = this.products.get(sku);
    if (!product) fail("not_found", `product ${sku} not found`);
    return product;
  }
}
