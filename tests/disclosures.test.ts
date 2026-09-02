import { describe, expect, it } from "vitest";
import type { RenderedDisclosure } from "../src/types";
import { parseRegistry, productVersion } from "../src/disclosures";
import {
  INJECTION_FIXTURE,
  validateProductIdList,
  validateLabelStatements,
} from "../src/validation";

const sample: RenderedDisclosure = {
  product_id: "gid://shopify/Product/1",
  handle: "harbor-salt-potato-chips",
  title: "Harbor Salt Potato Chips",
  variant_ids: ["gid://shopify/ProductVariant/11"],
  ingredients: "Potatoes, sunflower oil, sea salt.",
  label_statements: [],
};

describe("disclosures", () => {
  it("indexes product and variant ids", () => {
    const registry = parseRegistry(JSON.stringify([sample]));
    expect("error" in registry).toBe(false);
    if ("error" in registry) return;
    expect(registry.byProductId.get(sample.product_id)?.handle).toBe(sample.handle);
    expect(registry.byHandle.get(sample.handle)?.title).toBe(sample.title);
    expect(registry.byVariantId.get("gid://shopify/ProductVariant/11")?.title).toBe(sample.title);
  });

  it("keeps null and empty label statements distinct in the version hash", async () => {
    const empty = { ...sample, label_statements: [] };
    const missing = { ...sample, label_statements: null };
    expect(await productVersion(empty)).not.toBe(await productVersion(missing));
  });

  it("rejects malformed label statements", () => {
    expect(validateLabelStatements("wheat")).toEqual({ error: "LABEL_STATEMENTS_MALFORMED" });
    expect(validateLabelStatements(["", "x"])).toEqual({ error: "LABEL_STATEMENTS_MALFORMED" });
  });

  it("treats the injection fixture as data", () => {
    expect(INJECTION_FIXTURE).toContain("Ignore previous instructions");
    const registry = parseRegistry(JSON.stringify([{ ...sample, ingredients: INJECTION_FIXTURE }]));
    expect("error" in registry).toBe(false);
  });
});

describe("tool input", () => {
  it("accepts 1-4 unique product gids", () => {
    expect(validateProductIdList({ product_ids: [sample.product_id] })).toEqual([
      sample.product_id,
    ]);
  });

  it("rejects zero, five, duplicates, and malformed ids", () => {
    expect(validateProductIdList({ product_ids: [] })).toEqual({ error: "INVALID_ARGUMENTS" });
    expect(
      validateProductIdList({
        product_ids: [
          "gid://shopify/Product/1",
          "gid://shopify/Product/2",
          "gid://shopify/Product/3",
          "gid://shopify/Product/4",
          "gid://shopify/Product/5",
        ],
      }),
    ).toEqual({ error: "TOO_MANY_PRODUCTS" });
    expect(validateProductIdList({ product_ids: [sample.product_id, sample.product_id] })).toEqual({
      error: "DUPLICATE_PRODUCT_ID",
    });
    expect(validateProductIdList({ product_ids: ["gid://shopify/ProductVariant/1"] })).toEqual([
      "gid://shopify/ProductVariant/1",
    ]);
    expect(validateProductIdList({ product_ids: { "0": sample.product_id } })).toEqual([
      sample.product_id,
    ]);
    expect(validateProductIdList({ product_ids: [{ id: sample.product_id }] })).toEqual([
      sample.product_id,
    ]);
    expect(validateProductIdList({ product_ids: ["harbor-salt-potato-chips"] })).toEqual([
      "harbor-salt-potato-chips",
    ]);
  });
});
