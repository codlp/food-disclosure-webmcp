import { existsSync, readFileSync } from "fs";
import { describe, expect, it } from "vitest";

type CatalogProduct = {
  handle: string;
  title: string;
  description: string;
  price: string;
  ingredients: string | null;
  label_statements: string[] | null;
  expected_case: string;
};

const CASES = new Set([
  "candidate",
  "ingredient_conflict",
  "label_statement_conflict",
  "ingredients_missing",
  "label_statements_missing",
]);

function loadCatalog(): CatalogProduct[] {
  return JSON.parse(readFileSync("fixtures/products.json", "utf8")) as CatalogProduct[];
}

describe("probe fixture", () => {
  it("is one complete candidate product with empty label statements", () => {
    const probe = JSON.parse(readFileSync("fixtures/probe-product.json", "utf8")) as CatalogProduct;
    expect(probe.handle).toBe("harbor-salt-potato-chips");
    expect(probe.ingredients).toBeTruthy();
    expect(probe.label_statements).toEqual([]);
    expect(probe.label_statements).not.toBeNull();
    expect(probe.expected_case).toBe("candidate");
    expect(probe.price).toMatch(/^\d+\.\d{2}$/);
  });

  it("matches the first catalog product", () => {
    const probe = JSON.parse(readFileSync("fixtures/probe-product.json", "utf8")) as CatalogProduct;
    const first = loadCatalog()[0];
    expect(first).toBeDefined();
    expect(probe.handle).toBe(first?.handle);
    expect(probe.ingredients).toBe(first?.ingredients);
    expect(probe.label_statements).toEqual(first?.label_statements);
    expect(probe.expected_case).toBe(first?.expected_case);
    expect(probe.price).toBe(first?.price);
  });
});

describe("twelve-product catalog", () => {
  it("contains exactly 12 unique handles and titles", () => {
    const products = loadCatalog();
    expect(products).toHaveLength(12);
    expect(new Set(products.map((row) => row.handle)).size).toBe(12);
    expect(new Set(products.map((row) => row.title)).size).toBe(12);
    for (const row of products) {
      expect(CASES.has(row.expected_case)).toBe(true);
      expect(row.price).toMatch(/^\d+\.\d{2}$/);
    }
  });

  it("keeps null label statements distinct from an empty list", () => {
    const products = loadCatalog();
    const missing = products.find((row) => row.expected_case === "label_statements_missing");
    const empty = products.find((row) => row.handle === "harbor-salt-potato-chips");
    expect(missing?.label_statements).toBeNull();
    expect(empty?.label_statements).toEqual([]);
    expect(missing?.label_statements).not.toEqual(empty?.label_statements);
  });

  it("includes one missing-ingredients record", () => {
    const missing = loadCatalog().filter((row) => row.expected_case === "ingredients_missing");
    expect(missing).toHaveLength(1);
    expect(missing[0]?.ingredients).toBeNull();
  });

  it("does not leak conflict terms into titles or descriptions", () => {
    for (const row of loadCatalog()) {
      const blob = `${row.title} ${row.description}`.toLowerCase();
      if (row.expected_case === "ingredient_conflict") {
        expect(blob).not.toMatch(/wheat|barley|semolina|malt/);
      }
      if (row.expected_case === "label_statement_conflict") {
        expect(blob).not.toMatch(/may contain/);
      }
      expect(JSON.stringify(row)).not.toMatch(
        /celiac|gluten-free|certified|safe for|allergen-free/i,
      );
    }
  });
});

describe("theme css", () => {
  it("keeps 44px touch targets and a 320px extra", () => {
    const css = readFileSync("theme/assets/theme.css", "utf8");
    expect(css).toContain("--touch: 44px");
    expect(css).toContain("max-width: 24.375rem");
    expect(css).toContain("min-width: 40rem");
    expect(css).toContain("min-width: 64rem");
    expect(css).toContain("#shopify-section-header");
    expect(css).toContain("#shopify-section-disclosure-review");
  });
});

describe("product photos", () => {
  it("includes a jpeg for every catalog handle", () => {
    for (const row of loadCatalog()) {
      expect(existsSync(`theme/assets/product-${row.handle}.jpg`)).toBe(true);
    }
  });
});
