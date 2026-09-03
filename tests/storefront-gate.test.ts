import { describe, expect, it } from "vitest";
import {
  isCartAddPath,
  variantIdFromCartAddBody,
  variantIdFromSearchParams,
} from "../src/storefront-gate";

describe("storefront cart add detection", () => {
  it("recognizes Shopify cart add paths", () => {
    expect(isCartAddPath("/cart/add")).toBe(true);
    expect(isCartAddPath("https://shop.example/cart/add.js")).toBe(true);
    expect(isCartAddPath("/cart/add.json")).toBe(true);
    expect(isCartAddPath("/cart/change.js")).toBe(false);
    expect(isCartAddPath("/search")).toBe(false);
  });

  it("reads the variant id from JSON, form fields, and query strings", () => {
    expect(variantIdFromCartAddBody({ id: 11, quantity: 1 })).toBe("11");
    expect(variantIdFromCartAddBody({ items: [{ id: "22", quantity: 1 }] })).toBe("22");
    expect(variantIdFromCartAddBody("id=33&quantity=1")).toBe("33");
    expect(variantIdFromCartAddBody('{"id":44}')).toBe("44");
    expect(variantIdFromSearchParams(new URLSearchParams("id=55&quantity=1"))).toBe("55");
  });
});
