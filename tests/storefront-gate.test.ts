import { describe, expect, it } from "vitest";
import {
  cartLineIdForChange,
  isCartAddPath,
  parseCartRequest,
  resolveCartRequest,
  variantIdFromCartAddBody,
  variantIdFromSearchParams,
  variantIdsFromCartAddBody,
} from "../src/cart-routes";

const cart = {
  items: [
    { id: 11, variant_id: 11, quantity: 2, key: "11:abc" },
    { id: 22, variant_id: 22, quantity: 1, key: "22:def" },
  ],
};

describe("storefront cart add detection", () => {
  it("recognizes Shopify cart add paths", () => {
    expect(isCartAddPath("/cart/add")).toBe(true);
    expect(isCartAddPath("https://shop.example/cart/add.js")).toBe(true);
    expect(isCartAddPath("/en/cart/add.json")).toBe(true);
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

  it("reads every variant id from a multi-item add body", () => {
    expect(variantIdsFromCartAddBody({ items: [{ id: 11 }, { id: 22 }] })).toEqual(["11", "22"]);
  });
});

describe("cart write classification", () => {
  it("ignores cart views and non-cart URLs", () => {
    expect(parseCartRequest("/cart", "GET").type).toBe("ignore");
    expect(parseCartRequest("/cart.js", "GET").type).toBe("ignore");
    expect(parseCartRequest("/cart.json", "GET").type).toBe("ignore");
    expect(parseCartRequest("/products/harbor-salt-potato-chips", "GET").type).toBe("ignore");
    expect(parseCartRequest("/cart/add.js", "HEAD").type).toBe("ignore");
  });

  it("treats cart permalinks as receipt checks", () => {
    expect(parseCartRequest("/cart/11:1")).toEqual({ type: "check", variantIds: ["11"] });
    expect(parseCartRequest("/en-gb/cart/11:1,22:2")).toEqual({
      type: "check",
      variantIds: ["11", "22"],
    });
    expect(parseCartRequest("https://shop.example/cart/11:1?store=1")).toEqual({
      type: "check",
      variantIds: ["11"],
    });
  });

  it("allows clear and explicit quantity-zero removals", () => {
    expect(parseCartRequest("/cart/clear.js", "POST").type).toBe("allow");
    expect(parseCartRequest("/cart/change?line=1&quantity=0", "GET").type).toBe("allow");
    expect(
      parseCartRequest("/cart/change.js", "POST", { id: 11, quantity: 0 }).type,
    ).toBe("allow");
    expect(
      parseCartRequest("/cart/update.js", "POST", { updates: { "11": 0, "22": 0 } }).type,
    ).toBe("allow");
  });

  it("requires a receipt for adds, including locale-prefixed add.js", () => {
    expect(parseCartRequest("/cart/add?id=11", "GET")).toEqual({
      type: "check",
      variantIds: ["11"],
    });
    expect(parseCartRequest("/fr/cart/add.js", "POST", { id: 22, quantity: 1 })).toEqual({
      type: "check",
      variantIds: ["22"],
    });
    expect(
      parseCartRequest("/cart/add.js", "POST", { items: [{ id: 11 }, { id: 22 }] }),
    ).toEqual({ type: "check", variantIds: ["11", "22"] });
  });

  it("classifies change and update as mutations unless they are removals", () => {
    expect(parseCartRequest("/cart/change?line=1&quantity=3", "GET")).toEqual({
      type: "mutate",
      spec: { line: 1, quantity: 3 },
    });
    expect(parseCartRequest("/cart/change.js", "POST", { id: 11, quantity: 2 })).toEqual({
      type: "mutate",
      spec: { variantId: "11", quantity: 2 },
    });
    expect(
      parseCartRequest("/cart/update.js", "POST", { updates: { "11:abc": 4 } }),
    ).toEqual({
      type: "mutate",
      spec: { updates: { "11:abc": 4 } },
    });
  });
});

describe("cart write resolution against a live cart", () => {
  it("allows decreases and rejects keep-or-increase without a variant to check", () => {
    const decrease = parseCartRequest("/cart/change?line=1&quantity=1", "GET");
    expect(resolveCartRequest(decrease, cart)).toEqual({ type: "allow" });

    const increase = parseCartRequest("/cart/change?line=1&quantity=3", "GET");
    expect(resolveCartRequest(increase, cart)).toEqual({ type: "check", variantIds: ["11"] });

    const keep = parseCartRequest("/cart/change.js", "POST", { id: 22, quantity: 1 });
    expect(resolveCartRequest(keep, cart)).toEqual({ type: "check", variantIds: ["22"] });
  });

  it("checks each increased update key and allows a mixed update that only decreases", () => {
    const mixed = parseCartRequest("/cart/update.js", "POST", {
      updates: { "11": 1, "22": 0 },
    });
    expect(resolveCartRequest(mixed, cart)).toEqual({ type: "allow" });

    const up = parseCartRequest("/cart/update.js", "POST", { updates: { "11:abc": 5 } });
    expect(resolveCartRequest(up, cart)).toEqual({ type: "check", variantIds: ["11"] });
  });

  it("fails closed when a change needs the live cart and it is missing", () => {
    const change = parseCartRequest("/cart/change?line=1&quantity=2", "GET");
    expect(resolveCartRequest(change, null)).toEqual({ type: "check", variantIds: [] });
  });

  it("sends Shopify a string line key when it removes an unauthorized line", () => {
    expect(
      cartLineIdForChange({
        id: 71870633902102,
        variant_id: 71870633902102,
        quantity: 2,
        key: "71870633902102:18f412be5fe40e9760581ba147bf0911",
      }),
    ).toBe("71870633902102:18f412be5fe40e9760581ba147bf0911");
    expect(cartLineIdForChange({ id: 11, quantity: 1 })).toBe("11");
  });
});
