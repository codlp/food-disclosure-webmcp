import { readFileSync } from "fs";
import { describe, expect, it } from "vitest";
import {
  DEMO_BUDGET_USD,
  DEMO_CANDIDATE_HANDLES,
  DEMO_REQUEST,
  DEMO_SKIP_HANDLES,
} from "../src/demo-request";

type CatalogProduct = {
  handle: string;
  expected_case: string;
  price: string;
};

describe("demo request", () => {
  it("matches the storefront copy and the $40 budget", () => {
    const locales = JSON.parse(readFileSync("theme/locales/en.default.json", "utf8")) as {
      hero: { request: string };
    };
    expect(locales.hero.request).toBe(DEMO_REQUEST);
    expect(DEMO_REQUEST).toContain(`$${DEMO_BUDGET_USD}`);
  });

  it("classifies every catalog product as a candidate or a skip", () => {
    const products = JSON.parse(readFileSync("fixtures/products.json", "utf8")) as CatalogProduct[];
    const candidates = new Set<string>(DEMO_CANDIDATE_HANDLES);
    const skips = new Set<string>(DEMO_SKIP_HANDLES);
    expect(candidates.size + skips.size).toBe(12);
    for (const row of products) {
      if (row.expected_case === "candidate") {
        expect(candidates.has(row.handle)).toBe(true);
        expect(Number(row.price)).toBeLessThan(DEMO_BUDGET_USD);
      } else {
        expect(skips.has(row.handle)).toBe(true);
      }
    }
  });
});

describe("storefront copy boundary", () => {
  it("does not use trust, verified, or safe claims in customer locales", () => {
    const locales = readFileSync("theme/locales/en.default.json", "utf8");
    expect(locales).not.toMatch(/\btrust\b/i);
    expect(locales).not.toMatch(/\bverified\b/i);
    expect(locales).not.toMatch(/\b(un)?safe\b/i);
    expect(locales).not.toMatch(/\bceliac\b/i);
    expect(locales).not.toMatch(/\bapproved\b/i);
  });
});
