import type { AccountDirectory } from "../accounts/index.ts";
import type { CatalogRepository } from "../catalog/index.ts";
import { createIdGenerator, fail, requirePositiveInt, requireText } from "../shared/index.ts";

export interface Review {
  id: string;
  customerId: string;
  sku: string;
  rating: number;
  text: string;
  hidden: boolean;
}

export interface RatedProduct {
  sku: string;
  averageRating: number;
  reviews: number;
}

export type Reviews = ReturnType<typeof createReviews>;

export function createReviews(deps: { accounts: AccountDirectory; catalog: CatalogRepository }) {
  const reviews: Review[] = [];
  const reviewId = createIdGenerator("rv");
  const visible = (sku: string) => reviews.filter((review) => review.sku === sku && !review.hidden);
  const average = (list: readonly Review[]) =>
    list.length === 0 ? null : Math.round((list.reduce((total, review) => total + review.rating, 0) / list.length) * 10) / 10;

  return {
    add(input: { customerId: string; sku: string; rating: number; text: string }): Review {
      deps.accounts.get(input.customerId);
      deps.catalog.get(input.sku);
      const rating = requirePositiveInt(input.rating, "rating");
      if (rating > 5) fail("invalid_input", "rating must be 1 to 5");
      if (reviews.some((review) => review.customerId === input.customerId && review.sku === input.sku)) {
        fail("conflict", `customer ${input.customerId} already reviewed ${input.sku}`);
      }
      const review: Review = { id: reviewId(), customerId: input.customerId, sku: input.sku, rating, text: requireText(input.text, "text"), hidden: false };
      reviews.push(review);
      return { ...review };
    },
    forProduct(sku: string): Review[] {
      return visible(sku).map((review) => ({ ...review }));
    },
    averageRating(sku: string): number | null {
      return average(visible(sku));
    },
    hide(id: string): Review {
      const review = reviews.find((candidate) => candidate.id === id);
      if (!review) fail("not_found", `review ${id} not found`);
      review.hidden = true;
      return { ...review };
    },
    topRated(limit: number): RatedProduct[] {
      requirePositiveInt(limit, "limit");
      const skus = [...new Set(reviews.filter((review) => !review.hidden).map((review) => review.sku))];
      return skus
        .map((sku) => ({ sku, averageRating: average(visible(sku)) as number, reviews: visible(sku).length }))
        .sort((a, b) => b.averageRating - a.averageRating || b.reviews - a.reviews || a.sku.localeCompare(b.sku))
        .slice(0, limit);
    },
  };
}
